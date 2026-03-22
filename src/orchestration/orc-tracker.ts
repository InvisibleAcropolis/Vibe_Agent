import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { ensureParentDir, getVibeTrackerPath, type VibeDurablePathOptions } from "../durable/durable-paths.js";
import type { OrcCheckpointStore } from "./orc-checkpoints.js";
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

export type OrcTrackerSignOffStatus = "not-started" | "in-progress" | "blocked" | "ready" | "signed-off";

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
	const completedTasks = state?.workerResults.filter((result) => result.status === "completed").length ?? 0;
	const blockedWorkerTasks = state?.workerResults.filter((result) => result.status === "failed" || result.status === "cancelled").length ?? 0;
	const blockedSecurityEvents = state?.securityEvents?.filter((event) => event.kind === "approval-required" || event.kind === "blocked-command").length ?? 0;
	const blockedTasks = blockedWorkerTasks + blockedSecurityEvents;
	const signOffStatus = deriveTrackerSignOffStatus(state, blockedTasks);

	return {
		hasActiveGraph: Boolean(state),
		title: "Orchestration Status",
		subtitle: "Friendly frontend telemetry for the Orc control plane. Raw agent transcript is intentionally hidden here.",
		emptyStateTitle: "No active orchestration graph",
		emptyStateMessage: "Phase 1 scaffolding is ready. Launch or resume an Orc thread to replace these placeholders with live tracker telemetry.",
		fields: {
			activePhase: createField("Active phase", state ? humanizeValue(state.phase) : "Waiting for graph", state ? "accent" : "dim"),
			activeThread: createField("Active Orc thread", state?.threadId ?? "No thread selected", state?.threadId ? "default" : "dim"),
			currentWave: createField("Current wave", state?.activeWave?.waveId ?? "No wave in progress", state?.activeWave?.waveId ? "default" : "dim"),
			completedTasks: createField("Completed tasks", String(completedTasks), completedTasks > 0 ? "success" : "dim"),
			blockedTasks: createField("Blocked tasks", String(blockedTasks), blockedTasks > 0 ? "warning" : "dim"),
			latestCheckpoint: createField("Latest checkpoint", state?.checkpointId ?? "No checkpoint captured", state?.checkpointId ? "default" : "dim"),
			trackerSignOffStatus: createField("Tracker sign-off status", humanizeValue(signOffStatus), signOffTone(signOffStatus)),
		},
		highlights: buildHighlights(state, completedTasks, blockedTasks, signOffStatus),
	};
}

function createField(
	label: string,
	value: string,
	tone: OrcTelemetryField["tone"] = "default",
): OrcTelemetryField {
	return { label, value, tone };
}

function humanizeValue(value: string): string {
	return value
		.replace(/[-_]+/g, " ")
		.replace(/\b\w/g, (match) => match.toUpperCase());
}

function deriveTrackerSignOffStatus(
	state: OrcControlPlaneState | undefined,
	blockedTasks: number,
): OrcTrackerSignOffStatus {
	if (!state) {
		return "not-started";
	}
	if (blockedTasks > 0 || state.phase === "failed" || state.phase === "cancelled") {
		return "blocked";
	}
	if (state.phase === "completed") {
		return "signed-off";
	}
	if (state.phase === "checkpointed") {
		return "ready";
	}
	return "in-progress";
}

function signOffTone(status: OrcTrackerSignOffStatus): OrcTelemetryField["tone"] {
	switch (status) {
		case "signed-off":
		case "ready":
			return "success";
		case "blocked":
			return "warning";
		case "not-started":
			return "dim";
		default:
			return "accent";
	}
}

function buildHighlights(
	state: OrcControlPlaneState | undefined,
	completedTasks: number,
	blockedTasks: number,
	signOffStatus: OrcTrackerSignOffStatus,
): string[] {
	if (!state) {
		return [
			"Start from the Orc menu to spin up an orchestration thread.",
			"The dashboard is reserved for summarized telemetry rather than raw agent chatter.",
		];
	}

	const highlights = [
		`Project: ${state.project.projectName ?? state.project.projectId}`,
		`Last updated: ${state.lastUpdatedAt}`,
	];
	if (state.activeWave?.goal) {
		highlights.push(`Wave goal: ${state.activeWave.goal}`);
	}
	if (completedTasks > 0) {
		highlights.push(`${completedTasks} completed task${completedTasks === 1 ? "" : "s"} recorded.`);
	}
	if (blockedTasks > 0) {
		highlights.push(`${blockedTasks} blocked item${blockedTasks === 1 ? "" : "s"} need attention.`);
	}
	if (signOffStatus === "ready") {
		highlights.push("Tracker is checkpointed and ready for human review.");
	}
	return highlights;
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
		return JSON.parse(readFileSync(filePath, "utf8")) as OrcControlPlaneState;
	}

	async save(state: OrcControlPlaneState): Promise<void> {
		const checkpointId = state.checkpointId;
		if (!checkpointId) {
			return;
		}
		const filePath = this.getSnapshotPath(state.threadId, checkpointId);
		ensureParentDir(filePath);
		const tempPath = `${filePath}.tmp`;
		writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
		renameSync(tempPath, filePath);
	}

	private getSnapshotPath(threadId: string, checkpointId: string): string {
		return getVibeTrackerPath(`${encodeURIComponent(threadId)}--${encodeURIComponent(checkpointId)}.json`, this.options);
	}
}
