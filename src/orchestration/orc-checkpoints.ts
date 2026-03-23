import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureParentDir, getVibeCheckpointsDir, type VibeDurablePathOptions } from "../durable/durable-paths.js";
import type { OrcCheckpointBoundarySummary, OrcControlPlaneState, OrcDurableEventOffset } from "./orc-state.js";

export interface OrcThreadIdentity {
	threadId: string;
	projectId?: string;
	runtimeId?: string;
	sessionId?: string;
}

export interface OrcStateSnapshotRef {
	snapshotId: string;
	trackerStateId?: string;
	storageKey: string;
	format: "control-plane-state" | "langgraph-checkpoint" | "external-reference";
	checksum?: string;
	capturedAt: string;
}

export interface OrcPhaseResumeData {
	phase: OrcControlPlaneState["phase"];
	resumeToken?: string;
	resumeCursor?: string;
	activeWaveId?: string;
	workerIds: string[];
	instructions?: string;
	transportRunCorrelationId?: string;
	latestDurableEventOffset?: OrcDurableEventOffset;
	checkpointBoundary?: OrcCheckpointBoundarySummary;
	metadata?: Record<string, string | number | boolean | null>;
}

export interface OrcCheckpointMetadata {
	checkpointId: string;
	thread: OrcThreadIdentity;
	parentCheckpointId?: string;
	sequenceNumber: number;
	phase: OrcControlPlaneState["phase"];
	label?: string;
	createdAt: string;
	createdBy?: string;
	trackerStateId?: string;
	transportRunCorrelationId?: string;
	latestDurableEventOffset?: OrcDurableEventOffset;
	checkpointBoundary?: OrcCheckpointBoundarySummary;
	resumeData?: OrcPhaseResumeData;
	stateSnapshot: OrcStateSnapshotRef;
	artifactBundleIds: string[];
	rewindTargetIds: string[];
	metadata?: Record<string, string | number | boolean | null>;
}

export interface OrcCheckpointManifest {
	thread: OrcThreadIdentity;
	latestCheckpointId?: string;
	checkpointHistory: string[];
	rewindTargetIds: string[];
	artifactBundleIds: string[];
	checkpoints: Record<string, OrcCheckpointMetadata>;
	updatedAt: string;
}

export interface OrcCheckpointQuery {
	threadId: string;
	checkpointId?: string;
}

export interface OrcCheckpointWrite {
	metadata: OrcCheckpointMetadata;
	manifest?: Partial<Pick<OrcCheckpointManifest, "latestCheckpointId" | "rewindTargetIds" | "artifactBundleIds">>;
}

export interface OrcCheckpointStore {
	loadManifest(threadId: string): Promise<OrcCheckpointManifest | undefined>;
	loadCheckpoint(query: OrcCheckpointQuery): Promise<OrcCheckpointMetadata | undefined>;
	listCheckpoints(threadId: string): Promise<OrcCheckpointMetadata[]>;
	saveCheckpoint(write: OrcCheckpointWrite): Promise<OrcCheckpointManifest>;
}

export class NoopOrcCheckpointStore implements OrcCheckpointStore {
	async loadManifest(_threadId: string): Promise<OrcCheckpointManifest | undefined> {
		return undefined;
	}

	async loadCheckpoint(_query: OrcCheckpointQuery): Promise<OrcCheckpointMetadata | undefined> {
		return undefined;
	}

	async listCheckpoints(_threadId: string): Promise<OrcCheckpointMetadata[]> {
		return [];
	}

	async saveCheckpoint(write: OrcCheckpointWrite): Promise<OrcCheckpointManifest> {
		const now = write.metadata.createdAt;
		return {
			thread: write.metadata.thread,
			latestCheckpointId: write.metadata.checkpointId,
			checkpointHistory: [write.metadata.checkpointId],
			rewindTargetIds: [...write.metadata.rewindTargetIds],
			artifactBundleIds: [...write.metadata.artifactBundleIds],
			checkpoints: { [write.metadata.checkpointId]: write.metadata },
			updatedAt: now,
		};
	}
}

export class LocalFileOrcCheckpointStore implements OrcCheckpointStore {
	private readonly checkpointsRoot: string;

