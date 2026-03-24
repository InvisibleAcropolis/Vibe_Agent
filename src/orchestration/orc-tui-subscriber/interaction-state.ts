import type { OrcBusEvent } from "../orc-events/types.js";
import {
	closeSubagentSurface as closeSubagentSurfaceInStore,
	createEmptySurfaceStore,
	focusOverlayInSurfaceStore,
	focusSubagentSurface as focusSubagentSurfaceInStore,
	reduceSubagentSurfaceStore,
} from "./subagent-surfaces.js";
import type { OrcSubagentSurfaceStore } from "./types.js";
import { uniqueStringValues } from "./view-state.js";

export interface OrcTuiInteractionState {
	hiddenOverlayIds: string[];
	focusedOverlayId?: string;
	surfaceStore: OrcSubagentSurfaceStore;
}

export function createInteractionState(): OrcTuiInteractionState {
	return {
		hiddenOverlayIds: [],
		surfaceStore: createEmptySurfaceStore(),
	};
}

export function reduceInteractionTelemetryEvent(state: OrcTuiInteractionState, event: OrcBusEvent): OrcTuiInteractionState {
	return {
		...state,
		surfaceStore: reduceSubagentSurfaceStore(state.surfaceStore, event),
	};
}

export function closeSubagentSurface(state: OrcTuiInteractionState, surfaceKey: string): OrcTuiInteractionState {
	return {
		...state,
		surfaceStore: closeSubagentSurfaceInStore(state.surfaceStore, surfaceKey),
	};
}

export function focusSubagentSurface(state: OrcTuiInteractionState, surfaceKey: string): OrcTuiInteractionState {
	return {
		...state,
		surfaceStore: focusSubagentSurfaceInStore(state.surfaceStore, surfaceKey),
	};
}

export function hideOverlay(state: OrcTuiInteractionState, overlayId: string): OrcTuiInteractionState {
	return {
		...state,
		hiddenOverlayIds: uniqueStringValues([overlayId, ...state.hiddenOverlayIds]),
	};
}

export function showOverlay(state: OrcTuiInteractionState, overlayId: string): OrcTuiInteractionState {
	return {
		...state,
		hiddenOverlayIds: state.hiddenOverlayIds.filter((id) => id !== overlayId),
	};
}

export function focusOverlay(state: OrcTuiInteractionState, overlayId: string): OrcTuiInteractionState {
	return {
		...state,
		focusedOverlayId: overlayId,
		hiddenOverlayIds: state.hiddenOverlayIds.filter((id) => id !== overlayId),
		surfaceStore: focusOverlayInSurfaceStore(state.surfaceStore, overlayId),
	};
}
