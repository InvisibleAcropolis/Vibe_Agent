import type { DurableRecordMetadata } from "../record-metadata.js";

export interface LogRecord extends DurableRecordMetadata {
	logType: string;
	label: string;
	reason?: string;
}

export class LogCatalogService {
	private readonly records = new Map<string, LogRecord>();

	registerLog(input: {
		id?: string;
		ownerRuntimeId: string;
		sourcePath: string;
		logType: string;
		label: string;
		reason?: string;
		sessionId?: string;
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
			sourcePath: input.sourcePath,
			createdAt: existing?.createdAt ?? timestamp,
			updatedAt: timestamp,
			status: input.status ?? "ready",
			tags: [...new Set(["log", input.logType, ...(input.tags ?? [])])],
			logType: input.logType,
			label: input.label,
			reason: input.reason,
		};
		this.records.set(record.id, record);
		return record;
	}

	list(): LogRecord[] {
		return [...this.records.values()];
	}

	clear(): void {
		this.records.clear();
	}
}
