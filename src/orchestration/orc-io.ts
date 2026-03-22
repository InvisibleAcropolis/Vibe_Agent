import type { OrcControlPlaneState, OrcProjectContext } from "./orc-state.js";

export interface LaunchOrcRequest {
	project: OrcProjectContext;
	prompt: string;
	resumeThreadId?: string;
	resumeCheckpointId?: string;
}

export interface LaunchOrcResponse {
	threadId: string;
	checkpointId?: string;
	state: OrcControlPlaneState;
}

export interface LoadOrcTrackerStateRequest {
	threadId: string;
	checkpointId?: string;
}

export interface LoadOrcTrackerStateResponse {
	state?: OrcControlPlaneState;
	found: boolean;
}

export type OrcArtifactKind = "artifact" | "log";

export interface OrcArtifactLogEntry {
	id: string;
	kind: OrcArtifactKind;
	label: string;
	sourcePath: string;
	createdAt?: string;
	workerId?: string;
	waveId?: string;
}

export interface EnumerateOrcArtifactsRequest {
	threadId: string;
	checkpointId?: string;
	kind?: OrcArtifactKind | "all";
}

export interface EnumerateOrcArtifactsResponse {
	entries: OrcArtifactLogEntry[];
}

export interface ResumeOrcThreadRequest {
	threadId: string;
	checkpointId?: string;
}

export interface ResumeOrcThreadResponse {
	threadId: string;
	checkpointId?: string;
	state?: OrcControlPlaneState;
}
