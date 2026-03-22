export type DurableRecordStatus = "ready" | "active" | "stale" | "error";

export interface DurableOrchestrationOwnership {
	runtimeId: string;
	sessionId?: string;
	threadId?: string;
	phase?: string;
	waveNumber?: number;
	sourcePath?: string;
}

export interface DurableRecordMetadata {
	id: string;
	kind: string;
	ownerRuntimeId: string;
	sessionId?: string;
	threadId?: string;
	phase?: string;
	waveNumber?: number;
	sourcePath?: string;
	createdAt: string;
	updatedAt: string;
	status: DurableRecordStatus;
	tags: string[];
	orchestration: DurableOrchestrationOwnership;
}
