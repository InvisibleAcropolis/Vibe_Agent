export type OrcLifecyclePhase =
	| "idle"
	| "bootstrapping"
	| "planning"
	| "dispatching"
	| "executing"
	| "verifying"
	| "checkpointed"
	| "completed"
	| "failed"
	| "cancelled";

export type OrcMessageRole = "system" | "orchestrator" | "worker" | "user" | "tool";

/**
 * Normalized control-plane message emitted by the orchestration layer.
 * Phase 1 keeps the payload intentionally generic so the runtime can adopt
 * LangGraph or DeepAgents-native message envelopes later without breaking
 * consumers that only need stable metadata.
 */
export interface OrcOrchestratorMessage {
	id: string;
	role: OrcMessageRole;
	phase: OrcLifecyclePhase;
	createdAt: string;
	content: string;
	waveId?: string;
	workerId?: string;
	metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Stable project metadata required to bootstrap an orchestration thread.
 */
export interface OrcProjectContext {
	projectId: string;
	projectRoot: string;
	projectName?: string;
	branchName?: string;
	taskLabel?: string;
	workspaceDigest?: string;
	metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Describes the currently active parallel execution wave.
 */
export interface OrcActiveExecutionWave {
	waveId: string;
	phase: Extract<OrcLifecyclePhase, "dispatching" | "executing" | "verifying">;
	startedAt: string;
	checkpointId?: string;
	workerCount: number;
	workerIds: string[];
	goal?: string;
}

export type OrcWorkerResultStatus = "pending" | "completed" | "failed" | "cancelled";

/**
 * Result summary for one worker participating in an orchestration wave.
 */
export interface OrcParallelWorkerResult {
	workerId: string;
	waveId: string;
	status: OrcWorkerResultStatus;
	summary?: string;
	artifactIds: string[];
	logIds: string[];
	startedAt?: string;
	finishedAt?: string;
	errorMessage?: string;
	metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Verification issues recorded after execution completes.
 */
export interface OrcVerificationError {
	code: string;
	message: string;
	severity: "warning" | "error";
	source?: "build" | "test" | "lint" | "review" | "runtime";
	workerId?: string;
	artifactId?: string;
	logId?: string;
}

/**
 * Minimal snapshot shape for the orchestration control plane.
 */
export interface OrcControlPlaneState {
	threadId: string;
	checkpointId?: string;
	phase: OrcLifecyclePhase;
	project: OrcProjectContext;
	messages: OrcOrchestratorMessage[];
	activeWave?: OrcActiveExecutionWave;
	workerResults: OrcParallelWorkerResult[];
	verificationErrors: OrcVerificationError[];
	lastUpdatedAt: string;
}
