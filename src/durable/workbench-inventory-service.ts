import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { toArtifactView, type ArtifactRecord } from "./artifacts/artifact-extractor.js";
import { ArtifactCatalogService } from "./artifacts/artifact-catalog-service.js";
import { ensureParentDir, getVibeTrackerCatalogPath, type VibeDurablePathOptions } from "./durable-paths.js";
import type { LogRecord } from "./logs/log-catalog-service.js";
import { LogCatalogService } from "./logs/log-catalog-service.js";
import type { MemoryStoreRecord } from "./memory/memory-store-service.js";
import { MemoryStoreService } from "./memory/memory-store-service.js";
import type { DurableRecordMetadata } from "./record-metadata.js";

export interface OrchestrationDocumentRecord extends DurableRecordMetadata {
	documentType: "plan" | "artifact-summary";
	label: string;
	content: string;
	contentType: "markdown" | "text";
	relatedRecordIds: string[];
}

export interface WorkbenchInventory {
	artifacts: ArtifactRecord[];
	memoryStores: MemoryStoreRecord[];
	logs: LogRecord[];
	orchestrationDocuments: OrchestrationDocumentRecord[];
}

export class WorkbenchInventoryService {
	private readonly trackerCatalogPath: string;
	private readonly orchestrationDocuments = new Map<string, OrchestrationDocumentRecord>();

	constructor(
		private readonly artifactCatalog: ArtifactCatalogService,
		private readonly memoryStoreService: MemoryStoreService,
		private readonly logCatalogService: LogCatalogService,
		options?: VibeDurablePathOptions,
	) {
		this.trackerCatalogPath = getVibeTrackerCatalogPath(options);
		this.loadDocuments();
	}

	getInventory(): WorkbenchInventory {
		this.refreshOrchestrationDocuments();
		return {
			artifacts: this.artifactCatalog.list(),
			memoryStores: this.memoryStoreService.list(),
			logs: this.logCatalogService.list(),
			orchestrationDocuments: this.listOrchestrationDocuments(),
		};
	}

	listArtifacts(): ArtifactRecord[] {
		return this.artifactCatalog.list();
	}

	listArtifactViews() {
		return this.listArtifacts().map(toArtifactView);
	}

	listMemoryStores(): MemoryStoreRecord[] {
		return this.memoryStoreService.list();
	}

	listLogs(): LogRecord[] {
		return this.logCatalogService.list();
	}

	listOrchestrationDocuments(): OrchestrationDocumentRecord[] {
		return [...this.orchestrationDocuments.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
	}

	private loadDocuments(): void {
		if (!existsSync(this.trackerCatalogPath)) {
			return;
		}
		try {
			const parsed = JSON.parse(readFileSync(this.trackerCatalogPath, "utf8")) as { records?: OrchestrationDocumentRecord[] };
			for (const record of Array.isArray(parsed.records) ? parsed.records : []) {
				this.orchestrationDocuments.set(record.id, record);
			}
		} catch {
			// Treat malformed catalogs as empty so startup can recover.
		}
	}

	private refreshOrchestrationDocuments(): void {
		const records: DurableRecordMetadata[] = [
			...this.artifactCatalog.list(),
			...this.memoryStoreService.list(),
			...this.logCatalogService.list(),
		];

		for (const artifact of this.artifactCatalog.list()) {
			if (artifact.language !== "markdown" && !artifact.tags.includes("plan")) {
				continue;
			}
			this.upsertDocument({
				id: `tracker:${artifact.id}`,
				kind: "orchestration-document",
				ownerRuntimeId: artifact.ownerRuntimeId,
				sessionId: artifact.sessionId,
				threadId: artifact.threadId,
				phase: artifact.phase,
				waveNumber: artifact.waveNumber,
				sourcePath: artifact.filePath ?? artifact.sourcePath,
				createdAt: artifact.createdAt,
				updatedAt: new Date().toISOString(),
				status: artifact.status,
				tags: [...new Set(["tracker", "orchestration", ...artifact.tags])],
				orchestration: artifact.orchestration,
				documentType: "plan",
				label: artifact.title,
				content: artifact.content,
				contentType: "markdown",
				relatedRecordIds: [artifact.id],
			});
		}

		for (const record of records.filter((entry) => Boolean(entry.threadId || entry.phase || entry.waveNumber !== undefined))) {
			const summary = renderRecordSummary(record);
			this.upsertDocument({
				id: `tracker:summary:${record.id}`,
				kind: "orchestration-document",
				ownerRuntimeId: record.ownerRuntimeId,
				sessionId: record.sessionId,
				threadId: record.threadId,
				phase: record.phase,
				waveNumber: record.waveNumber,
				sourcePath: record.sourcePath,
				createdAt: record.createdAt,
				updatedAt: new Date().toISOString(),
				status: record.status,
				tags: [...new Set(["tracker", "orchestration-summary", ...record.tags])],
				orchestration: record.orchestration,
				documentType: "artifact-summary",
				label: `${record.kind} summary`,
				content: summary,
				contentType: "markdown",
				relatedRecordIds: [record.id],
			});
		}

		this.persistDocuments();
	}

	private upsertDocument(record: OrchestrationDocumentRecord): void {
		const existing = this.orchestrationDocuments.get(record.id);
		this.orchestrationDocuments.set(record.id, {
			...record,
			createdAt: existing?.createdAt ?? record.createdAt,
		});
	}

	private persistDocuments(): void {
		ensureParentDir(this.trackerCatalogPath);
		const tempPath = `${this.trackerCatalogPath}.tmp`;
		writeFileSync(tempPath, `${JSON.stringify({ version: 1, records: this.listOrchestrationDocuments() }, null, 2)}\n`, "utf8");
		renameSync(tempPath, this.trackerCatalogPath);
	}
}

function renderRecordSummary(record: DurableRecordMetadata): string {
	return [
		`# ${record.kind}`,
		`- Runtime: ${record.ownerRuntimeId}`,
		`- Session: ${record.sessionId ?? "n/a"}`,
		`- Thread: ${record.threadId ?? "n/a"}`,
		`- Phase: ${record.phase ?? "n/a"}`,
		`- Wave: ${record.waveNumber ?? "n/a"}`,
		`- Source: ${record.sourcePath ?? "n/a"}`,
		`- Status: ${record.status}`,
	].join("\n");
}
