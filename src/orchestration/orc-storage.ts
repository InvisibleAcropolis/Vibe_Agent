import type { OrcArtifactLogEntry } from "./orc-io.js";

/**
 * Storage boundary for orchestration artifacts, logs, and checkpoints.
 */
export interface OrcStorage {
	listArtifacts(threadId: string, checkpointId?: string): Promise<OrcArtifactLogEntry[]>;
	listLogs(threadId: string, checkpointId?: string): Promise<OrcArtifactLogEntry[]>;
}

export class NoopOrcStorage implements OrcStorage {
	async listArtifacts(_threadId: string, _checkpointId?: string): Promise<OrcArtifactLogEntry[]> {
		return [];
	}

	async listLogs(_threadId: string, _checkpointId?: string): Promise<OrcArtifactLogEntry[]> {
		return [];
	}
}
