import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { ensureParentDir, getVibeTrackerPath, type VibeDurablePathOptions } from "../durable/durable-paths.js";
import type { OrcCheckpointStore } from "./orc-checkpoints.js";
import {
	createInitialCheckpointMetadataSummary,
	createInitialReducedTransportHealth,
	createInitialTerminalStateSummary,
} from "./orc-events.js";
import { presentOrcTrackerSummary } from "./orc-presentation.js";
import type { OrcControlPlaneState } from "./orc-state.js";

/**
 * Tracker abstraction for persisting and restoring control-plane snapshots.
 */
export interface OrcTracker {
	load(threadId: string, checkpointId?: string): Promise<OrcControlPlaneState | undefined>;
	save(state: OrcControlPlaneState): Promise<void>;
}

export class NoopOrcTracker implements OrcTracker {
	async load(_threadId: string, _checkpointId?: string): Promise<OrcControlPlaneState | undefined> {
		return undefined;
	}

	async save(_state: OrcControlPlaneState): Promise<void> {}
}

export interface OrcTelemetryField {
	label: string;
	value: string;
	tone?: "default" | "accent" | "success" | "warning" | "dim";
}

export interface OrcTrackerDashboardViewModel {
	hasActiveGraph: boolean;
	title: string;
	subtitle: string;
	emptyStateTitle: string;
	emptyStateMessage: string;
	fields: {
		activePhase: OrcTelemetryField;
		activeThread: OrcTelemetryField;
		currentWave: OrcTelemetryField;
		completedTasks: OrcTelemetryField;
		blockedTasks: OrcTelemetryField;
		latestCheckpoint: OrcTelemetryField;
		trackerSignOffStatus: OrcTelemetryField;
	};
	highlights: string[];
}

export function createOrcTrackerDashboardViewModel(
	state?: OrcControlPlaneState,
): OrcTrackerDashboardViewModel {
	const presentation = presentOrcTrackerSummary(state);

	return {
		hasActiveGraph: Boolean(state),
		title: "Orchestration Status",
		subtitle: "Friendly frontend telemetry for the Orc control plane. Raw agent transcript is intentionally hidden here.",
		emptyStateTitle: "No active orchestration graph",
		emptyStateMessage: "Phase 1 scaffolding is ready. Launch or resume an Orc thread to replace these placeholders with live tracker telemetry.",
		fields: {
			activePhase: createField("Active phase", presentation.phase.label, presentation.phase.tone),
			activeThread: createField("Active Orc thread", presentation.thread.label, presentation.thread.tone),
			currentWave: createField("Current wave", presentation.wave.label, presentation.wave.tone),
			completedTasks: createField("Completed tasks", presentation.completedTasks.label, presentation.completedTasks.tone),
			blockedTasks: createField("Blocked tasks", presentation.blockedTasks.label, presentation.blockedTasks.tone),
			latestCheckpoint: createField("Latest checkpoint", presentation.checkpoint.label, presentation.checkpoint.tone),
			trackerSignOffStatus: createField("Tracker sign-off status", presentation.signOff.label, presentation.signOff.tone),
		},
		highlights: presentation.highlights,
	};
}

function createField(
	label: string,
	value: string,
	tone: OrcTelemetryField["tone"] = "default",
): OrcTelemetryField {
	return { label, value, tone };
}


export class FileSystemOrcTracker implements OrcTracker {
	constructor(
		private readonly checkpoints: OrcCheckpointStore = {
			loadManifest: async () => undefined,
			loadCheckpoint: async () => undefined,
			listCheckpoints: async () => [],
			saveCheckpoint: async (write) => ({
				thread: write.metadata.thread,
				latestCheckpointId: write.metadata.checkpointId,
				checkpointHistory: [write.metadata.checkpointId],
				rewindTargetIds: write.metadata.rewindTargetIds,
				artifactBundleIds: write.metadata.artifactBundleIds,
				checkpoints: { [write.metadata.checkpointId]: write.metadata },
				updatedAt: write.metadata.createdAt,
			}),
		},
		private readonly options?: VibeDurablePathOptions,
	) {}

