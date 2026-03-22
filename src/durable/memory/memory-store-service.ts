import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { ensureParentDir, getVibeMemoryCatalogPath, type VibeDurablePathOptions } from "../durable-paths.js";
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
	private readonly catalogPath: string;

	constructor(options?: VibeDurablePathOptions) {
		this.catalogPath = getVibeMemoryCatalogPath(options);
		this.load();
	}

	registerManifest(input: {
		ownerRuntimeId: string;
		sourcePath: string;
		manifest: MemoryStoreManifest;
		sessionId?: string;
		threadId?: string;
		phase?: string;
		waveNumber?: number;
	}): MemoryStoreRecord {
		const timestamp = new Date().toISOString();
		const id = input.manifest.id ?? `${input.ownerRuntimeId}:memory:${input.sourcePath}`;
		const existing = this.records.get(id);
		const record: MemoryStoreRecord = {
			id,
			kind: "memory-store",
			ownerRuntimeId: input.ownerRuntimeId,
			sessionId: input.sessionId,
			threadId: input.threadId,
			phase: input.phase,
			waveNumber: input.waveNumber,
			sourcePath: input.sourcePath,
			createdAt: existing?.createdAt ?? timestamp,
			updatedAt: timestamp,
			status: "ready",
			tags: [...new Set(["memory", ...(input.manifest.tags ?? [])])],
			orchestration: {
				runtimeId: input.ownerRuntimeId,
				sessionId: input.sessionId,
				threadId: input.threadId,
				phase: input.phase,
				waveNumber: input.waveNumber,
				sourcePath: input.sourcePath,
			},
			storeType: input.manifest.storeType ?? "generic",
			displayName: input.manifest.name ?? input.sourcePath,
			description: input.manifest.description,
			format: input.manifest.format,
			retentionPolicy: input.manifest.retentionPolicy,
		};
		this.records.set(record.id, record);
		this.persist();
		return record;
	}

	list(): MemoryStoreRecord[] {
		return [...this.records.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
	}

	clear(): void {
		this.records.clear();
		this.persist();
	}

	private load(): void {
		if (!existsSync(this.catalogPath)) {
			return;
		}
		try {
			const parsed = JSON.parse(readFileSync(this.catalogPath, "utf8")) as { records?: MemoryStoreRecord[] };
			for (const record of Array.isArray(parsed.records) ? parsed.records : []) {
				this.records.set(record.id, record);
			}
		} catch {
			// Treat malformed catalogs as empty so startup can recover.
		}
	}

	private persist(): void {
		ensureParentDir(this.catalogPath);
		const tempPath = `${this.catalogPath}.tmp`;
		writeFileSync(tempPath, `${JSON.stringify({ version: 1, records: this.list() }, null, 2)}\n`, "utf8");
		renameSync(tempPath, this.catalogPath);
	}
}
