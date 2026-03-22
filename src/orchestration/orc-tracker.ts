import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { ensureParentDir, getVibeTrackerPath, type VibeDurablePathOptions } from "../durable/durable-paths.js";
import type { OrcCheckpointStore } from "./orc-checkpoints.js";
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


export class FileSystemOrcTracker implements OrcTracker {
	constructor(
		private readonly checkpoints: OrcCheckpointStore = {
			loadManifest: async () => undefined,
			loadCheckpoint: async () => undefined,
			listCheckpoints: async () => [],
			saveCheckpoint: async (write) => ({
				thread: write.metadata.thread,
				latestCheckpointId: write.metadata.checkpointId,
				checkpointHistory: [write.metadata.checkpointId],
				rewindTargetIds: write.metadata.rewindTargetIds,
				artifactBundleIds: write.metadata.artifactBundleIds,
				checkpoints: { [write.metadata.checkpointId]: write.metadata },
				updatedAt: write.metadata.createdAt,
			}),
		},
		private readonly options?: VibeDurablePathOptions,
	) {}

	async load(threadId: string, checkpointId?: string): Promise<OrcControlPlaneState | undefined> {
		const targetCheckpointId = checkpointId ?? (await this.checkpoints.loadManifest(threadId))?.latestCheckpointId;
		if (!targetCheckpointId) {
			return undefined;
		}
		const filePath = this.getSnapshotPath(threadId, targetCheckpointId);
		if (!existsSync(filePath)) {
			return undefined;
		}
		return JSON.parse(readFileSync(filePath, "utf8")) as OrcControlPlaneState;
	}

	async save(state: OrcControlPlaneState): Promise<void> {
		const checkpointId = state.checkpointId;
		if (!checkpointId) {
			return;
		}
		const filePath = this.getSnapshotPath(state.threadId, checkpointId);
		ensureParentDir(filePath);
		const tempPath = `${filePath}.tmp`;
		writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
		renameSync(tempPath, filePath);
	}

	private getSnapshotPath(threadId: string, checkpointId: string): string {
		return getVibeTrackerPath(`${encodeURIComponent(threadId)}--${encodeURIComponent(checkpointId)}.json`, this.options);
	}
}
