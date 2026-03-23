import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import type { OrcTransportFaultCode, OrcTransportWarningCode } from "../orc-events/index.js";
import type { OrcDebugArtifactsWriter } from "../orc-debug.js";
import type { OrcCanonicalEventEnvelope, OrcPythonRunnerSpawnContract, OrcRunnerLaunchInput } from "../orc-io.js";
import { defaultBuildPythonRunnerSpawnContract } from "./spawn-contract.js";
import { drainTerminatedLines, flushResidualStream, guardBuffer } from "./line-assembler.js";
import { extractObservedSequenceHint, handleStdoutLine, previewLine } from "./protocol-parser.js";
import { OrcPythonTransportHealthStore } from "./health-store.js";
import { evaluateTransportTimeouts, startMonitors, stopMonitors } from "./timeout-monitor.js";
import {
	DEFAULT_CORRELATED_STDERR_HISTORY,
	DEFAULT_FATAL_PARSE_FAILURE_COUNT,
	DEFAULT_IDLE_WARNING_MS,
	DEFAULT_MAX_BUFFERED_BYTES,
	DEFAULT_MAX_DIAGNOSTIC_LINE_LENGTH,
	DEFAULT_READY_TIMEOUT_MS,
	DEFAULT_STALL_TIMEOUT_MS,
	type LineAssemblyState,
	type OrcPythonTransport,
	type OrcPythonTransportDiagnosticEvent,
	type OrcPythonTransportHealth,
	type OrcPythonTransportLifecycleEvent,
	type OrcPythonTransportOptions,
	type StderrSnippet,
	type TransportStream,
} from "./types.js";

export class OrcPythonChildProcessTransport implements OrcPythonTransport {
	private readonly emitter = new EventEmitter();
	private readonly buildSpawnContract: (input: OrcRunnerLaunchInput) => OrcPythonRunnerSpawnContract;
	private readonly debugArtifactsWriter?: OrcDebugArtifactsWriter;
	private readonly maxBufferedBytes: number;
	private readonly maxDiagnosticLineLength: number;
	private readonly idleWarningMs: number;
	private readonly stallTimeoutMs: number;
	private readonly readyTimeoutMs: number;
	private readonly correlatedStderrHistory: number;
	private readonly fatalParseFailureCount: number;
	private child?: ChildProcessWithoutNullStreams;
	private readonly healthStore = new OrcPythonTransportHealthStore({
		stage: "idle",
		status: "idle",
		args: [],
		stdoutLines: 0,
		stderrLines: 0,
		stdoutBufferedBytes: 0,
		stderrBufferedBytes: 0,
		diagnosticsDropped: 0,
		warningEvents: 0,
		faultEvents: 0,
		parseFailures: 0,
		consecutiveParseFailures: 0,
		timeouts: {
			idleWarningMs: DEFAULT_IDLE_WARNING_MS,
			stallTimeoutMs: DEFAULT_STALL_TIMEOUT_MS,
			readyTimeoutMs: DEFAULT_READY_TIMEOUT_MS,
		},
	});
	private readonly stdoutState: LineAssemblyState = { stream: "stdout", decoder: new StringDecoder("utf8"), buffer: "", bufferedBytes: 0 };
	private readonly stderrState: LineAssemblyState = { stream: "stderr", decoder: new StringDecoder("utf8"), buffer: "", bufferedBytes: 0 };
	private recentStderr: StderrSnippet[] = [];
	private cleanupCallbacks: Array<() => void> = [];
	private exitPromise?: Promise<void>;
	private resolveExitPromise?: () => void;
	private activeTerminationReason?: string;
	private monitorInterval?: NodeJS.Timeout;
	private readonly emittedFaultKeys = new Set<string>();

