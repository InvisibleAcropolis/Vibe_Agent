import type {
	OrcActiveOverlay,
	OrcBusEvent,
	OrcEventReducerState,
	OrcLatestActivityRecord,
	OrcReducedErrorEntry,
} from "../orc-events/index.js";
import type { OrcTrackerDashboardViewModel } from "../orc-tracker.js";
import type { OrcControlPlaneState, OrcProjectContext } from "../orc-state.js";
import type { OrcEventBus, OrcEventBusSubscription } from "../orc-event-bus.js";

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

export interface OrcSubagentSurfaceStore {
	entriesByKey: Record<string, OrcSubagentSurfaceEntry>;
	stackedSurfaceKeys: string[];
	focusedSurfaceKey?: string;
	nextStackOrder: number;
}

export interface OrcTuiInternalState {
	reducerState: OrcEventReducerState;
	controlPlane: OrcControlPlaneState;
	surfaceStore: OrcSubagentSurfaceStore;
	viewState: OrcTuiTelemetryState;
	hiddenOverlayIds: string[];
}
