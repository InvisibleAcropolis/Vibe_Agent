import type { OrcEventBus, OrcEventBusSubscription } from "./orc-event-bus.js";
import {
	ORC_EVENT_REDUCER_INITIAL_STATE,
	reduceOrcBusEvent,
	type OrcActiveOverlay,
	type OrcBusEvent,
	type OrcEventReducerState,
	type OrcLatestActivityRecord,
	type OrcReducedErrorEntry,
} from "./orc-events.js";
import { createInitialCheckpointMetadataSummary, createInitialReducedTransportHealth, createInitialTerminalStateSummary, reduceOrcControlPlaneEvent } from "./orc-events.js";
import { createOrcTrackerDashboardViewModel, type OrcTrackerDashboardViewModel } from "./orc-tracker.js";
import type { OrcControlPlaneState, OrcProjectContext } from "./orc-state.js";

export interface OrcTuiEventLogTailEntry {
	eventId: string;
	kind: OrcBusEvent["kind"];
	when: string;
	summary: string;
	severity: OrcBusEvent["envelope"]["what"]["severity"];
	threadId?: string;
	runCorrelationId?: string;
	workerId?: string;
}

export interface OrcTuiOverlayState {
	visibleEntries: OrcActiveOverlay[];
	hiddenOverlayIds: string[];
}

export interface OrcTuiTelemetryState {
	threadId?: string;
	runCorrelationId?: string;
	dashboard: OrcTrackerDashboardViewModel;
	subagentActivity: OrcLatestActivityRecord[];
	transportHealth: OrcEventReducerState["transportHealth"];
	eventLogTail: OrcTuiEventLogTailEntry[];
	overlays: OrcTuiOverlayState;
	recentErrors: OrcReducedErrorEntry[];
	controlPlane: OrcControlPlaneState;
	terminalStatus: OrcControlPlaneState["terminalState"];
	isLiveRunComplete: boolean;
}

export interface OrcTuiTelemetrySubscriberOptions {
	threadId?: string;
	initialState?: OrcControlPlaneState;
	maxEventLogEntries?: number;
	batchWindowMs?: number;
	project?: OrcProjectContext;
}

export interface OrcTuiTelemetrySubscriber {
	attach(bus: OrcEventBus, filter?: { runCorrelationId?: string; threadId?: string }): OrcEventBusSubscription;
	subscribe(listener: (state: OrcTuiTelemetryState) => void): () => void;
	getState(): OrcTuiTelemetryState;
	switchThread(threadId: string, initialState?: OrcControlPlaneState): void;
	dispose(): void;
}

const DEFAULT_MAX_EVENT_LOG_ENTRIES = 40;
const DEFAULT_BATCH_WINDOW_MS = 16;

/**
 * TUI subscriber boundary rules for outside engineers:
 * - Views/controllers consume only this reduced adapter state; they must not subscribe directly to the raw transport,
 *   parser chunks, or child-process lifecycle emitters.
 * - Dashboard surfaces own thread/run summary fields. Overlay surfaces own transient detail visibility only.
 *   Pane surfaces own always-on summaries such as subagent activity, transport health, and event-log tail.
 * - Run completion does not clear state immediately; the final reduced snapshot remains available until a thread switch
 *   or an explicit adapter disposal resets it.
 * - `switchThread()` intentionally resets transient overlays/event-log state before any new bus traffic arrives so a newly
 *   selected thread cannot inherit stale activity from the previous thread.
 * - Closing overlays in the UI must only hide the overlay view; the subscriber continues reducing live events so the
 *   operator can reopen the overlay and see current state while the underlying run keeps executing.
 * - Event bursts are coalesced into a single listener notification per batch window to avoid unnecessary TUI rerenders.
 */
