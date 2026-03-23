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

export type OrcSubagentSurfaceLifecycle = "open" | "running" | "completed" | "failed" | "closed";
export type OrcSubagentSurfaceRetention = "expanded" | "background" | "collapsed-summary" | "closed";

export interface OrcSubagentIdentity {
	surfaceKey: string;
	runCorrelationId: string;
	waveId: string;
	agentId: string;
	workerId: string;
}

export interface OrcSubagentSurfaceEntry {
	identity: OrcSubagentIdentity;
	label: string;
	status: OrcSubagentSurfaceLifecycle;
	retention: OrcSubagentSurfaceRetention;
	isFocused: boolean;
	stackOrder: number;
	openedAt: string;
	updatedAt: string;
	collapsedAt?: string;
	closedAt?: string;
	summary: string;
	lastEventKind: OrcBusEvent["kind"];
	severity: OrcBusEvent["envelope"]["what"]["severity"];
	rawEvent: OrcBusEvent;
}

export interface OrcTuiOverlayState {
	visibleEntries: OrcActiveOverlay[];
	hiddenOverlayIds: string[];
	focusedOverlayId?: string;
	stackedOverlayIds: string[];
}

export interface OrcTuiSubagentSurfaceState {
	entries: OrcSubagentSurfaceEntry[];
	focusedSurfaceKey?: string;
	stackedSurfaceKeys: string[];
	summaryRowKeys: string[];
}

