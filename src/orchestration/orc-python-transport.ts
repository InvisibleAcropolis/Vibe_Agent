import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import {
	classifyOrcFailureDisposition,
	classifyOrcTransportIssue,
	type OrcTransportFaultCode,
	type OrcTransportWarningCode,
} from "./orc-events.js";
import type { OrcCanonicalEventEnvelope, OrcPythonRunnerSpawnContract, OrcRunnerLaunchInput } from "./orc-io.js";

export type OrcPythonTransportLifecycleStage =
	| "idle"
	| "launching"
	| "spawned"
	| "ready"
	| "cancelling"
	| "shutting_down"
	| "exited"
	| "terminated"
	| "failed";

export interface OrcPythonTransportTimeoutMetadata {
	idleWarningMs: number;
	stallTimeoutMs: number;
	readyTimeoutMs: number;
	lastProgressAt?: string;
	lastStdoutChunkAt?: string;
	lastStderrChunkAt?: string;
	lastIdleWarningAt?: string;
	lastStallFaultAt?: string;
	lastReadyTimeoutAt?: string;
}

export interface OrcPythonTransportHealth {
	threadId?: string;
	runCorrelationId?: string;
	stage: OrcPythonTransportLifecycleStage;
	status: "idle" | "healthy" | "degraded" | "offline" | "faulted";
	pid?: number;
	command?: string;
	args: string[];
	cwd?: string;
	spawnedAt?: string;
	readyAt?: string;
	exitedAt?: string;
	lastEventAt?: string;
	lastErrorAt?: string;
	lastError?: string;
	lastSignal?: NodeJS.Signals | null;
	lastExitCode?: number | null;
	stdoutLines: number;
	stderrLines: number;
	stdoutBufferedBytes: number;
	stderrBufferedBytes: number;
	diagnosticsDropped: number;
	warningEvents: number;
	faultEvents: number;
	parseFailures: number;
	consecutiveParseFailures: number;
	lastStdoutEventId?: string;
	lastStdoutSequence?: number;
	lastStderrLine?: string;
	timeouts: OrcPythonTransportTimeoutMetadata;
}

export interface OrcPythonTransportLifecycleEvent {
	stage: "spawned" | "ready" | "exit" | "terminated" | "spawn_failed";
	at: string;
	threadId?: string;
	runCorrelationId?: string;
	pid?: number;
	exitCode?: number | null;
	signal?: NodeJS.Signals | null;
	reason?: string;
	error?: Error;
}

export interface OrcPythonTransportDiagnosticEvent {
	at: string;
	stream: "stderr";
	threadId?: string;
	runCorrelationId?: string;
	line: string;
	truncated: boolean;
}

export interface OrcPythonTransportOptions {
	buildSpawnContract?: (input: OrcRunnerLaunchInput) => OrcPythonRunnerSpawnContract;
	maxBufferedBytes?: number;
	maxDiagnosticLineLength?: number;
	idleWarningMs?: number;
	stallTimeoutMs?: number;
	readyTimeoutMs?: number;
	correlatedStderrHistory?: number;
	fatalParseFailureCount?: number;
}

export interface OrcPythonTransport {
	launch(input: OrcRunnerLaunchInput): Promise<void>;
	resume(input: OrcRunnerLaunchInput): Promise<void>;
	cancel(reason?: string): Promise<void>;
	shutdown(reason?: string): Promise<void>;
	getHealth(): OrcPythonTransportHealth;
	onLifecycle(listener: (event: OrcPythonTransportLifecycleEvent) => void): () => void;
	onEnvelope(listener: (envelope: OrcCanonicalEventEnvelope) => void): () => void;
	onDiagnostic(listener: (event: OrcPythonTransportDiagnosticEvent) => void): () => void;
	dispose(): Promise<void>;
}

const DEFAULT_MAX_BUFFERED_BYTES = 64 * 1024;
const DEFAULT_MAX_DIAGNOSTIC_LINE_LENGTH = 4000;
const DEFAULT_IDLE_WARNING_MS = 5_000;
const DEFAULT_STALL_TIMEOUT_MS = 15_000;
const DEFAULT_READY_TIMEOUT_MS = 10_000;
const DEFAULT_CORRELATED_STDERR_HISTORY = 5;
const DEFAULT_FATAL_PARSE_FAILURE_COUNT = 3;

type TransportStream = "stdout" | "stderr";

interface AssembledLine {
	text: string;
	terminated: boolean;
	byteLength: number;
}

