import { ORC_EVENT_REDUCER_INITIAL_STATE, reduceOrcBusEvent, reduceOrcControlPlaneEvent } from "../orc-events/index.js";
import type { OrcBusEvent, OrcEventReducerState } from "../orc-events/index.js";
import type { OrcControlPlaneState, OrcProjectContext } from "../orc-state.js";
import type { OrcTuiEventLogTailEntry } from "./types.js";
import { cloneControlPlaneState, cloneReducerState, createEmptyControlPlaneState } from "./view-state.js";

export interface OrcTuiTelemetryReductionState {
	reducerState: OrcEventReducerState;
	controlPlane: OrcControlPlaneState;
}

export function createTelemetryReductionState(options: {
	threadId?: string;
	initialState?: OrcControlPlaneState;
	project?: OrcProjectContext;
} = {}): OrcTuiTelemetryReductionState {
	return {
		reducerState: cloneReducerState(ORC_EVENT_REDUCER_INITIAL_STATE),
		controlPlane: cloneControlPlaneState(options.initialState ?? createEmptyControlPlaneState(options.threadId, options.project)),
	};
}

export function reduceTelemetryState(state: OrcTuiTelemetryReductionState, event: OrcBusEvent): OrcTuiTelemetryReductionState {
	return {
		reducerState: reduceOrcBusEvent(state.reducerState, event),
		controlPlane: reduceOrcControlPlaneEvent(state.controlPlane, event),
	};
}

export function mergeEventLogTail(
	existingTail: OrcTuiEventLogTailEntry[],
	pendingTail: OrcTuiEventLogTailEntry[],
	maxEventLogEntries: number,
): OrcTuiEventLogTailEntry[] {
	return pendingTail
		.concat(existingTail)
		.slice(0, maxEventLogEntries);
}
