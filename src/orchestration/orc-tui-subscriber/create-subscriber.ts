import type { OrcEventBusSubscription } from "../orc-event-bus.js";
import { ORC_EVENT_REDUCER_INITIAL_STATE, reduceOrcBusEvent, reduceOrcControlPlaneEvent } from "../orc-events/index.js";
import { createOrcTuiEventBuffer } from "./event-buffer.js";
import {
	closeSubagentSurface,
	createEmptySurfaceStore,
	focusOverlayInSurfaceStore,
	focusSubagentSurface,
	reduceSubagentSurfaceStore,
} from "./subagent-surfaces.js";
import type { OrcTuiTelemetryState, OrcTuiTelemetrySubscriber, OrcTuiTelemetrySubscriberOptions } from "./types.js";
import {
	cloneControlPlaneState,
	cloneReducerState,
	createEmptyControlPlaneState,
	createViewState,
	uniqueStringValues,
} from "./view-state.js";

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
	let hiddenOverlayIds: string[] = [];
	let busSubscription: OrcEventBusSubscription | undefined;

	const notify = () => {
		for (const listener of listeners) {
			listener(state);
		}
	};

	const rebuildState = (eventLogTail = state.eventLogTail, focusedOverlayId = state.overlays.focusedOverlayId) => {
		state = createViewState(controlPlane, reducerState, surfaceStore, eventLogTail, hiddenOverlayIds, focusedOverlayId);
	};

	const eventBuffer = createOrcTuiEventBuffer({
		maxEventLogEntries,
		batchWindowMs,
		onFlush(pendingTail) {
			const mergedTail = [...pendingTail, ...state.eventLogTail].slice(0, maxEventLogEntries);
			rebuildState(mergedTail);
			notify();
		},
	});

	const handleEvent = (event: Parameters<typeof reduceOrcBusEvent>[1]) => {
		if (!eventBuffer.handleEvent(event)) {
			return;
		}
		reducerState = reduceOrcBusEvent(reducerState, event);
		controlPlane = reduceOrcControlPlaneEvent(controlPlane, event);
		surfaceStore = reduceSubagentSurfaceStore(surfaceStore, event);
	};

	const emitImmediate = (focusedOverlayId = state.overlays.focusedOverlayId) => {
		rebuildState(eventBuffer.flushNow(state.eventLogTail), focusedOverlayId);
		notify();
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
			hiddenOverlayIds = [];
			eventBuffer.reset();
			rebuildState([], undefined);
			notify();
		},
		closeSubagentSurface(surfaceKey) {
			surfaceStore = closeSubagentSurface(surfaceStore, surfaceKey);
			emitImmediate();
		},
		focusSubagentSurface(surfaceKey) {
			surfaceStore = focusSubagentSurface(surfaceStore, surfaceKey);
			emitImmediate();
		},
		hideOverlay(overlayId) {
			hiddenOverlayIds = uniqueStringValues([overlayId, ...hiddenOverlayIds]);
			emitImmediate();
		},
		showOverlay(overlayId) {
			hiddenOverlayIds = hiddenOverlayIds.filter((id) => id !== overlayId);
			emitImmediate();
		},
		focusOverlay(overlayId) {
			hiddenOverlayIds = hiddenOverlayIds.filter((id) => id !== overlayId);
			surfaceStore = focusOverlayInSurfaceStore(surfaceStore, overlayId);
			emitImmediate(overlayId);
		},
		dispose() {
			busSubscription?.unsubscribe();
			busSubscription = undefined;
			listeners.clear();
			eventBuffer.dispose();
		},
	};
}
