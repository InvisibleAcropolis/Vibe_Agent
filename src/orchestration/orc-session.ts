import type { OrcControlPlaneState } from "./orc-state.js";
import type { OrcSecurityPolicy } from "./orc-security.js";

/**
 * In-memory session handle for a single orchestration thread.
 */
export interface OrcSession {
	threadId: string;
	checkpointId?: string;
	/**
	 * Placeholder security snapshot threaded through the session factory.
	 * Future worker launch code should read this from the session rather than reconstructing policy ad hoc.
	 */
	securityPolicy?: OrcSecurityPolicy;
	getState(): OrcControlPlaneState | undefined;
}

export class OrcSessionHandle implements OrcSession {
	constructor(
		readonly threadId: string,
		private readonly state?: OrcControlPlaneState,
		readonly checkpointId?: string,
		readonly securityPolicy?: OrcSecurityPolicy,
	) {}

	getState(): OrcControlPlaneState | undefined {
		return this.state;
	}
}
