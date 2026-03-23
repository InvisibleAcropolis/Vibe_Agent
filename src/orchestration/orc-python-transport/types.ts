import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { StringDecoder } from "node:string_decoder";
import type { OrcDebugArtifactsWriter } from "../orc-debug.js";
import type { OrcCanonicalEventEnvelope, OrcPythonRunnerSpawnContract, OrcRunnerLaunchInput } from "../orc-io.js";

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
	debugArtifactsWriter?: OrcDebugArtifactsWriter;
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

export const DEFAULT_MAX_BUFFERED_BYTES = 64 * 1024;
export const DEFAULT_MAX_DIAGNOSTIC_LINE_LENGTH = 4000;
export const DEFAULT_IDLE_WARNING_MS = 5_000;
export const DEFAULT_STALL_TIMEOUT_MS = 15_000;
export const DEFAULT_READY_TIMEOUT_MS = 10_000;
export const DEFAULT_CORRELATED_STDERR_HISTORY = 5;
export const DEFAULT_FATAL_PARSE_FAILURE_COUNT = 3;

export type TransportStream = "stdout" | "stderr";

export interface AssembledLine {
	text: string;
	terminated: boolean;
	byteLength: number;
}

export interface LineAssemblyState {
	stream: TransportStream;
	decoder: StringDecoder;
	buffer: string;
	bufferedBytes: number;
}

export interface StderrSnippet {
	at: string;
	line: string;
	truncated: boolean;
}

export interface TransportSupervisorContext {
	child?: ChildProcessWithoutNullStreams;
	health: OrcPythonTransportHealth;
	recentStderr: StderrSnippet[];
	idleWarningMs: number;
	stallTimeoutMs: number;
	readyTimeoutMs: number;
	emitTransportWarning: (code: any, message: string, payload: Record<string, unknown>) => void;
	emitTransportFault: (code: any, message: string, payload: Record<string, unknown>) => void;
}