	constructor(options: OrcPythonTransportOptions = {}) {
		this.buildSpawnContract = options.buildSpawnContract ?? defaultBuildPythonRunnerSpawnContract;
		this.debugArtifactsWriter = options.debugArtifactsWriter;
		this.maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
		this.maxDiagnosticLineLength = options.maxDiagnosticLineLength ?? DEFAULT_MAX_DIAGNOSTIC_LINE_LENGTH;
		this.idleWarningMs = options.idleWarningMs ?? DEFAULT_IDLE_WARNING_MS;
		this.stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
		this.readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
		this.correlatedStderrHistory = options.correlatedStderrHistory ?? DEFAULT_CORRELATED_STDERR_HISTORY;
		this.fatalParseFailureCount = options.fatalParseFailureCount ?? DEFAULT_FATAL_PARSE_FAILURE_COUNT;
	}

	async launch(input: OrcRunnerLaunchInput): Promise<void> { await this.start(input); }
	async resume(input: OrcRunnerLaunchInput): Promise<void> { await this.start(input); }
	async cancel(reason = "cancel_requested"): Promise<void> { await this.stop("SIGTERM", "cancelling", reason); }
	async shutdown(reason = "shutdown_requested"): Promise<void> { await this.stop("SIGTERM", "shutting_down", reason); }
	getHealth(): OrcPythonTransportHealth { return this.healthStore.clone(); }
	get health(): OrcPythonTransportHealth { return this.healthStore.snapshot; }
	set health(value: OrcPythonTransportHealth) { this.healthStore.replace(value); }

	onLifecycle(listener: (event: OrcPythonTransportLifecycleEvent) => void): () => void {
		this.emitter.on("lifecycle", listener);
		return () => this.emitter.off("lifecycle", listener);
	}
	
	onEnvelope(listener: (envelope: OrcCanonicalEventEnvelope) => void): () => void {
		this.emitter.on("envelope", listener);
		return () => this.emitter.off("envelope", listener);
	}

	onDiagnostic(listener: (event: OrcPythonTransportDiagnosticEvent) => void): () => void {
		this.emitter.on("diagnostic", listener);
		return () => this.emitter.off("diagnostic", listener);
	}

	async dispose(): Promise<void> {
		await this.shutdown("transport_disposed");
		this.emitter.removeAllListeners();
	}

