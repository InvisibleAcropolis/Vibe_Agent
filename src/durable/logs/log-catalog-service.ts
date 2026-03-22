import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { ensureParentDir, getVibeLogCatalogPath, type VibeDurablePathOptions } from "../durable-paths.js";
import type { DurableRecordMetadata } from "../record-metadata.js";

export interface LogRecord extends DurableRecordMetadata {
	logType: string;
	label: string;
	reason?: string;
}

export class LogCatalogService {
	private readonly records = new Map<string, LogRecord>();
	private readonly catalogPath: string;

	constructor(options?: VibeDurablePathOptions) {
		this.catalogPath = getVibeLogCatalogPath(options);
		this.load();
	}

	registerLog(input: {
		id?: string;
		ownerRuntimeId: string;
		sourcePath: string;
		logType: string;
		label: string;
		reason?: string;
		sessionId?: string;
		threadId?: string;
		phase?: string;
		waveNumber?: number;
		tags?: string[];
		status?: LogRecord["status"];
	}): LogRecord {
		const timestamp = new Date().toISOString();
		const id = input.id ?? `${input.ownerRuntimeId}:log:${input.sourcePath}:${input.logType}`;
		const existing = this.records.get(id);
		const record: LogRecord = {
			id,
			kind: "log",
			ownerRuntimeId: input.ownerRuntimeId,
			sessionId: input.sessionId,
			threadId: input.threadId,
			phase: input.phase,
			waveNumber: input.waveNumber,
			sourcePath: input.sourcePath,
			createdAt: existing?.createdAt ?? timestamp,
			updatedAt: timestamp,
			status: input.status ?? "ready",
			tags: [...new Set(["log", input.logType, ...(input.tags ?? [])])],
			orchestration: {
				runtimeId: input.ownerRuntimeId,
				sessionId: input.sessionId,
				threadId: input.threadId,
				phase: input.phase,
				waveNumber: input.waveNumber,
				sourcePath: input.sourcePath,
			},
			logType: input.logType,
			label: input.label,
			reason: input.reason,
		};
		this.records.set(record.id, record);
		this.persist();
		return record;
	}

	list(): LogRecord[] {
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
			const parsed = JSON.parse(readFileSync(this.catalogPath, "utf8")) as { records?: LogRecord[] };
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