	constructor(options?: VibeDurablePathOptions) {
		this.checkpointsRoot = getVibeCheckpointsDir(options);
		mkdirSync(this.checkpointsRoot, { recursive: true, mode: 0o700 });
	}

	async loadManifest(threadId: string): Promise<OrcCheckpointManifest | undefined> {
		return this.readJson<OrcCheckpointManifest>(this.getManifestPath(threadId));
	}

	async loadCheckpoint(query: OrcCheckpointQuery): Promise<OrcCheckpointMetadata | undefined> {
		if (query.checkpointId) {
			return this.readJson<OrcCheckpointMetadata>(this.getCheckpointPath(query.threadId, query.checkpointId));
		}
		const manifest = await this.loadManifest(query.threadId);
		return manifest?.latestCheckpointId ? (manifest.checkpoints[manifest.latestCheckpointId] ?? this.readJson<OrcCheckpointMetadata>(this.getCheckpointPath(query.threadId, manifest.latestCheckpointId))) : undefined;
	}

	async listCheckpoints(threadId: string): Promise<OrcCheckpointMetadata[]> {
		const manifest = await this.loadManifest(threadId);
		if (!manifest) {
			return [];
		}
		return manifest.checkpointHistory
			.map((checkpointId) => manifest.checkpoints[checkpointId])
			.filter((checkpoint): checkpoint is OrcCheckpointMetadata => Boolean(checkpoint));
	}

	async saveCheckpoint(write: OrcCheckpointWrite): Promise<OrcCheckpointManifest> {
		const { metadata } = write;
		const existing = (await this.loadManifest(metadata.thread.threadId)) ?? this.createEmptyManifest(metadata.thread, metadata.createdAt);
		const checkpointHistory = appendUnique(existing.checkpointHistory, metadata.checkpointId);
		const rewindTargetIds = uniqueValues(write.manifest?.rewindTargetIds ?? [...existing.rewindTargetIds, ...metadata.rewindTargetIds]);
		const artifactBundleIds = uniqueValues(write.manifest?.artifactBundleIds ?? [...existing.artifactBundleIds, ...metadata.artifactBundleIds]);
		const latestCheckpointId = write.manifest?.latestCheckpointId ?? metadata.checkpointId;
		const manifest: OrcCheckpointManifest = {
			thread: existing.thread,
			latestCheckpointId,
			checkpointHistory,
			rewindTargetIds,
			artifactBundleIds,
			checkpoints: {
				...existing.checkpoints,
				[metadata.checkpointId]: {
					...metadata,
					artifactBundleIds: uniqueValues(metadata.artifactBundleIds),
					rewindTargetIds: uniqueValues(metadata.rewindTargetIds),
				},
			},
			updatedAt: metadata.createdAt,
		};
		this.writeJson(this.getCheckpointPath(metadata.thread.threadId, metadata.checkpointId), manifest.checkpoints[metadata.checkpointId]);
		this.writeJson(this.getManifestPath(metadata.thread.threadId), manifest);
		return manifest;
	}

	private createEmptyManifest(thread: OrcThreadIdentity, updatedAt: string): OrcCheckpointManifest {
		return {
			thread,
			checkpointHistory: [],
			rewindTargetIds: [],
			artifactBundleIds: [],
			checkpoints: {},
			updatedAt,
		};
	}

	private getThreadDir(threadId: string): string {
		return join(this.checkpointsRoot, encodeURIComponent(threadId));
	}

	private getManifestPath(threadId: string): string {
		return join(this.getThreadDir(threadId), "thread-manifest.json");
	}

	private getCheckpointPath(threadId: string, checkpointId: string): string {
		return join(this.getThreadDir(threadId), "checkpoints", `${encodeURIComponent(checkpointId)}.json`);
	}

	private readJson<T>(filePath: string): T | undefined {
		if (!existsSync(filePath)) {
			return undefined;
		}
		return JSON.parse(readFileSync(filePath, "utf8")) as T;
	}

	private writeJson(filePath: string, value: unknown): void {
		ensureParentDir(filePath);
		const tempPath = `${filePath}.tmp`;
		writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
		renameSync(tempPath, filePath);
	}
}

function uniqueValues(values: string[]): string[] {
	return [...new Set(values)];
}

function appendUnique(values: string[], value: string): string[] {
	return values.includes(value) ? values : [...values, value];
}
