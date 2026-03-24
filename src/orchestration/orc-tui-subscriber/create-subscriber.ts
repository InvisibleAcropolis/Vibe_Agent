import type { OrcEventBusSubscription } from "../orc-event-bus.js";
import { createOrcTuiEventBuffer } from "./event-buffer.js";
import {
	closeSubagentSurface,
	createInteractionState,
	focusOverlay,
	focusSubagentSurface,
	hideOverlay,
	reduceInteractionTelemetryEvent,
	showOverlay,
} from "./interaction-state.js";
import type { OrcTuiTelemetryState, OrcTuiTelemetrySubscriber, OrcTuiTelemetrySubscriberOptions } from "./types.js";
import { createTelemetryReductionState, mergeEventLogTail, reduceTelemetryState } from "./telemetry-reduction.js";
import { createViewState } from "./view-state.js";

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
	let telemetryState = createTelemetryReductionState(options);
	let interactionState = createInteractionState();
	let state = createViewState(telemetryState, interactionState, []);
	let busSubscription: OrcEventBusSubscription | undefined;

	const notify = () => {
		for (const listener of listeners) {
			listener(state);
		}
	};

	const rebuildState = (eventLogTail = state.eventLogTail) => {
		state = createViewState(telemetryState, interactionState, eventLogTail);
	};

	const eventBuffer = createOrcTuiEventBuffer({
		maxEventLogEntries,
		batchWindowMs,
		onFlush(pendingTail) {
			const mergedTail = mergeEventLogTail(state.eventLogTail, pendingTail, maxEventLogEntries);
			rebuildState(mergedTail);
			notify();
		},
	});

	const handleEvent = (event: Parameters<typeof reduceTelemetryState>[1]) => {
		if (!eventBuffer.handleEvent(event)) {
			return;
		}
		telemetryState = reduceTelemetryState(telemetryState, event);
		interactionState = reduceInteractionTelemetryEvent(interactionState, event);
	};

	const emitImmediate = () => {
		rebuildState(mergeEventLogTail(state.eventLogTail, eventBuffer.flushNow([]), maxEventLogEntries));
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
			telemetryState = createTelemetryReductionState({ threadId, initialState, project: options.project });
			interactionState = createInteractionState();
			eventBuffer.reset();
			rebuildState([]);
			notify();
		},
		closeSubagentSurface(surfaceKey) {
			interactionState = closeSubagentSurface(interactionState, surfaceKey);
			emitImmediate();
		},
		focusSubagentSurface(surfaceKey) {
			interactionState = focusSubagentSurface(interactionState, surfaceKey);
			emitImmediate();
		},
		hideOverlay(overlayId) {
			interactionState = hideOverlay(interactionState, overlayId);
			emitImmediate();
		},
		showOverlay(overlayId) {
			interactionState = showOverlay(interactionState, overlayId);
			emitImmediate();
		},
		focusOverlay(overlayId) {
			interactionState = focusOverlay(interactionState, overlayId);
			emitImmediate();
		},
		dispose() {
			busSubscription?.unsubscribe();
			busSubscription = undefined;
			listeners.clear();
			eventBuffer.dispose();
		},
	};
}
