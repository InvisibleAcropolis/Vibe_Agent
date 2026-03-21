import type { DurableRecordMetadata } from "../record-metadata.js";

export interface MemoryStoreRecord extends DurableRecordMetadata {
	storeType: string;
	displayName: string;
	description?: string;
	format?: string;
	retentionPolicy?: string;
}

export interface MemoryStoreManifest {
	id?: string;
	name?: string;
	description?: string;
	storeType?: string;
	format?: string;
	retentionPolicy?: string;
	tags?: string[];
}

export class MemoryStoreService {
	private readonly records = new Map<string, MemoryStoreRecord>();

	registerManifest(input: {
		ownerRuntimeId: string;
		sourcePath: string;
		manifest: MemoryStoreManifest;
		sessionId?: string;
	}): MemoryStoreRecord {
		const timestamp = new Date().toISOString();
		const id = input.manifest.id ?? `${input.ownerRuntimeId}:memory:${input.sourcePath}`;
		const existing = this.records.get(id);
		const record: MemoryStoreRecord = {
			id,
			kind: "memory-store",
			ownerRuntimeId: input.ownerRuntimeId,
			sessionId: input.sessionId,
			sourcePath: input.sourcePath,
			createdAt: existing?.createdAt ?? timestamp,
			updatedAt: timestamp,
			status: "ready",
			tags: [...new Set(["memory", ...(input.manifest.tags ?? [])])],
			storeType: input.manifest.storeType ?? "generic",
			displayName: input.manifest.name ?? input.sourcePath,
			description: input.manifest.description,
			format: input.manifest.format,
			retentionPolicy: input.manifest.retentionPolicy,
		};
		this.records.set(record.id, record);
		return record;
	}

	list(): MemoryStoreRecord[] {
		return [...this.records.values()];
	}

	clear(): void {
		this.records.clear();
	}
}
