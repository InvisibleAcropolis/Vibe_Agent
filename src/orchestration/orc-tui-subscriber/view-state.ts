import {
	createInitialCheckpointMetadataSummary,
	createInitialReducedTransportHealth,
	createInitialTerminalStateSummary,
} from "../orc-events/control-plane-reducer.js";
import type { OrcActiveOverlay, OrcBusEvent, OrcEventReducerState } from "../orc-events/types.js";
import { createOrcTrackerDashboardViewModel } from "../orc-tracker.js";
import type { OrcControlPlaneState, OrcProjectContext } from "../orc-state.js";
import { getOrderedSurfaceEntries } from "./subagent-surfaces.js";
import type { OrcTuiInteractionState } from "./interaction-state.js";
import type { OrcTuiTelemetryReductionState } from "./telemetry-reduction.js";
import type { OrcTuiEventLogTailEntry, OrcTuiTelemetryState } from "./types.js";

export function createViewState(
	telemetryState: OrcTuiTelemetryReductionState,
	interactionState: OrcTuiInteractionState,
	eventLogTail: OrcTuiEventLogTailEntry[],
): OrcTuiTelemetryState {
	const { controlPlane, reducerState } = telemetryState;
	const { surfaceStore, hiddenOverlayIds, focusedOverlayId } = interactionState;
	const subagentEntries = getOrderedSurfaceEntries(surfaceStore);
	const summaryRowKeys = subagentEntries
		.filter((entry) => entry.retention === "collapsed-summary")
		.map((entry) => entry.identity.surfaceKey);
	const visibleEntries = reducerState.activeOverlays.filter((entry) => !hiddenOverlayIds.includes(entry.id));
	const stackedOverlayIds = [...visibleEntries]
		.sort(compareOverlayEntries)
		.map((entry) => entry.id);
	return {
		threadId: controlPlane.threadId,
		runCorrelationId: undefined,
		dashboard: createOrcTrackerDashboardViewModel(controlPlane),
		subagentActivity: Object.values(reducerState.latestActivityByAgent).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
		subagentSurfaces: {
			entries: subagentEntries,
			focusedSurfaceKey: surfaceStore.focusedSurfaceKey,
			stackedSurfaceKeys: surfaceStore.stackedSurfaceKeys.filter((surfaceKey) => {
				const entry = surfaceStore.entriesByKey[surfaceKey];
				return Boolean(entry) && entry.retention !== "closed" && entry.retention !== "collapsed-summary";
			}),
			summaryRowKeys,
		},
		transportHealth: { ...reducerState.transportHealth },
		eventLogTail: [...eventLogTail],
		overlays: {
			visibleEntries,
			hiddenOverlayIds: [...hiddenOverlayIds],
			focusedOverlayId: focusedOverlayId ?? stackedOverlayIds[stackedOverlayIds.length - 1],
			stackedOverlayIds,
		},
		recentErrors: [...reducerState.recentErrors],
		controlPlane,
		terminalStatus: { ...controlPlane.terminalState, ambiguityNotes: [...controlPlane.terminalState.ambiguityNotes] },
		isLiveRunComplete: controlPlane.terminalState.status !== "running",
	};
}

export function createEventLogTailEntry(event: OrcBusEvent): OrcTuiEventLogTailEntry {
	return {
		eventId: event.envelope.origin.eventId,
		kind: event.kind,
		when: event.envelope.when,
		summary: event.envelope.what.description ?? event.envelope.what.name,
		severity: event.envelope.what.severity,
		threadId: event.envelope.origin.threadId,
		runCorrelationId: event.envelope.origin.runCorrelationId,
		workerId: event.envelope.origin.workerId,
	};
}

export function createEmptyControlPlaneState(threadId = "unknown-thread", project?: OrcProjectContext): OrcControlPlaneState {
	return {
		threadId,
		phase: "idle",
		project: project ?? { projectId: "unknown-project", projectRoot: "" },
		messages: [],
		securityEvents: [],
		workerResults: [],
		verificationErrors: [],
		checkpointMetadata: createInitialCheckpointMetadataSummary(),
		transportHealth: createInitialReducedTransportHealth(),
		terminalState: createInitialTerminalStateSummary(),
		lastUpdatedAt: new Date(0).toISOString(),
	};
}

export function cloneReducerState(state: OrcEventReducerState): OrcEventReducerState {
	return {
		latestActivityByAgent: { ...state.latestActivityByAgent },
		activeOverlays: [...state.activeOverlays],
		waveCounts: { ...state.waveCounts, byWaveId: { ...state.waveCounts.byWaveId } },
		transportHealth: { ...state.transportHealth },
		recentErrors: [...state.recentErrors],
	};
}

export function cloneControlPlaneState(state: OrcControlPlaneState): OrcControlPlaneState {
	return {
		...state,
		messages: [...state.messages],
		securityEvents: state.securityEvents ? [...state.securityEvents] : [],
		workerResults: state.workerResults.map((result) => ({ ...result, artifactIds: [...result.artifactIds], logIds: [...result.logIds], metadata: result.metadata ? { ...result.metadata } : undefined })),
		verificationErrors: state.verificationErrors.map((entry) => ({ ...entry })),
		activeWave: state.activeWave ? { ...state.activeWave, workerIds: [...state.activeWave.workerIds] } : undefined,
		checkpointMetadata: { ...state.checkpointMetadata, artifactBundleIds: [...state.checkpointMetadata.artifactBundleIds], rewindTargetIds: [...state.checkpointMetadata.rewindTargetIds] },
		transportHealth: { ...state.transportHealth },
		terminalState: { ...state.terminalState, ambiguityNotes: [...state.terminalState.ambiguityNotes] },
	};
}

export function compareOverlayEntries(a: OrcActiveOverlay, b: OrcActiveOverlay): number {
	if (a.updatedAt !== b.updatedAt) {
		return a.updatedAt.localeCompare(b.updatedAt);
	}
	return a.id.localeCompare(b.id);
}

export function uniqueStringValues(values: Array<string | undefined>): string[] {
	const seen = new Set<string>();
	const ordered: string[] = [];
	for (const value of values) {
		if (!value || seen.has(value)) {
			continue;
		}
		seen.add(value);
		ordered.push(value);
	}
	return ordered;
}
