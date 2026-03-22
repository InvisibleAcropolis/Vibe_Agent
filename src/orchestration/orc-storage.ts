import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
	getVibeArtifactsDir,
	getVibeLangExtTrackerSnapshotPath,
	getVibePlansDir,
	getVibeResearchDir,
	getVibeRoadmapsDir,
	getVibeSessionsDir,
	getVibeTrackerDir,
	type VibeDurablePathOptions,
} from "../durable/durable-paths.js";
import {
	buildOrcFileStem,
	inferOrcDocumentLabel,
	type OrcArtifactDocument,
	type OrcArtifactLogEntry,
	type OrcDocumentCoordinates,
	type OrcDocumentFormat,
	type OrcDocumentKind,
} from "./orc-io.js";

export interface OrcArtifactLocation {
	kind: OrcDocumentKind;
	dirPath: string;
	manifestDirPath: string;
	reservedNames?: string[];
}

export interface ResolveOrcDocumentInput {
	kind: OrcDocumentKind;
	format: OrcDocumentFormat;
	coordinates: OrcDocumentCoordinates;
	fileExtension?: string;
}

export interface ResolvedOrcDocumentLocation extends OrcArtifactLocation {
	format: OrcDocumentFormat;
	fileName: string;
	filePath: string;
	manifestPath: string;
	pairedPath: string;
	stem: string;
}

/**
 * Storage boundary for orchestration artifacts, logs, and checkpoints.
 */
export interface OrcStorage {
	listArtifacts(threadId: string, checkpointId?: string): Promise<OrcArtifactLogEntry[]>;
	listLogs(threadId: string, checkpointId?: string): Promise<OrcArtifactLogEntry[]>;
}

export class NoopOrcStorage implements OrcStorage {
	async listArtifacts(_threadId: string, _checkpointId?: string): Promise<OrcArtifactLogEntry[]> {
		return [];
	}

	async listLogs(_threadId: string, _checkpointId?: string): Promise<OrcArtifactLogEntry[]> {
		return [];
	}
}

export function getOrcArtifactLocations(options?: VibeDurablePathOptions): OrcArtifactLocation[] {
	return [
		{ kind: "plan", dirPath: getVibePlansDir(options), manifestDirPath: join(getVibePlansDir(options), "manifests") },
		{ kind: "roadmap", dirPath: getVibeRoadmapsDir(options), manifestDirPath: join(getVibeRoadmapsDir(options), "manifests") },
		{ kind: "research", dirPath: getVibeResearchDir(options), manifestDirPath: join(getVibeResearchDir(options), "manifests") },
		{ kind: "session", dirPath: getVibeSessionsDir(options), manifestDirPath: join(getVibeSessionsDir(options), "manifests") },
		{ kind: "tracker", dirPath: getVibeTrackerDir(options), manifestDirPath: join(getVibeTrackerDir(options), "manifests"), reservedNames: [getVibeLangExtTrackerSnapshotPath(undefined, options)] },
		{ kind: "artifact-manifest", dirPath: getVibeArtifactsDir(options), manifestDirPath: join(getVibeArtifactsDir(options), "manifests") },
	];
}

export function resolveOrcArtifactLocation(input: ResolveOrcDocumentInput, options?: VibeDurablePathOptions): ResolvedOrcDocumentLocation {
	const location = getOrcArtifactLocations(options).find((entry) => entry.kind === input.kind);
	if (!location) {
		throw new Error(`Unsupported Orc document kind: ${input.kind}`);
	}
	const stem = buildOrcFileStem(input.kind, input.coordinates);
	const extension = input.fileExtension ?? (input.format === "markdown" ? ".md" : ".json");
	const fileName = `${stem}${extension.startsWith(".") ? extension : `.${extension}`}`;
	const pairedExtension = input.format === "markdown" ? ".json" : ".md";
	return {
		...location,
		format: input.format,
		fileName,
		filePath: join(location.dirPath, fileName),
		manifestPath: join(location.manifestDirPath, `${stem}.json`),
		pairedPath: join(location.dirPath, `${stem}${pairedExtension}`),
		stem,
	};
}

export function listOrcArtifactLocations(kind: OrcDocumentKind, options?: VibeDurablePathOptions): string[] {
	const location = getOrcArtifactLocations(options).find((entry) => entry.kind === kind);
	if (!location || !existsSync(location.dirPath)) {
		return [];
	}
	return readdirSync(location.dirPath)
		.map((entry) => join(location.dirPath, entry))
		.filter((entry) => !location.reservedNames?.includes(entry))
		.sort();
}

export function validateOrcArtifactDocument(document: OrcArtifactDocument): string[] {
	const issues: string[] = [];
	if (!document.id) issues.push("document.id is required");
	if (!document.label) issues.push("document.label is required");
	if (!document.sourcePath) issues.push("document.sourcePath is required");
	if (!document.createdAt) issues.push("document.createdAt is required");
	if (!document.coordinates.projectId) issues.push("document.coordinates.projectId is required");
	if (!document.coordinates.timestamp) issues.push("document.coordinates.timestamp is required");
	return issues;
}

export function createOrcArtifactDocument(init: Omit<OrcArtifactDocument, "label"> & { label?: string }): OrcArtifactDocument {
	return {
		...init,
		label: init.label ?? inferOrcDocumentLabel(init.sourcePath),
	};
}
