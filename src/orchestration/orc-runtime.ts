import type {
	EnumerateOrcArtifactsRequest,
	EnumerateOrcArtifactsResponse,
	LaunchOrcRequest,
	LaunchOrcResponse,
	LoadOrcTrackerStateRequest,
	LoadOrcTrackerStateResponse,
	ResumeOrcThreadRequest,
	ResumeOrcThreadResponse,
} from "./orc-io.js";

/**
 * Construction-time dependencies for the future orchestration runtime.
 * The factories are intentionally opaque in Phase 1 so the implementation can
 * later bind to LangGraph and DeepAgents without exposing unstable SDK types.
 */
export interface OrcRuntimeAdapters {
	createLangGraph?: () => Promise<unknown> | unknown;
	initializeDeepAgents?: () => Promise<unknown> | unknown;
}

export interface OrcRuntime {
	launch(request: LaunchOrcRequest): Promise<LaunchOrcResponse>;
	loadTrackerState(request: LoadOrcTrackerStateRequest): Promise<LoadOrcTrackerStateResponse>;
	enumerateArtifacts(request: EnumerateOrcArtifactsRequest): Promise<EnumerateOrcArtifactsResponse>;
	resumeThread(request: ResumeOrcThreadRequest): Promise<ResumeOrcThreadResponse>;
}

/**
 * Phase 1 placeholder runtime that defines the adapter boundary but does not
 * implement orchestration behavior yet.
 */
export class OrcRuntimeSkeleton implements OrcRuntime {
	constructor(readonly adapters: OrcRuntimeAdapters = {}) {}

	async launch(_request: LaunchOrcRequest): Promise<LaunchOrcResponse> {
		throw new Error("Orc runtime launch is not implemented yet.");
	}

	async loadTrackerState(_request: LoadOrcTrackerStateRequest): Promise<LoadOrcTrackerStateResponse> {
		return { found: false };
	}

	async enumerateArtifacts(_request: EnumerateOrcArtifactsRequest): Promise<EnumerateOrcArtifactsResponse> {
		return { entries: [] };
	}

	async resumeThread(_request: ResumeOrcThreadRequest): Promise<ResumeOrcThreadResponse> {
		throw new Error("Orc runtime resume is not implemented yet.");
	}
}
