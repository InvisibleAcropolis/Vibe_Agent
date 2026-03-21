export type DurableRecordStatus = "ready" | "active" | "stale" | "error";

export interface DurableRecordMetadata {
	id: string;
	kind: string;
	ownerRuntimeId: string;
	sessionId?: string;
	sourcePath?: string;
	createdAt: string;
	updatedAt: string;
	status: DurableRecordStatus;
	tags: string[];
}