	private async start(input: OrcRunnerLaunchInput): Promise<void> {
		if (this.child) {
			throw new Error(`Python transport is already active for thread ${this.health.threadId ?? "unknown-thread"}; refusing double-spawn.`);
		}
		const launchInput = { ...input, runCorrelationId: input.runCorrelationId ?? `orc-run-${randomUUID()}` };
		const contract = this.buildSpawnContract(launchInput);
		const spawnedAt = new Date().toISOString();
		this.resetAssemblyState();
		this.recentStderr = [];
		this.activeTerminationReason = undefined;
		this.emittedFaultKeys.clear();
		this.health = {
			threadId: launchInput.threadId,
			runCorrelationId: launchInput.runCorrelationId,
			stage: "launching",
			status: "healthy",
			command: contract.command,
			args: [...contract.args],
			cwd: contract.cwd,
			spawnedAt,
			lastEventAt: spawnedAt,
			stdoutLines: 0,
			stderrLines: 0,
			stdoutBufferedBytes: 0,
			stderrBufferedBytes: 0,
			diagnosticsDropped: 0,
			warningEvents: 0,
			faultEvents: 0,
			parseFailures: 0,
			consecutiveParseFailures: 0,
			timeouts: {
				idleWarningMs: this.idleWarningMs,
				stallTimeoutMs: this.stallTimeoutMs,
				readyTimeoutMs: this.readyTimeoutMs,
				lastProgressAt: spawnedAt,
			},
		};
		this.exitPromise = new Promise<void>((resolve) => { this.resolveExitPromise = resolve; });
		const child = spawn(contract.command, contract.args, { cwd: contract.cwd, stdio: ["pipe", "pipe", "pipe"] });
		this.child = child;
		this.health.pid = child.pid;
		this.health.stage = "spawned";
		this.startMonitors();
		this.emitLifecycle({ stage: "spawned", at: spawnedAt, threadId: launchInput.threadId, runCorrelationId: launchInput.runCorrelationId, pid: child.pid });
		this.debugArtifactsWriter?.recordHealthSnapshot("transport_spawned", this.getHealth());

		const onStdoutData = (chunk: Buffer) => { this.processChunk("stdout", chunk); };
		const onStderrData = (chunk: Buffer) => { this.processChunk("stderr", chunk); };
		const onError = (error: Error) => {
			const at = new Date().toISOString();
			this.health.stage = "failed";
			this.health.status = "faulted";
			this.health.lastError = error.message;
			this.health.lastErrorAt = at;
			this.health.lastEventAt = at;
			this.emitLifecycle({ stage: "spawn_failed", at, threadId: this.health.threadId, runCorrelationId: this.health.runCorrelationId, pid: child.pid, reason: error.message, error });
			this.debugArtifactsWriter?.recordTransportDiagnostic({ type: "spawn_failed", at, error: { name: error.name, message: error.message }, health: this.getHealth() });
		};
		const onStdinError = (error: Error) => {
			this.emitTransportFault("transport_broken_pipe", "Runner stdin pipe closed unexpectedly.", {
				stream: "stdin",
				message: error.message,
				syscall: (error as NodeJS.ErrnoException).syscall,
				retryable: true,
				remediationHint: "Inspect stderr and relaunch the runner; the IPC pipe closed before the launch contract completed.",
				retryability: "phase_2_retryable",
			});
		};
		const onExit = (exitCode: number | null, signal: NodeJS.Signals | null) => {
			const at = new Date().toISOString();
			const terminatedBySignal = Boolean(signal);
			this.flushResidualStream("stdout", false);
			this.flushResidualStream("stderr", true);
			this.health.exitedAt = at;
			this.health.lastEventAt = at;
			this.health.lastExitCode = exitCode;
			this.health.lastSignal = signal;
			this.health.stage = terminatedBySignal ? "terminated" : "exited";
			this.health.status = exitCode === 0 && !terminatedBySignal && this.health.status !== "faulted" ? "offline" : this.health.status === "faulted" ? "faulted" : "offline";
			this.emitLifecycle({ stage: terminatedBySignal ? "terminated" : "exit", at, threadId: this.health.threadId, runCorrelationId: this.health.runCorrelationId, pid: child.pid, exitCode, signal, reason: this.activeTerminationReason });
			this.debugArtifactsWriter?.recordHealthSnapshot("transport_exit", this.getHealth());
			this.detachChild();
		};
		child.stdout.on("data", onStdoutData);
		child.stderr.on("data", onStderrData);
		child.stdin.on("error", onStdinError);
		child.once("error", onError);
		child.once("exit", onExit);
		this.cleanupCallbacks = [() => child.stdout.off("data", onStdoutData), () => child.stderr.off("data", onStderrData), () => child.stdin.off("error", onStdinError), () => child.off("error", onError), () => child.off("exit", onExit)];
		try {
			child.stdin.write(`${JSON.stringify(contract.stdinPayload)}\n`);
			child.stdin.end();
		} catch (error) {
			onError(error instanceof Error ? error : new Error(String(error)));
			await this.stop("SIGKILL", "failed", "stdin_write_failed");
			throw error;
		}
	}

	private async stop(signal: NodeJS.Signals, stage: "cancelling" | "shutting_down" | "failed", reason: string): Promise<void> {
		if (!this.child) {
			if (stage !== "failed") {
				this.health = { ...this.health, stage: "idle", status: "idle" };
			}
			return;
		}
		this.activeTerminationReason = reason;
		this.healthStore.markStage(stage);
		this.child.kill(signal);
		await this.exitPromise;
	}

