import type { OrcControlPlaneState } from "./orc-state.js";

/**
 * In-memory session handle for a single orchestration thread.
 */
export interface OrcSession {
	threadId: string;
	checkpointId?: string;
	getState(): OrcControlPlaneState | undefined;
}

export class OrcSessionHandle implements OrcSession {
	constructor(
		readonly threadId: string,
		private readonly state?: OrcControlPlaneState,
		readonly checkpointId?: string,
	) {}

	getState(): OrcControlPlaneState | undefined {
		return this.state;
	}
}
