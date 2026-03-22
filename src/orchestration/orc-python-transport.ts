import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
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
	lastStdoutEventId?: string;
	lastStderrLine?: string;
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

export class OrcPythonChildProcessTransport implements OrcPythonTransport {
	private readonly emitter = new EventEmitter();
	private readonly buildSpawnContract: (input: OrcRunnerLaunchInput) => OrcPythonRunnerSpawnContract;
	private readonly maxBufferedBytes: number;
	private readonly maxDiagnosticLineLength: number;
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
	};
	private stdoutRemainder = "";
	private stderrRemainder = "";
	private cleanupCallbacks: Array<() => void> = [];
	private exitPromise?: Promise<void>;
	private resolveExitPromise?: () => void;
	private activeTerminationReason?: string;

	constructor(options: OrcPythonTransportOptions = {}) {
		this.buildSpawnContract = options.buildSpawnContract ?? defaultBuildPythonRunnerSpawnContract;
		this.maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
		this.maxDiagnosticLineLength = options.maxDiagnosticLineLength ?? DEFAULT_MAX_DIAGNOSTIC_LINE_LENGTH;
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
		};
		this.stdoutRemainder = "";
		this.stderrRemainder = "";
		this.activeTerminationReason = undefined;
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
		this.emitLifecycle({
			stage: "spawned",
			at: spawnedAt,
			threadId: launchInput.threadId,
			runCorrelationId: launchInput.runCorrelationId,
			pid: child.pid,
		});

		const onStdoutData = (chunk: Buffer) => {
			this.processStdoutChunk(chunk);
		};
		const onStderrData = (chunk: Buffer) => {
			this.processStderrChunk(chunk);
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
		const onExit = (exitCode: number | null, signal: NodeJS.Signals | null) => {
			const at = new Date().toISOString();
			const terminatedBySignal = Boolean(signal);
			this.flushBufferedStream("stdout");
			this.flushBufferedStream("stderr");
			this.health.exitedAt = at;
			this.health.lastEventAt = at;
			this.health.lastExitCode = exitCode;
			this.health.lastSignal = signal;
			this.health.stage = terminatedBySignal ? "terminated" : "exited";
			this.health.status = exitCode === 0 && !terminatedBySignal ? "offline" : this.health.status === "faulted" ? "faulted" : "offline";
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

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", onStdoutData);
		child.stderr.on("data", onStderrData);
		child.once("error", onError);
		child.once("exit", onExit);
		this.cleanupCallbacks = [
			() => child.stdout.off("data", onStdoutData),
			() => child.stderr.off("data", onStderrData),
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

	private processStdoutChunk(chunk: Buffer): void {
		const text = chunk.toString("utf8");
		this.stdoutRemainder += text;
		this.health.stdoutBufferedBytes = Buffer.byteLength(this.stdoutRemainder, "utf8");
		this.guardBuffer("stdout");
		let newlineIndex = this.stdoutRemainder.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = this.stdoutRemainder.slice(0, newlineIndex).trim();
			this.stdoutRemainder = this.stdoutRemainder.slice(newlineIndex + 1);
			if (line.length > 0) {
				this.handleStdoutLine(line);
			}
			newlineIndex = this.stdoutRemainder.indexOf("\n");
		}
		this.health.stdoutBufferedBytes = Buffer.byteLength(this.stdoutRemainder, "utf8");
	}

	private processStderrChunk(chunk: Buffer): void {
		const text = chunk.toString("utf8");
		this.stderrRemainder += text;
		this.health.stderrBufferedBytes = Buffer.byteLength(this.stderrRemainder, "utf8");
		this.guardBuffer("stderr");
		let newlineIndex = this.stderrRemainder.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = this.stderrRemainder.slice(0, newlineIndex);
			this.stderrRemainder = this.stderrRemainder.slice(newlineIndex + 1);
			this.handleStderrLine(line);
			newlineIndex = this.stderrRemainder.indexOf("\n");
		}
		this.health.stderrBufferedBytes = Buffer.byteLength(this.stderrRemainder, "utf8");
	}

	private handleStdoutLine(line: string): void {
		this.health.stdoutLines += 1;
		this.health.lastEventAt = new Date().toISOString();
		let envelope: OrcCanonicalEventEnvelope;
		try {
			envelope = JSON.parse(line) as OrcCanonicalEventEnvelope;
		} catch (error) {
			this.health.status = "degraded";
			this.health.lastErrorAt = this.health.lastEventAt;
			this.health.lastError = `invalid stdout JSONL: ${error instanceof Error ? error.message : String(error)}`;
			return;
		}
		this.health.lastStdoutEventId = envelope.origin?.eventId;
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
		if (truncated) {
			this.health.diagnosticsDropped += 1;
			this.health.status = "degraded";
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

	private flushBufferedStream(stream: "stdout" | "stderr"): void {
		if (stream === "stdout" && this.stdoutRemainder.trim().length > 0) {
			const buffered = this.stdoutRemainder.trim();
			this.stdoutRemainder = "";
			this.handleStdoutLine(buffered);
			return;
		}
		if (stream === "stderr" && this.stderrRemainder.length > 0) {
			const buffered = this.stderrRemainder;
			this.stderrRemainder = "";
			this.handleStderrLine(buffered);
		}
	}

	private guardBuffer(stream: "stdout" | "stderr"): void {
		const value = stream === "stdout" ? this.stdoutRemainder : this.stderrRemainder;
		const size = Buffer.byteLength(value, "utf8");
		if (size <= this.maxBufferedBytes) {
			return;
		}
		this.health.status = "degraded";
		if (stream === "stdout") {
			this.stdoutRemainder = value.slice(-Math.floor(this.maxBufferedBytes / 2));
			this.health.stdoutBufferedBytes = Buffer.byteLength(this.stdoutRemainder, "utf8");
			return;
		}
		this.stderrRemainder = value.slice(-Math.floor(this.maxBufferedBytes / 2));
		this.health.stderrBufferedBytes = Buffer.byteLength(this.stderrRemainder, "utf8");
		this.health.diagnosticsDropped += 1;
	}

	private emitLifecycle(event: OrcPythonTransportLifecycleEvent): void {
		this.emitter.emit("lifecycle", event);
	}

	private detachChild(): void {
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
