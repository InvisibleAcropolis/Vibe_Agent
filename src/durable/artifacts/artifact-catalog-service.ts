import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { ensureParentDir, getVibeArtifactCatalogPath, type VibeDurablePathOptions } from "../durable-paths.js";
import { extractArtifactRecords, type ArtifactExtractionContext, type ArtifactRecord } from "./artifact-extractor.js";

interface ArtifactCatalogManifest {
	version: 1;
	records: ArtifactRecord[];
	scopes: Record<string, string[]>;
}

export class ArtifactCatalogService {
	private readonly records = new Map<string, ArtifactRecord>();
	private readonly recordIdsByScope = new Map<string, string[]>();
	private readonly catalogPath: string;

	constructor(options?: VibeDurablePathOptions) {
		this.catalogPath = getVibeArtifactCatalogPath(options);
		this.load();
	}

	replaceFromMessages(context: ArtifactExtractionContext, messages: AgentMessage[]): ArtifactRecord[] {
		const records = extractArtifactRecords(messages, context);
		const scope = this.scopeKey(context);
		for (const recordId of this.recordIdsByScope.get(scope) ?? []) {
			this.records.delete(recordId);
		}
		this.recordIdsByScope.set(scope, records.map((record) => record.id));
		for (const record of records) {
			this.records.set(record.id, record);
		}
		this.persist();
		return records;
	}

	list(): ArtifactRecord[] {
		return [...this.records.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
	}

	clear(): void {
		this.records.clear();
		this.recordIdsByScope.clear();
		this.persist();
	}

	private load(): void {
		if (!existsSync(this.catalogPath)) {
			return;
		}
		try {
			const manifest = JSON.parse(readFileSync(this.catalogPath, "utf8")) as Partial<ArtifactCatalogManifest>;
			for (const record of Array.isArray(manifest.records) ? manifest.records : []) {
				this.records.set(record.id, record);
			}
			for (const [scope, recordIds] of Object.entries(manifest.scopes ?? {})) {
				this.recordIdsByScope.set(scope, Array.isArray(recordIds) ? recordIds : []);
			}
		} catch {
			// Treat malformed catalogs as empty so startup can recover.
		}
	}

	private persist(): void {
		const manifest: ArtifactCatalogManifest = {
			version: 1,
			records: this.list(),
			scopes: Object.fromEntries(this.recordIdsByScope.entries()),
		};
		ensureParentDir(this.catalogPath);
		const tempPath = `${this.catalogPath}.tmp`;
		writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
		renameSync(tempPath, this.catalogPath);
	}

	private scopeKey(context: ArtifactExtractionContext): string {
		return `${context.runtimeId}:${context.sessionId ?? "session"}:${context.threadId ?? "thread"}:${context.phase ?? "phase"}:${context.waveNumber ?? 0}`;
	}
}