export function createOrcTuiTelemetrySubscriber(options: OrcTuiTelemetrySubscriberOptions = {}): OrcTuiTelemetrySubscriber {
	const listeners = new Set<(state: OrcTuiTelemetryState) => void>();
	const maxEventLogEntries = Math.max(1, options.maxEventLogEntries ?? DEFAULT_MAX_EVENT_LOG_ENTRIES);
	const batchWindowMs = Math.max(0, options.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS);
	let reducerState = cloneReducerState(ORC_EVENT_REDUCER_INITIAL_STATE);
	let controlPlane = cloneControlPlaneState(options.initialState ?? createEmptyControlPlaneState(options.threadId, options.project));
	let state = createViewState(controlPlane, reducerState, []);
	let pendingTail: OrcTuiEventLogTailEntry[] = [];
	let flushTimer: NodeJS.Timeout | undefined;
	let busSubscription: OrcEventBusSubscription | undefined;

	const emit = () => {
		flushTimer = undefined;
		if (pendingTail.length > 0) {
			const mergedTail = [...pendingTail, ...state.eventLogTail].slice(0, maxEventLogEntries);
			state = createViewState(controlPlane, reducerState, mergedTail, state.overlays.hiddenOverlayIds);
			pendingTail = [];
		} else {
			state = createViewState(controlPlane, reducerState, state.eventLogTail, state.overlays.hiddenOverlayIds);
		}
		for (const listener of listeners) {
			listener(state);
		}
	};

	const scheduleEmit = () => {
		if (flushTimer) {
			return;
		}
		flushTimer = setTimeout(emit, batchWindowMs);
	};

	const handleEvent = (event: OrcBusEvent) => {
		reducerState = reduceOrcBusEvent(reducerState, event);
		controlPlane = reduceOrcControlPlaneEvent(controlPlane, event);
		pendingTail = [
			createEventLogTailEntry(event),
			...pendingTail,
		].slice(0, maxEventLogEntries);
		scheduleEmit();
	};

	return {
		attach(bus, filter) {
			busSubscription?.unsubscribe();
			busSubscription = bus.subscribe((event) => {
				handleEvent(event);
			}, {
				label: "orc-tui-telemetry",
				handlerKind: "tui-subscriber",
				filter,
				maxQueueSize: 500,
			});
			return busSubscription;
		},
		subscribe(listener) {
			listeners.add(listener);
			listener(state);
			return () => listeners.delete(listener);
		},
		getState() {
			return state;
		},
		switchThread(threadId, initialState) {
			controlPlane = cloneControlPlaneState(initialState ?? createEmptyControlPlaneState(threadId, options.project));
			reducerState = cloneReducerState(ORC_EVENT_REDUCER_INITIAL_STATE);
			pendingTail = [];
			state = createViewState(controlPlane, reducerState, [], []);
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = undefined;
			}
			for (const listener of listeners) {
				listener(state);
			}
		},
		dispose() {
			busSubscription?.unsubscribe();
			busSubscription = undefined;
			listeners.clear();
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = undefined;
			}
		},
	};
}

function createViewState(
	controlPlane: OrcControlPlaneState,
	reducerState: OrcEventReducerState,
	eventLogTail: OrcTuiEventLogTailEntry[],
	hiddenOverlayIds: string[] = [],
): OrcTuiTelemetryState {
	return {
		threadId: controlPlane.threadId,
		runCorrelationId: undefined,
		dashboard: createOrcTrackerDashboardViewModel(controlPlane),
		subagentActivity: Object.values(reducerState.latestActivityByAgent).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
		transportHealth: { ...reducerState.transportHealth },
		eventLogTail: [...eventLogTail],
		overlays: {
			visibleEntries: [...reducerState.activeOverlays],
			hiddenOverlayIds: [...hiddenOverlayIds],
		},
		recentErrors: [...reducerState.recentErrors],
		controlPlane,
		terminalStatus: { ...controlPlane.terminalState, ambiguityNotes: [...controlPlane.terminalState.ambiguityNotes] },
		isLiveRunComplete: controlPlane.terminalState.status !== "running",
	};
}

function createEventLogTailEntry(event: OrcBusEvent): OrcTuiEventLogTailEntry {
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

function createEmptyControlPlaneState(threadId = "unknown-thread", project?: OrcProjectContext): OrcControlPlaneState {
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

function cloneReducerState(state: OrcEventReducerState): OrcEventReducerState {
	return {
		latestActivityByAgent: { ...state.latestActivityByAgent },
		activeOverlays: [...state.activeOverlays],
		waveCounts: { ...state.waveCounts, byWaveId: { ...state.waveCounts.byWaveId } },
		transportHealth: { ...state.transportHealth },
		recentErrors: [...state.recentErrors],
	};
}

function cloneControlPlaneState(state: OrcControlPlaneState): OrcControlPlaneState {
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