interface LineAssemblyState {
	stream: TransportStream;
	decoder: StringDecoder;
	buffer: string;
	bufferedBytes: number;
}

interface StderrSnippet {
	at: string;
	line: string;
	truncated: boolean;
}

export class OrcPythonChildProcessTransport implements OrcPythonTransport {
	private readonly emitter = new EventEmitter();
	private readonly buildSpawnContract: (input: OrcRunnerLaunchInput) => OrcPythonRunnerSpawnContract;
	private readonly maxBufferedBytes: number;
	private readonly maxDiagnosticLineLength: number;
	private readonly idleWarningMs: number;
	private readonly stallTimeoutMs: number;
	private readonly readyTimeoutMs: number;
	private readonly correlatedStderrHistory: number;
	private readonly fatalParseFailureCount: number;
	private child?: ChildProcessWithoutNullStreams;
	private health: OrcPythonTransportHealth = {
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
	};
	private readonly stdoutState: LineAssemblyState = {
		stream: "stdout",
		decoder: new StringDecoder("utf8"),
		buffer: "",
		bufferedBytes: 0,
	};
	private readonly stderrState: LineAssemblyState = {
		stream: "stderr",
		decoder: new StringDecoder("utf8"),
		buffer: "",
		bufferedBytes: 0,
	};
	private recentStderr: StderrSnippet[] = [];
	private cleanupCallbacks: Array<() => void> = [];
	private exitPromise?: Promise<void>;
	private resolveExitPromise?: () => void;
	private activeTerminationReason?: string;
	private monitorInterval?: NodeJS.Timeout;
	private readonly emittedFaultKeys = new Set<string>();

	constructor(options: OrcPythonTransportOptions = {}) {
		this.buildSpawnContract = options.buildSpawnContract ?? defaultBuildPythonRunnerSpawnContract;
		this.maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
		this.maxDiagnosticLineLength = options.maxDiagnosticLineLength ?? DEFAULT_MAX_DIAGNOSTIC_LINE_LENGTH;
		this.idleWarningMs = options.idleWarningMs ?? DEFAULT_IDLE_WARNING_MS;
		this.stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
		this.readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
		this.correlatedStderrHistory = options.correlatedStderrHistory ?? DEFAULT_CORRELATED_STDERR_HISTORY;
		this.fatalParseFailureCount = options.fatalParseFailureCount ?? DEFAULT_FATAL_PARSE_FAILURE_COUNT;
	}

	async launch(input: OrcRunnerLaunchInput): Promise<void> {
		await this.start(input);
	}

	async resume(input: OrcRunnerLaunchInput): Promise<void> {
		await this.start(input);
	}

	async cancel(reason = "cancel_requested"): Promise<void> {
		await this.stop("SIGTERM", "cancelling", reason);
	}

	async shutdown(reason = "shutdown_requested"): Promise<void> {
		await this.stop("SIGTERM", "shutting_down", reason);
	}

	getHealth(): OrcPythonTransportHealth {
		return {
			...this.health,
			args: [...this.health.args],
			timeouts: { ...this.health.timeouts },
		};
	}

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

		const launchInput = {
			...input,
			runCorrelationId: input.runCorrelationId ?? `orc-run-${randomUUID()}`,
		};
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
		this.exitPromise = new Promise<void>((resolve) => {
			this.resolveExitPromise = resolve;
		});

