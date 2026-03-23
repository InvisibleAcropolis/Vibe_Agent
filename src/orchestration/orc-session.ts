import type { OrcControlPlaneState } from "./orc-state.js";
import type { OrcSecurityPolicy } from "./orc-security.js";
import type { OrcEventBusSnapshot } from "./orc-event-bus.js";
import type { OrcPythonTransportHealth } from "./orc-python-transport.js";

/**
 * In-memory session handle for a single orchestration thread.
 */
export interface OrcSessionRuntimeHooks {
	cancel(reason?: string): Promise<void>;
	shutdown(reason?: string): Promise<void>;
	getTransportHealth(): OrcPythonTransportHealth | undefined;
	getEventBusSnapshot(): OrcEventBusSnapshot | undefined;
}

export interface OrcSession {
	threadId: string;
	checkpointId?: string;
	/**
	 * Placeholder security snapshot threaded through the session factory.
	 * Future worker launch code should read this from the session rather than reconstructing policy ad hoc.
	 */
	securityPolicy?: OrcSecurityPolicy;
	runCorrelationId?: string;
	getState(): OrcControlPlaneState | undefined;
	updateState(state: OrcControlPlaneState): void;
	getRuntimeHooks(): OrcSessionRuntimeHooks | undefined;
	attachRuntimeHooks(hooks: OrcSessionRuntimeHooks): void;
}

export class OrcSessionHandle implements OrcSession {
	private state?: OrcControlPlaneState;
	private runtimeHooks?: OrcSessionRuntimeHooks;

	constructor(
		readonly threadId: string,
		state?: OrcControlPlaneState,
		readonly checkpointId?: string,
		readonly securityPolicy?: OrcSecurityPolicy,
		readonly runCorrelationId?: string,
	) {
		this.state = state;
	}

	getState(): OrcControlPlaneState | undefined {
		return this.state;
	}

	updateState(state: OrcControlPlaneState): void {
		this.state = state;
	}

	getRuntimeHooks(): OrcSessionRuntimeHooks | undefined {
		return this.runtimeHooks;
	}

	attachRuntimeHooks(hooks: OrcSessionRuntimeHooks): void {
		this.runtimeHooks = hooks;
	}
}