	async load(threadId: string, checkpointId?: string): Promise<OrcControlPlaneState | undefined> {
		const targetCheckpointId = checkpointId ?? (await this.checkpoints.loadManifest(threadId))?.latestCheckpointId;
		if (!targetCheckpointId) {
			return undefined;
		}
		const filePath = this.getSnapshotPath(threadId, targetCheckpointId);
		if (!existsSync(filePath)) {
			return undefined;
		}
		return hydrateTrackerSnapshot(JSON.parse(readFileSync(filePath, "utf8")) as Partial<OrcControlPlaneState>);
	}

	async save(state: OrcControlPlaneState): Promise<void> {
		const checkpointId = state.checkpointId;
		if (!checkpointId) {
			return;
		}
		const filePath = this.getSnapshotPath(state.threadId, checkpointId);
		ensureParentDir(filePath);
		const tempPath = `${filePath}.tmp`;
		const snapshot = createTrackerSnapshot(state);
		writeFileSync(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
		renameSync(tempPath, filePath);
	}

	private getSnapshotPath(threadId: string, checkpointId: string): string {
		return getVibeTrackerPath(`${encodeURIComponent(threadId)}--${encodeURIComponent(checkpointId)}.json`, this.options);
	}
}

export function createTrackerSnapshot(state: OrcControlPlaneState): OrcControlPlaneState {
	const checkpointMetadata = state.checkpointMetadata ?? createInitialCheckpointMetadataSummary();
	const transportHealth = state.transportHealth ?? createInitialReducedTransportHealth();
	const terminalState = state.terminalState ?? createInitialTerminalStateSummary();
	return {
		...state,
		messages: state.messages.map((message) => ({ ...message, metadata: message.metadata ? { ...message.metadata } : undefined })),
		securityEvents: state.securityEvents?.map((event) => ({ ...event })),
		workerResults: state.workerResults.map((result) => ({
			...result,
			artifactIds: [...result.artifactIds],
			logIds: [...result.logIds],
			metadata: result.metadata ? { ...result.metadata } : undefined,
		})),
		verificationErrors: state.verificationErrors.map((error) => ({ ...error })),
		activeWave: state.activeWave ? { ...state.activeWave, workerIds: [...state.activeWave.workerIds] } : undefined,
		checkpointMetadata: {
			...checkpointMetadata,
			artifactBundleIds: [...checkpointMetadata.artifactBundleIds],
			rewindTargetIds: [...checkpointMetadata.rewindTargetIds],
		},
		transportHealth: { ...transportHealth },
		terminalState: { ...terminalState, ambiguityNotes: [...terminalState.ambiguityNotes] },
	};
}

function hydrateTrackerSnapshot(snapshot: Partial<OrcControlPlaneState>): OrcControlPlaneState {
	return {
		threadId: snapshot.threadId ?? "unknown-thread",
		checkpointId: snapshot.checkpointId,
		phase: snapshot.phase ?? "idle",
		project: snapshot.project ?? { projectId: "unknown-project", projectRoot: "" },
		securityPolicy: snapshot.securityPolicy,
		messages: snapshot.messages ?? [],
		securityEvents: snapshot.securityEvents ?? [],
		activeWave: snapshot.activeWave,
		workerResults: snapshot.workerResults ?? [],
		verificationErrors: snapshot.verificationErrors ?? [],
		checkpointMetadata: snapshot.checkpointMetadata ?? createInitialCheckpointMetadataSummary(),
		transportHealth: snapshot.transportHealth ?? createInitialReducedTransportHealth(),
		terminalState: snapshot.terminalState ?? createInitialTerminalStateSummary(),
		lastUpdatedAt: snapshot.lastUpdatedAt ?? new Date(0).toISOString(),
	};
}