	private processChunk(stream: TransportStream, chunk: Buffer): void {
		this.healthStore.recordStreamProgress(stream);
		const state = stream === "stdout" ? this.stdoutState : this.stderrState;
		state.buffer += state.decoder.write(chunk);
		state.bufferedBytes = Buffer.byteLength(state.buffer, "utf8");
		this.healthStore.setBufferedBytes(stream, state.bufferedBytes);
		if (!guardBuffer({
			stream,
			state,
			maxBufferedBytes: this.maxBufferedBytes,
			setBufferedBytes: (target, value) => this.healthStore.setBufferedBytes(target, value),
			onStderrOverflow: (bufferedBytes) => {
				this.health.diagnosticsDropped += 1;
				this.emitTransportWarning("transport_stderr_truncated", "Stderr buffer exceeded its byte budget and oldest diagnostic bytes were dropped.", {
					stream,
					bufferedBytes,
					maxBufferedBytes: this.maxBufferedBytes,
					stderrSnippets: this.recentStderr,
				});
			},
			onStdoutOverflow: (buffer, bufferedBytes) => {
				this.emitTransportFault("transport_stdout_overflow", "Stdout buffer exceeded its byte budget before a newline boundary was observed.", {
					stream,
					bufferedBytes,
					maxBufferedBytes: this.maxBufferedBytes,
					linePreview: previewLine(buffer),
					lineBytes: bufferedBytes,
					expectedSequenceHint: this.health.lastStdoutSequence === undefined ? undefined : this.health.lastStdoutSequence + 1,
					stderrSnippets: this.recentStderr,
					retryable: false,
				});
			},
		})) {
			return;
		}
		for (const line of drainTerminatedLines(state)) {
			if (stream === "stdout") {
				this.handleStdoutLine(line);
				continue;
			}
			this.handleStderrLine(line.text);
		}
		this.healthStore.setBufferedBytes(stream, state.bufferedBytes);
	}

	private handleStdoutLine(line: Parameters<typeof handleStdoutLine>[0]["line"]): void {
		const result = handleStdoutLine({
			line,
			health: this.health,
			recentStderr: this.recentStderr,
			fatalParseFailureCount: this.fatalParseFailureCount,
			stdoutBufferedBytes: this.health.stdoutBufferedBytes,
		});
		if (result.kind === "ignore") {
			return;
		}
		if (result.kind === "canonical_envelope") {
			if (this.health.stage === "spawned") {
				this.health.stage = "ready";
				this.health.readyAt = result.observedAt;
				this.emitLifecycle({ stage: "ready", at: this.health.readyAt, threadId: this.health.threadId, runCorrelationId: this.health.runCorrelationId, pid: this.health.pid, reason: result.envelope.what?.name });
			}
			this.emitter.emit("envelope", result.envelope);
			this.debugArtifactsWriter?.recordRawEventMirror(result.envelope);
			return;
		}
		this.debugArtifactsWriter?.recordParserWarning({ at: result.observedAt, level: result.kind === "fatal_fault" ? "fault" : "warning", code: result.code, payload: result.payload });
		if (result.kind === "fatal_fault") {
			this.emitTransportFault(result.code, result.message, result.payload);
			return;
		}
		this.emitTransportWarning(result.code, result.message, result.payload);
	}

	private handleStderrLine(line: string): void {
		const at = new Date().toISOString();
		this.health.stderrLines += 1;
		this.health.lastEventAt = at;
		const truncated = line.length > this.maxDiagnosticLineLength;
		const normalizedLine = truncated ? `${line.slice(0, this.maxDiagnosticLineLength)}…` : line;
		this.health.lastStderrLine = normalizedLine;
		this.recentStderr.push({ at, line: normalizedLine, truncated });
		this.recentStderr = this.recentStderr.slice(-this.correlatedStderrHistory);
		if (truncated) {
			this.health.diagnosticsDropped += 1;
			this.emitTransportWarning("transport_stderr_truncated", "Stderr diagnostic exceeded the preview budget and was truncated.", {
				stream: "stderr",
				linePreview: previewLine(line),
				lineBytes: Buffer.byteLength(line, "utf8"),
				truncatedTo: this.maxDiagnosticLineLength,
				stderrSnippets: this.recentStderr,
			});
		}
		const event = { at, stream: "stderr", threadId: this.health.threadId, runCorrelationId: this.health.runCorrelationId, line: normalizedLine, truncated } satisfies OrcPythonTransportDiagnosticEvent;
		this.emitter.emit("diagnostic", event);
		this.debugArtifactsWriter?.recordPythonStderr(event);
	}

