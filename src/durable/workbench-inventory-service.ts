import { toArtifactView, type ArtifactRecord } from "./artifacts/artifact-extractor.js";
import { ArtifactCatalogService } from "./artifacts/artifact-catalog-service.js";
import type { LogRecord } from "./logs/log-catalog-service.js";
import { LogCatalogService } from "./logs/log-catalog-service.js";
import type { MemoryStoreRecord } from "./memory/memory-store-service.js";
import { MemoryStoreService } from "./memory/memory-store-service.js";

export interface WorkbenchInventory {
	artifacts: ArtifactRecord[];
	memoryStores: MemoryStoreRecord[];
	logs: LogRecord[];
}

export class WorkbenchInventoryService {
	constructor(
		private readonly artifactCatalog: ArtifactCatalogService,
		private readonly memoryStoreService: MemoryStoreService,
		private readonly logCatalogService: LogCatalogService,
	) {}

	getInventory(): WorkbenchInventory {
		return {
			artifacts: this.artifactCatalog.list(),
			memoryStores: this.memoryStoreService.list(),
			logs: this.logCatalogService.list(),
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
}