export interface OrcTuiTelemetryState {
	threadId?: string;
	runCorrelationId?: string;
	dashboard: OrcTrackerDashboardViewModel;
	subagentActivity: OrcLatestActivityRecord[];
	subagentSurfaces: OrcTuiSubagentSurfaceState;
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
	closeSubagentSurface(surfaceKey: string): void;
	focusSubagentSurface(surfaceKey: string): void;
	hideOverlay(overlayId: string): void;
	showOverlay(overlayId: string): void;
	focusOverlay(overlayId: string): void;
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
 * - Subagent identity is stable for the lifetime of one execution attempt and is derived from canonical event fields in
 *   `src/orchestration/orc-events.ts`: `origin.runCorrelationId`, `origin.waveId`, and the agent/worker identity.
 *   This keeps stacking/focus deterministic even when labels or summaries change mid-run.
 * - Run completion does not clear state immediately; the final reduced snapshot remains available until a thread switch
 *   or an explicit adapter disposal resets it.
 * - `switchThread()` intentionally resets transient overlays/event-log state before any new bus traffic arrives so a newly
 *   selected thread cannot inherit stale activity from the previous thread.
 * - Closing overlays in the UI must only hide the overlay view; the subscriber continues reducing live events so the
 *   operator can reopen the overlay and see current state while the underlying run keeps executing.
 * - Completed/failed subagents are retained as collapsed summary rows once they lose focus so operators can audit outcomes
 *   without permanently occupying overlay space. Explicit close removes them from the active stack but does not rewrite
 *   previously reduced activity ordering.
 * - Event bursts are coalesced into a single listener notification per batch window to avoid unnecessary TUI rerenders.
 */
export function createOrcTuiTelemetrySubscriber(options: OrcTuiTelemetrySubscriberOptions = {}): OrcTuiTelemetrySubscriber {
	const listeners = new Set<(state: OrcTuiTelemetryState) => void>();
	const maxEventLogEntries = Math.max(1, options.maxEventLogEntries ?? DEFAULT_MAX_EVENT_LOG_ENTRIES);
	const batchWindowMs = Math.max(0, options.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS);
	let reducerState = cloneReducerState(ORC_EVENT_REDUCER_INITIAL_STATE);
	let controlPlane = cloneControlPlaneState(options.initialState ?? createEmptyControlPlaneState(options.threadId, options.project));
	let surfaceStore = createEmptySurfaceStore();
	let state = createViewState(controlPlane, reducerState, surfaceStore, []);
	let pendingTail: OrcTuiEventLogTailEntry[] = [];
	let seenEventIds = new Set<string>();
	let flushTimer: NodeJS.Timeout | undefined;
	let busSubscription: OrcEventBusSubscription | undefined;

	const emit = () => {
		flushTimer = undefined;
		if (pendingTail.length > 0) {
			const mergedTail = [...pendingTail, ...state.eventLogTail].slice(0, maxEventLogEntries);
			state = createViewState(controlPlane, reducerState, surfaceStore, mergedTail, state.overlays.hiddenOverlayIds);
			pendingTail = [];
		} else {
			state = createViewState(controlPlane, reducerState, surfaceStore, state.eventLogTail, state.overlays.hiddenOverlayIds);
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
		if (seenEventIds.has(event.envelope.origin.eventId)) {
			return;
		}
		seenEventIds.add(event.envelope.origin.eventId);
		reducerState = reduceOrcBusEvent(reducerState, event);
		controlPlane = reduceOrcControlPlaneEvent(controlPlane, event);
		surfaceStore = reduceSubagentSurfaceStore(surfaceStore, event);
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
			surfaceStore = createEmptySurfaceStore();
			pendingTail = [];
			seenEventIds = new Set();
			state = createViewState(controlPlane, reducerState, surfaceStore, [], []);
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = undefined;
			}
			for (const listener of listeners) {
				listener(state);
			}
		},
		closeSubagentSurface(surfaceKey) {
			surfaceStore = closeSubagentSurface(surfaceStore, surfaceKey);
			state = createViewState(controlPlane, reducerState, surfaceStore, state.eventLogTail, state.overlays.hiddenOverlayIds);
			for (const listener of listeners) {
				listener(state);
			}
		},
		focusSubagentSurface(surfaceKey) {
			surfaceStore = focusSubagentSurface(surfaceStore, surfaceKey);
			state = createViewState(controlPlane, reducerState, surfaceStore, state.eventLogTail, state.overlays.hiddenOverlayIds);
			for (const listener of listeners) {
				listener(state);
			}
		},
		hideOverlay(overlayId) {
			const hidden = uniqueStringValues([overlayId, ...state.overlays.hiddenOverlayIds]);
			state = createViewState(controlPlane, reducerState, surfaceStore, state.eventLogTail, hidden);
			for (const listener of listeners) {
				listener(state);
			}
		},
		showOverlay(overlayId) {
			const hidden = state.overlays.hiddenOverlayIds.filter((id) => id !== overlayId);
			state = createViewState(controlPlane, reducerState, surfaceStore, state.eventLogTail, hidden);
			for (const listener of listeners) {
				listener(state);
			}
		},
		focusOverlay(overlayId) {
			const hidden = state.overlays.hiddenOverlayIds.filter((id) => id !== overlayId);
			state = createViewState(controlPlane, reducerState, focusOverlayInSurfaceStore(surfaceStore, overlayId), state.eventLogTail, hidden, overlayId);
			for (const listener of listeners) {
				listener(state);
			}
		},
		dispose() {
			busSubscription?.unsubscribe();
			busSubscription = undefined;
			listeners.clear();
			seenEventIds = new Set();
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = undefined;
			}
		},
	};
}

interface OrcSubagentSurfaceStore {
	entriesByKey: Record<string, OrcSubagentSurfaceEntry>;
	stackedSurfaceKeys: string[];
	focusedSurfaceKey?: string;
	nextStackOrder: number;
}

