import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { toArtifactView, type ArtifactRecord } from "./artifacts/artifact-extractor.js";
import { ArtifactCatalogService } from "./artifacts/artifact-catalog-service.js";
import { ensureParentDir, getVibeTrackerCatalogPath, type VibeDurablePathOptions } from "./durable-paths.js";
import type { LogRecord } from "./logs/log-catalog-service.js";
import { LogCatalogService } from "./logs/log-catalog-service.js";
import type { MemoryStoreRecord } from "./memory/memory-store-service.js";
import { MemoryStoreService } from "./memory/memory-store-service.js";
import type { Artifact } from "../types.js";
import type { DurableRecordMetadata } from "./record-metadata.js";

export type OrchestrationDocumentType = "plan" | "roadmap" | "research" | "session" | "tracker" | "artifact-summary" | "manifest";

export interface OrchestrationDocumentRecord extends DurableRecordMetadata {
	documentType: OrchestrationDocumentType;
	label: string;
	content: string;
	contentType: "markdown" | "text" | "json";
	filePath?: string;
	manifestPath?: string;
	pairedPath?: string;
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

	listOrchestrationDocumentViews(documentTypes?: OrchestrationDocumentType[]): Artifact[] {
		const allowed = documentTypes ? new Set(documentTypes) : undefined;
		return this.listOrchestrationDocuments()
			.filter((record) => !allowed || allowed.has(record.documentType))
			.map((record) => ({
				id: record.id,
				type: record.contentType === "json" ? "code" : "text",
				title: `[${record.documentType}] ${record.label}`,
				content: record.content,
				language: record.contentType === "json" ? "json" : record.contentType === "markdown" ? "markdown" : undefined,
				filePath: record.filePath ?? record.sourcePath,
			}));
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
			const documentType = inferDocumentType(artifact);
			if (!documentType) {
				continue;
			}
			const filePath = artifact.filePath ?? artifact.sourcePath;
			const manifestPath = filePath ? replaceExtension(filePath, ".json") : undefined;
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
				tags: [...new Set(["tracker", "orchestration", documentType, ...artifact.tags])],
				orchestration: artifact.orchestration,
				documentType,
				label: artifact.title,
				content: artifact.content,
				contentType: artifact.language === "json" ? "json" : "markdown",
				filePath,
				manifestPath,
				pairedPath: filePath && manifestPath ? (filePath.endsWith(".json") ? replaceExtension(filePath, ".md") : manifestPath) : undefined,
				relatedRecordIds: [artifact.id],
			});

			if (artifact.language !== "json" && filePath) {
				this.upsertDocument({
					id: `tracker:manifest:${artifact.id}`,
					kind: "orchestration-document",
					ownerRuntimeId: artifact.ownerRuntimeId,
					sessionId: artifact.sessionId,
					threadId: artifact.threadId,
					phase: artifact.phase,
					waveNumber: artifact.waveNumber,
					sourcePath: manifestPath,
					createdAt: artifact.createdAt,
					updatedAt: new Date().toISOString(),
					status: artifact.status,
					tags: [...new Set(["tracker", "manifest", "orchestration", documentType, ...artifact.tags])],
					orchestration: artifact.orchestration,
					documentType: "manifest",
					label: `${artifact.title} manifest`,
					content: JSON.stringify(renderDocumentManifest(documentType, artifact, filePath, manifestPath), null, 2),
					contentType: "json",
					filePath: manifestPath,
					manifestPath,
					pairedPath: filePath,
					relatedRecordIds: [artifact.id],
				});
			}
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

function inferDocumentType(record: ArtifactRecord): OrchestrationDocumentType | undefined {
	const filePath = record.filePath?.toLowerCase() ?? "";
	if (filePath.includes("/roadmaps/") || filePath.startsWith("roadmaps/")) return "roadmap";
	if (filePath.includes("/research/") || filePath.startsWith("research/")) return "research";
	if (filePath.includes("/sessions/") || filePath.startsWith("sessions/")) return "session";
	if (filePath.includes("/tracker/") || filePath.startsWith("tracker/")) return "tracker";
	if (record.tags.includes("plan") || filePath.includes("/plans/") || filePath.startsWith("plans/")) return "plan";
	if (record.language === "json") return "manifest";
	return undefined;
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

function renderDocumentManifest(documentType: OrchestrationDocumentType, artifact: ArtifactRecord, filePath: string, manifestPath?: string) {
	return {
		version: 1,
		documentType,
		label: artifact.title,
		filePath,
		manifestPath,
		threadId: artifact.threadId,
		waveNumber: artifact.waveNumber,
		phase: artifact.phase,
		tags: artifact.tags,
		createdAt: artifact.createdAt,
	};
}

function replaceExtension(filePath: string, nextExtension: string): string {
	return filePath.replace(/\.[^.]+$/, nextExtension);
}