	private flushResidualStream(stream: TransportStream, emitDecoderRemainder: boolean): void {
		const state = stream === "stdout" ? this.stdoutState : this.stderrState;
		flushResidualStream({
			stream,
			state,
			emitDecoderRemainder,
			setBufferedBytes: (target, value) => this.healthStore.setBufferedBytes(target, value),
			onStdoutLine: (line) => this.handleStdoutLine(line),
			onStderrLine: (line) => this.handleStderrLine(line),
			onPartialStdoutLine: (leftover) => {
				this.emitTransportWarning("transport_partial_line_truncated", "End-of-stream arrived with a partial stdout line that could not be completed.", {
					stream,
					linePreview: previewLine(leftover),
					lineBytes: Buffer.byteLength(leftover, "utf8"),
					terminated: false,
					recoverable: this.health.lastExitCode === 0,
					expectedSequenceHint: this.health.lastStdoutSequence === undefined ? undefined : this.health.lastStdoutSequence + 1,
					observedSequenceHint: extractObservedSequenceHint(leftover),
					stderrSnippets: this.recentStderr,
				});
			},
		});
	}

	private startMonitors(): void {
		this.monitorInterval = startMonitors(() => { this.evaluateTransportTimeouts(); }, () => this.stopMonitors());
	}

	private stopMonitors(): void {
		stopMonitors(this.monitorInterval);
		this.monitorInterval = undefined;
	}

	private evaluateTransportTimeouts(): void {
		evaluateTransportTimeouts({
			child: this.child,
			health: this.health,
			recentStderr: this.recentStderr,
			idleWarningMs: this.idleWarningMs,
			stallTimeoutMs: this.stallTimeoutMs,
			readyTimeoutMs: this.readyTimeoutMs,
			emitTransportWarning: (code, message, payload) => this.emitTransportWarning(code as OrcTransportWarningCode, message, payload),
			emitTransportFault: (code, message, payload) => this.emitTransportFault(code as OrcTransportFaultCode, message, payload),
		});
	}

	private emitTransportWarning(code: OrcTransportWarningCode, message: string, rawPayload: Record<string, unknown>): void {
		const { at, status } = this.healthStore.recordWarning(code, message);
		this.debugArtifactsWriter?.recordTransportDiagnostic({ type: "warning", at, code, message, status, rawPayload, health: this.getHealth() });
		this.emitter.emit("envelope", this.healthStore.buildTransportEnvelope("stream.warning", code, message, status, rawPayload));
	}

	private emitTransportFault(code: OrcTransportFaultCode, message: string, rawPayload: Record<string, unknown>): void {
		const statusKey = String(rawPayload.status ?? "unknown");
		const dedupeKey = `${code}:${statusKey}:${String(rawPayload.signal ?? "none")}:${String(rawPayload.exitCode ?? "none")}:${String(rawPayload.syscall ?? "none")}`;
		if (this.emittedFaultKeys.has(dedupeKey)) {
			return;
		}
		this.emittedFaultKeys.add(dedupeKey);
		const { at, status } = this.healthStore.recordFault(code, message);
		this.debugArtifactsWriter?.recordTransportDiagnostic({ type: "fault", at, code, message, status, rawPayload, health: this.getHealth() });
		this.emitter.emit("envelope", this.healthStore.buildTransportEnvelope("transport.fault", code, message, status, rawPayload));
	}

	private emitLifecycle(event: OrcPythonTransportLifecycleEvent): void {
		this.debugArtifactsWriter?.recordLifecycleEvent(event, this.getHealth());
		this.emitter.emit("lifecycle", event);
	}

	private resetAssemblyState(): void {
		this.stdoutState.decoder.end();
		this.stderrState.decoder.end();
		this.stdoutState.decoder = new StringDecoder("utf8");
		this.stderrState.decoder = new StringDecoder("utf8");
		this.stdoutState.buffer = "";
		this.stderrState.buffer = "";
		this.stdoutState.bufferedBytes = 0;
		this.stderrState.bufferedBytes = 0;
	}

	private detachChild(): void {
		this.stopMonitors();
		for (const cleanup of this.cleanupCallbacks) {
			cleanup();
		}
		this.cleanupCallbacks = [];
		this.child = undefined;
		this.resolveExitPromise?.();
		this.resolveExitPromise = undefined;
		this.exitPromise = undefined;
	}
}