function createViewState(
	controlPlane: OrcControlPlaneState,
	reducerState: OrcEventReducerState,
	surfaceStore: OrcSubagentSurfaceStore,
	eventLogTail: OrcTuiEventLogTailEntry[],
	hiddenOverlayIds: string[] = [],
	focusedOverlayId?: string,
): OrcTuiTelemetryState {
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

function createEmptySurfaceStore(): OrcSubagentSurfaceStore {
	return {
		entriesByKey: {},
		stackedSurfaceKeys: [],
		nextStackOrder: 1,
	};
}

function reduceSubagentSurfaceStore(state: OrcSubagentSurfaceStore, event: OrcBusEvent): OrcSubagentSurfaceStore {
	const identity = deriveSubagentIdentity(event);
	if (!identity) {
		return state;
	}
	const prior = state.entriesByKey[identity.surfaceKey];
	const lifecycle = deriveSurfaceLifecycle(event, prior);
	const next: OrcSubagentSurfaceEntry = {
		identity,
		label: event.envelope.who.label,
		status: lifecycle,
		retention: deriveSurfaceRetention(lifecycle, prior, state.focusedSurfaceKey === identity.surfaceKey),
		isFocused: false,
		stackOrder: prior?.stackOrder ?? state.nextStackOrder,
		openedAt: prior?.openedAt ?? event.envelope.when,
		updatedAt: event.envelope.when,
		collapsedAt: prior?.collapsedAt,
		closedAt: prior?.closedAt,
		summary: event.envelope.what.description ?? event.envelope.what.name,
		lastEventKind: event.kind,
		severity: event.envelope.what.severity,
		rawEvent: event,
	};
	if ((lifecycle === "completed" || lifecycle === "failed") && state.focusedSurfaceKey !== identity.surfaceKey) {
		next.retention = "collapsed-summary";
		next.collapsedAt = event.envelope.when;
	}
	const entriesByKey = { ...state.entriesByKey, [identity.surfaceKey]: next };
	const stackedSurfaceKeys = updateStackedSurfaceKeys(state, next);
	const focusedSurfaceKey = pickFocusedSurfaceKey(stackedSurfaceKeys, entriesByKey, identity.surfaceKey);
	for (const key of Object.keys(entriesByKey)) {
		entriesByKey[key] = { ...entriesByKey[key]!, isFocused: key === focusedSurfaceKey };
	}
	return {
		entriesByKey,
		stackedSurfaceKeys,
		focusedSurfaceKey,
		nextStackOrder: prior ? state.nextStackOrder : state.nextStackOrder + 1,
	};
}

function closeSubagentSurface(state: OrcSubagentSurfaceStore, surfaceKey: string): OrcSubagentSurfaceStore {
	const prior = state.entriesByKey[surfaceKey];
	if (!prior) {
		return state;
	}
	const closedEntry: OrcSubagentSurfaceEntry = {
		...prior,
		status: "closed",
		retention: "closed",
		isFocused: false,
		closedAt: prior.closedAt ?? prior.updatedAt,
	};
	const entriesByKey: Record<string, OrcSubagentSurfaceEntry> = {
		...state.entriesByKey,
		[surfaceKey]: closedEntry,
	};
	const stackedSurfaceKeys = state.stackedSurfaceKeys.filter((key) => key !== surfaceKey);
	const focusedSurfaceKey = pickFocusedSurfaceKey(stackedSurfaceKeys, entriesByKey);
	for (const key of Object.keys(entriesByKey)) {
		entriesByKey[key] = { ...entriesByKey[key]!, isFocused: key === focusedSurfaceKey };
	}
	return { ...state, entriesByKey, stackedSurfaceKeys, focusedSurfaceKey };
}

function focusSubagentSurface(state: OrcSubagentSurfaceStore, surfaceKey: string): OrcSubagentSurfaceStore {
	const prior = state.entriesByKey[surfaceKey];
	if (!prior || prior.retention === "closed") {
		return state;
	}
	const entriesByKey = { ...state.entriesByKey };
	entriesByKey[surfaceKey] = {
		...prior,
		retention: prior.status === "completed" || prior.status === "failed" ? "background" : "expanded",
		collapsedAt: undefined,
	};
	const stackedSurfaceKeys = [...state.stackedSurfaceKeys.filter((key) => key !== surfaceKey), surfaceKey];
	for (const key of stackedSurfaceKeys) {
		const entry = entriesByKey[key];
		if (!entry) {
			continue;
		}
		entriesByKey[key] = { ...entry, isFocused: key === surfaceKey };
	}
	return { ...state, entriesByKey, stackedSurfaceKeys, focusedSurfaceKey: surfaceKey };
}

function focusOverlayInSurfaceStore(state: OrcSubagentSurfaceStore, _overlayId: string): OrcSubagentSurfaceStore {
	return state;
}

function deriveSubagentIdentity(event: OrcBusEvent): OrcSubagentIdentity | undefined {
	const runCorrelationId = event.envelope.origin.runCorrelationId;
	const waveId = event.envelope.origin.waveId ?? ("waveId" in event.payload && typeof event.payload.waveId === "string" ? event.payload.waveId : undefined);
	const agentId = event.envelope.who.kind === "agent"
		? event.envelope.who.id
		: ("agentId" in event.payload && typeof event.payload.agentId === "string" ? event.payload.agentId : undefined);
	const workerId = event.envelope.origin.workerId ?? event.envelope.who.workerId ?? ("workerId" in event.payload && typeof event.payload.workerId === "string" ? event.payload.workerId : undefined);
	if (!runCorrelationId || !waveId || !agentId || !workerId) {
		return undefined;
	}
	return {
		surfaceKey: `subagent:${runCorrelationId}:${waveId}:${agentId}:${workerId}`,
		runCorrelationId,
		waveId,
		agentId,
		workerId,
	};
}

function deriveSurfaceLifecycle(event: OrcBusEvent, prior?: OrcSubagentSurfaceEntry): OrcSubagentSurfaceLifecycle {
	if (event.kind === "worker.status") {
		switch (event.payload.status) {
			case "completed": return "completed";
			case "failed":
			case "cancelled": return "failed";
			case "queued": return prior ? "running" : "open";
			default: return "running";
		}
	}
	if (event.kind === "tool.result" && event.payload.status !== "succeeded") {
		return "failed";
	}
	if (event.kind === "transport.fault") {
		return "failed";
	}
	return prior?.status ?? "open";
}

function deriveSurfaceRetention(
	lifecycle: OrcSubagentSurfaceLifecycle,
	prior: OrcSubagentSurfaceEntry | undefined,
	wasFocused: boolean,
): OrcSubagentSurfaceRetention {
	if (prior?.retention === "closed" || lifecycle === "closed") {
		return "closed";
	}
	if (lifecycle === "completed" || lifecycle === "failed") {
		return wasFocused ? "background" : "collapsed-summary";
	}
	if (!prior) {
		return "expanded";
	}
	if (prior.retention === "collapsed-summary") {
		return "background";
	}
	return prior.retention === "background" ? "background" : "expanded";
}

function updateStackedSurfaceKeys(state: OrcSubagentSurfaceStore, next: OrcSubagentSurfaceEntry): string[] {
	const filtered = state.stackedSurfaceKeys.filter((key) => key !== next.identity.surfaceKey);
	if (next.retention === "collapsed-summary" || next.retention === "closed") {
		return filtered;
	}
	return [...filtered, next.identity.surfaceKey];
}

function pickFocusedSurfaceKey(
	stackedSurfaceKeys: string[],
	entriesByKey: Record<string, OrcSubagentSurfaceEntry>,
	preferredKey?: string,
): string | undefined {
	if (preferredKey && stackedSurfaceKeys.includes(preferredKey)) {
		return preferredKey;
	}
	const visibleStack = stackedSurfaceKeys.filter((key) => {
		const entry = entriesByKey[key];
		return Boolean(entry) && entry.retention !== "closed" && entry.retention !== "collapsed-summary";
	});
	return visibleStack[visibleStack.length - 1];
}

function getOrderedSurfaceEntries(state: OrcSubagentSurfaceStore): OrcSubagentSurfaceEntry[] {
	return Object.values(state.entriesByKey)
		.sort((a, b) => {
			const retentionRank = rankRetention(a.retention) - rankRetention(b.retention);
			if (retentionRank !== 0) {
				return retentionRank;
			}
			if (a.stackOrder !== b.stackOrder) {
				return a.stackOrder - b.stackOrder;
			}
			return a.identity.surfaceKey.localeCompare(b.identity.surfaceKey);
		});
}

function rankRetention(retention: OrcSubagentSurfaceRetention): number {
	switch (retention) {
		case "expanded": return 0;
		case "background": return 1;
		case "collapsed-summary": return 2;
		case "closed": return 3;
	}
}

function compareOverlayEntries(a: OrcActiveOverlay, b: OrcActiveOverlay): number {
	if (a.updatedAt !== b.updatedAt) {
		return a.updatedAt.localeCompare(b.updatedAt);
	}
	return a.id.localeCompare(b.id);
}

function uniqueStringValues(values: Array<string | undefined>): string[] {
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
