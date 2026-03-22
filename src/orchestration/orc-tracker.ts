import type { OrcControlPlaneState } from "./orc-state.js";

/**
 * Tracker abstraction for persisting and restoring control-plane snapshots.
 */
export interface OrcTracker {
	load(threadId: string, checkpointId?: string): Promise<OrcControlPlaneState | undefined>;
	save(state: OrcControlPlaneState): Promise<void>;
}

export class NoopOrcTracker implements OrcTracker {
	async load(_threadId: string, _checkpointId?: string): Promise<OrcControlPlaneState | undefined> {
		return undefined;
	}

	async save(_state: OrcControlPlaneState): Promise<void> {}
}