		const child = spawn(contract.command, contract.args, {
			cwd: contract.cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.child = child;
		this.health.pid = child.pid;
		this.health.stage = "spawned";
		this.startMonitors();
		this.emitLifecycle({
			stage: "spawned",
			at: spawnedAt,
			threadId: launchInput.threadId,
			runCorrelationId: launchInput.runCorrelationId,
			pid: child.pid,
		});

		const onStdoutData = (chunk: Buffer) => {
			this.processChunk("stdout", chunk);
		};
		const onStderrData = (chunk: Buffer) => {
			this.processChunk("stderr", chunk);
		};
		const onError = (error: Error) => {
			const at = new Date().toISOString();
			this.health.stage = "failed";
			this.health.status = "faulted";
			this.health.lastError = error.message;
			this.health.lastErrorAt = at;
			this.health.lastEventAt = at;
			this.emitLifecycle({
				stage: "spawn_failed",
				at,
				threadId: this.health.threadId,
				runCorrelationId: this.health.runCorrelationId,
				pid: child.pid,
				reason: error.message,
				error,
			});
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
			this.emitLifecycle({
				stage: terminatedBySignal ? "terminated" : "exit",
				at,
				threadId: this.health.threadId,
				runCorrelationId: this.health.runCorrelationId,
				pid: child.pid,
				exitCode,
				signal,
				reason: this.activeTerminationReason,
			});
			this.detachChild();
		};

		child.stdout.on("data", onStdoutData);
		child.stderr.on("data", onStderrData);
		child.stdin.on("error", onStdinError);
		child.once("error", onError);
		child.once("exit", onExit);
		this.cleanupCallbacks = [
			() => child.stdout.off("data", onStdoutData),
			() => child.stderr.off("data", onStderrData),
			() => child.stdin.off("error", onStdinError),
			() => child.off("error", onError),
			() => child.off("exit", onExit),
		];

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
				this.health = {
					...this.health,
					stage: "idle",
					status: "idle",
				};
			}
			return;
		}
		this.activeTerminationReason = reason;
		this.health.stage = stage;
		this.health.lastEventAt = new Date().toISOString();
		this.child.kill(signal);
		await this.exitPromise;
	}

	private processChunk(stream: TransportStream, chunk: Buffer): void {
		this.recordStreamProgress(stream);
		const state = stream === "stdout" ? this.stdoutState : this.stderrState;
		state.buffer += state.decoder.write(chunk);
		state.bufferedBytes = Buffer.byteLength(state.buffer, "utf8");
		this.setBufferedBytes(stream, state.bufferedBytes);
		if (!this.guardBuffer(stream)) {
			return;
		}
		for (const line of this.drainTerminatedLines(state)) {
			if (stream === "stdout") {
				this.handleStdoutLine(line);
				continue;
			}
			this.handleStderrLine(line.text);
		}
		this.setBufferedBytes(stream, state.bufferedBytes);
	}

	private handleStdoutLine(line: AssembledLine): void {
		const normalizedLine = line.text.endsWith("\r") ? line.text.slice(0, -1) : line.text;
		const trimmedLine = normalizedLine.trim();
		if (trimmedLine.length === 0) {
			return;
		}
		this.health.stdoutLines += 1;
		this.health.lastEventAt = new Date().toISOString();
		let envelope: OrcCanonicalEventEnvelope | undefined;
		try {
			envelope = JSON.parse(trimmedLine) as OrcCanonicalEventEnvelope;
		} catch (error) {
			this.noteParseFailure(
				"transport_parse_noise",
				`Failed to parse stdout JSONL line ${this.health.stdoutLines}.`,
				trimmedLine,
				line.byteLength,
				error instanceof Error ? error.message : String(error),
			);
			return;
		}
		if (!this.isCanonicalEnvelope(envelope)) {
			this.noteParseFailure(
				"transport_parse_noise",
				`Stdout line ${this.health.stdoutLines} decoded as JSON but did not satisfy the canonical envelope contract.`,
				trimmedLine,
				line.byteLength,
				"Missing required canonical envelope fields.",
			);
			return;
		}
		this.health.consecutiveParseFailures = 0;
		this.health.lastStdoutEventId = envelope.origin.eventId;
		this.health.lastStdoutSequence = envelope.origin.streamSequence;
		if (this.health.stage === "spawned") {
			this.health.stage = "ready";
			this.health.readyAt = this.health.lastEventAt;
			this.emitLifecycle({
				stage: "ready",
				at: this.health.readyAt,
				threadId: this.health.threadId,
				runCorrelationId: this.health.runCorrelationId,
				pid: this.health.pid,
				reason: envelope.what?.name,
			});
		}
		this.emitter.emit("envelope", envelope);
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
		this.emitter.emit("diagnostic", {
			at,
			stream: "stderr",
			threadId: this.health.threadId,
			runCorrelationId: this.health.runCorrelationId,
			line: normalizedLine,
			truncated,
		} satisfies OrcPythonTransportDiagnosticEvent);
	}

	private noteParseFailure(code: OrcTransportWarningCode, message: string, line: string, byteLength: number, detail: string): void {
		this.health.parseFailures += 1;
		this.health.consecutiveParseFailures += 1;
		this.health.lastErrorAt = this.health.lastEventAt;
		this.health.lastError = `${code}: ${detail}`;
		const payload = {
			stream: "stdout",
			warningCode: code,
			message: `${message} ${detail}`,
			lineSequence: this.health.stdoutLines,
			recoverable: true,
			linePreview: previewLine(line),
			lineBytes: byteLength,
			bufferedBytes: this.health.stdoutBufferedBytes,
			expectedSequenceHint: this.health.lastStdoutSequence === undefined ? undefined : this.health.lastStdoutSequence + 1,
			observedSequenceHint: extractObservedSequenceHint(line),
			stderrSnippets: this.recentStderr,
		};
		if (this.health.consecutiveParseFailures >= this.fatalParseFailureCount) {
			this.emitTransportFault("transport_corrupt_stream", "Repeated stdout parse failures crossed the fatal corruption threshold.", {
				...payload,
				retryable: true,
				failureThreshold: this.fatalParseFailureCount,
				consecutiveParseFailures: this.health.consecutiveParseFailures,
			});
			return;
		}
		this.emitTransportWarning(code, message, payload);
	}

	private flushResidualStream(stream: TransportStream, emitDecoderRemainder: boolean): void {
		const state = stream === "stdout" ? this.stdoutState : this.stderrState;
		if (emitDecoderRemainder) {
			state.buffer += state.decoder.end();
		} else {
			state.decoder.end();
		}
		state.bufferedBytes = Buffer.byteLength(state.buffer, "utf8");
		this.setBufferedBytes(stream, state.bufferedBytes);
		for (const line of this.drainTerminatedLines(state)) {
			if (stream === "stdout") {
				this.handleStdoutLine(line);
				continue;
			}
			this.handleStderrLine(line.text);
		}
		if (state.buffer.length === 0) {
			return;
		}
		const leftover = state.buffer;
		state.buffer = "";
		state.bufferedBytes = 0;
		this.setBufferedBytes(stream, 0);
		if (stream === "stdout") {
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
			return;
		}
		this.handleStderrLine(leftover);
	}

	private guardBuffer(stream: TransportStream): boolean {
		const state = stream === "stdout" ? this.stdoutState : this.stderrState;
		if (state.bufferedBytes <= this.maxBufferedBytes) {
			return true;
		}
		if (stream === "stderr") {
			state.buffer = state.buffer.slice(-Math.floor(this.maxBufferedBytes / 2));
			state.bufferedBytes = Buffer.byteLength(state.buffer, "utf8");
			this.setBufferedBytes(stream, state.bufferedBytes);
			this.health.diagnosticsDropped += 1;
			this.emitTransportWarning("transport_stderr_truncated", "Stderr buffer exceeded its byte budget and oldest diagnostic bytes were dropped.", {
				stream,
				bufferedBytes: state.bufferedBytes,
				maxBufferedBytes: this.maxBufferedBytes,
				stderrSnippets: this.recentStderr,
			});
			return true;
		}
		this.emitTransportFault("transport_stdout_overflow", "Stdout buffer exceeded its byte budget before a newline boundary was observed.", {
			stream,
			bufferedBytes: state.bufferedBytes,
			maxBufferedBytes: this.maxBufferedBytes,
			linePreview: previewLine(state.buffer),
			lineBytes: state.bufferedBytes,
			expectedSequenceHint: this.health.lastStdoutSequence === undefined ? undefined : this.health.lastStdoutSequence + 1,
			stderrSnippets: this.recentStderr,
			retryable: false,
		});
		return false;
	}

	private drainTerminatedLines(state: LineAssemblyState): AssembledLine[] {
		const lines: AssembledLine[] = [];
		let newlineIndex = state.buffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const text = state.buffer.slice(0, newlineIndex);
			const byteLength = Buffer.byteLength(text, "utf8");
			state.buffer = state.buffer.slice(newlineIndex + 1);
			state.bufferedBytes = Buffer.byteLength(state.buffer, "utf8");
			lines.push({ text, terminated: true, byteLength });
			newlineIndex = state.buffer.indexOf("\n");
		}
		return lines;
	}

	private startMonitors(): void {
		this.stopMonitors();
		this.monitorInterval = setInterval(() => {
			this.evaluateTransportTimeouts();
		}, 250);
		this.monitorInterval.unref?.();
	}

	private stopMonitors(): void {
		if (this.monitorInterval) {
			clearInterval(this.monitorInterval);
			this.monitorInterval = undefined;
		}
	}

	private evaluateTransportTimeouts(): void {
		if (!this.child) {
			return;
		}
		const now = Date.now();
		const lastProgressAt = this.health.timeouts.lastProgressAt ? Date.parse(this.health.timeouts.lastProgressAt) : now;
		const silenceMs = now - lastProgressAt;
		if (!this.health.readyAt && now - Date.parse(this.health.spawnedAt ?? this.health.timeouts.lastProgressAt ?? new Date(now).toISOString()) >= this.readyTimeoutMs && !this.health.timeouts.lastReadyTimeoutAt) {
			this.health.timeouts.lastReadyTimeoutAt = new Date(now).toISOString();
			this.emitTransportFault("transport_ready_timeout", "Python runner failed to emit a valid envelope before the ready timeout elapsed.", {
				stream: "stdout",
				readyTimeoutMs: this.readyTimeoutMs,
				silenceMs,
				bufferedBytes: this.health.stdoutBufferedBytes,
				stderrSnippets: this.recentStderr,
				retryable: true,
			});
		}
		if (silenceMs >= this.stallTimeoutMs && !this.health.timeouts.lastStallFaultAt) {
			this.health.timeouts.lastStallFaultAt = new Date(now).toISOString();
			this.emitTransportFault("transport_stall_timeout", "Python runner exceeded the fatal stall timeout without stdout/stderr progress.", {
				stream: "stdout",
				idleWarningMs: this.idleWarningMs,
				stallTimeoutMs: this.stallTimeoutMs,
				silenceMs,
				lastStdoutChunkAt: this.health.timeouts.lastStdoutChunkAt,
				lastStderrChunkAt: this.health.timeouts.lastStderrChunkAt,
				stderrSnippets: this.recentStderr,
				retryable: true,
			});
			return;
		}
		if (silenceMs >= this.idleWarningMs) {
			const lastIdleWarningAt = this.health.timeouts.lastIdleWarningAt ? Date.parse(this.health.timeouts.lastIdleWarningAt) : 0;
			if (now - lastIdleWarningAt >= this.idleWarningMs) {
				this.health.timeouts.lastIdleWarningAt = new Date(now).toISOString();
				this.emitTransportWarning("transport_idle_timeout", "Python runner has been idle longer than the warning threshold but remains within the recoverable window.", {
					stream: "stdout",
					idleWarningMs: this.idleWarningMs,
					stallTimeoutMs: this.stallTimeoutMs,
					silenceMs,
					lastStdoutChunkAt: this.health.timeouts.lastStdoutChunkAt,
					lastStderrChunkAt: this.health.timeouts.lastStderrChunkAt,
					stderrSnippets: this.recentStderr,
					recoverable: true,
				});
			}
		}
	}

	private emitTransportWarning(code: OrcTransportWarningCode, message: string, rawPayload: Record<string, unknown>): void {
		const rule = classifyOrcTransportIssue(code);
		const at = new Date().toISOString();
		this.health.warningEvents += 1;
		const status: "degraded" | "faulted" | "offline" =
			rule.defaultStatus === "faulted" || rule.defaultStatus === "offline" ? rule.defaultStatus : "degraded";
		this.health.status = this.health.status === "faulted" ? "faulted" : status;
		this.health.lastErrorAt = at;
		this.health.lastError = `${code}: ${message}`;
		this.health.lastEventAt = at;
		this.emitter.emit("envelope", this.buildTransportEnvelope("stream.warning", code, message, status, rawPayload));
	}

	private emitTransportFault(code: OrcTransportFaultCode, message: string, rawPayload: Record<string, unknown>): void {
		const statusKey = String(rawPayload.status ?? "unknown");
		const dedupeKey = `${code}:${statusKey}:${String(rawPayload.signal ?? "none")}:${String(rawPayload.exitCode ?? "none")}:${String(rawPayload.syscall ?? "none")}`;
		if (this.emittedFaultKeys.has(dedupeKey)) {
			return;
		}
		this.emittedFaultKeys.add(dedupeKey);
		const rule = classifyOrcTransportIssue(code);
		const at = new Date().toISOString();
		this.health.faultEvents += 1;
		this.health.status = rule.defaultStatus === "offline" ? "offline" : "faulted";
		this.health.lastErrorAt = at;
		this.health.lastError = `${code}: ${message}`;
		this.health.lastEventAt = at;
		const status: "degraded" | "faulted" | "offline" =
			rule.defaultStatus === "degraded" || rule.defaultStatus === "offline" ? rule.defaultStatus : "faulted";
		this.emitter.emit("envelope", this.buildTransportEnvelope("transport.fault", code, message, status, rawPayload));
	}

	private buildTransportEnvelope(
		kind: "stream.warning" | "transport.fault",
		code: OrcTransportWarningCode | OrcTransportFaultCode,
		message: string,
		status: "degraded" | "faulted" | "offline",
		rawPayload: Record<string, unknown>,
	): OrcCanonicalEventEnvelope<Record<string, unknown>> {
		const now = new Date().toISOString();
		const isWarning = kind === "stream.warning";
		const disposition = !isWarning ? classifyOrcFailureDisposition(code as OrcTransportFaultCode) : undefined;
		return {
			origin: {
				runCorrelationId: this.health.runCorrelationId ?? `orc-run-${randomUUID()}`,
				eventId: `transport-${randomUUID()}`,
				streamSequence: (this.health.lastStdoutSequence ?? this.health.stdoutLines) + 1,
				emittedAt: now,
				source: "orc_runtime",
				threadId: this.health.threadId,
				phase: "phase-2-transport-recovery",
			},
			who: {
				kind: "transport",
				id: this.health.pid ? `python-transport-${this.health.pid}` : "python-transport",
				label: "Python transport supervisor",
				runCorrelationId: this.health.runCorrelationId,
			},
			what: {
				category: "transport",
				name: code,
				description: message,
				severity: isWarning ? "warning" : "error",
				status: isWarning ? "streaming" : "failed",
			},
			how: {
				channel: "event_bus",
				interactionTarget: "computer",
				environment: "transport",
				transport: "python_child_process",
			},
			when: now,
			rawPayload: {
				namespace: "orc.transport.supervisor",
				payload: {
					eventKind: kind,
					code: code,
					message,
					status,
					remediationHint: disposition?.remediationHint,
					retryability: disposition?.retryability,
					pid: this.health.pid,
					warningCode: isWarning ? code : undefined,
					faultCode: isWarning ? undefined : code,
					threadId: this.health.threadId,
					runCorrelationId: this.health.runCorrelationId,
					lineSequence: this.health.stdoutLines,
					chunkSequence: this.health.stdoutLines + this.health.stderrLines,
					...rawPayload,
				},
			},
		};
	}

	private recordStreamProgress(stream: TransportStream): void {
		const at = new Date().toISOString();
		this.health.lastEventAt = at;
		this.health.timeouts.lastProgressAt = at;
		if (stream === "stdout") {
			this.health.timeouts.lastStdoutChunkAt = at;
			return;
		}
		this.health.timeouts.lastStderrChunkAt = at;
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

	private setBufferedBytes(stream: TransportStream, value: number): void {
		if (stream === "stdout") {
			this.health.stdoutBufferedBytes = value;
			return;
		}
		this.health.stderrBufferedBytes = value;
	}

	private isCanonicalEnvelope(value: unknown): value is OrcCanonicalEventEnvelope {
		if (!value || typeof value !== "object") {
			return false;
		}
		const envelope = value as OrcCanonicalEventEnvelope;
		return Boolean(
			envelope.origin?.eventId &&
				typeof envelope.origin.eventId === "string" &&
				envelope.origin.runCorrelationId &&
				typeof envelope.origin.runCorrelationId === "string" &&
				typeof envelope.origin.streamSequence === "number" &&
				typeof envelope.origin.emittedAt === "string" &&
				envelope.who?.id &&
				typeof envelope.who.id === "string" &&
				envelope.what?.name &&
				typeof envelope.what.name === "string" &&
				envelope.what?.category &&
				typeof envelope.what.category === "string" &&
				envelope.how?.channel &&
				typeof envelope.how.channel === "string" &&
				typeof envelope.when === "string",
		);
	}

	private emitLifecycle(event: OrcPythonTransportLifecycleEvent): void {
		this.emitter.emit("lifecycle", event);
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

function previewLine(value: string, max = 160): string {
	return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function extractObservedSequenceHint(line: string): number | undefined {
	const match = line.match(/"streamSequence"\s*:\s*(\d+)/u);
	return match ? Number(match[1]) : undefined;
}

export function defaultBuildPythonRunnerSpawnContract(input: OrcRunnerLaunchInput): OrcPythonRunnerSpawnContract {
	return {
		command: "python3",
		args: ["-m", "src.orchestration.python.orc_runner"],
		cwd: input.workspaceRoot,
		stdinPayload: input,
		stdoutProtocol: "jsonl",
		stderrProtocol: "diagnostic_text",
	};
}

