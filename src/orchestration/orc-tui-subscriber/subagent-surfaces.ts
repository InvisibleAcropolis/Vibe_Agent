import type { OrcBusEvent } from "../orc-events/index.js";
import type {
	OrcSubagentIdentity,
	OrcSubagentSurfaceEntry,
	OrcSubagentSurfaceLifecycle,
	OrcSubagentSurfaceRetention,
	OrcSubagentSurfaceStore,
} from "./types.js";

export function createEmptySurfaceStore(): OrcSubagentSurfaceStore {
	return {
		entriesByKey: {},
		stackedSurfaceKeys: [],
		nextStackOrder: 1,
	};
}

export function reduceSubagentSurfaceStore(state: OrcSubagentSurfaceStore, event: OrcBusEvent): OrcSubagentSurfaceStore {
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

export function closeSubagentSurface(state: OrcSubagentSurfaceStore, surfaceKey: string): OrcSubagentSurfaceStore {
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

export function focusSubagentSurface(state: OrcSubagentSurfaceStore, surfaceKey: string): OrcSubagentSurfaceStore {
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

export function focusOverlayInSurfaceStore(state: OrcSubagentSurfaceStore, _overlayId: string): OrcSubagentSurfaceStore {
	return state;
}

export function deriveSubagentIdentity(event: OrcBusEvent): OrcSubagentIdentity | undefined {
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

export function deriveSurfaceLifecycle(event: OrcBusEvent, prior?: OrcSubagentSurfaceEntry): OrcSubagentSurfaceLifecycle {
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

export function deriveSurfaceRetention(
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

export function updateStackedSurfaceKeys(state: OrcSubagentSurfaceStore, next: OrcSubagentSurfaceEntry): string[] {
	const filtered = state.stackedSurfaceKeys.filter((key) => key !== next.identity.surfaceKey);
	if (next.retention === "collapsed-summary" || next.retention === "closed") {
		return filtered;
	}
	return [...filtered, next.identity.surfaceKey];
}

export function pickFocusedSurfaceKey(
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

export function getOrderedSurfaceEntries(state: OrcSubagentSurfaceStore): OrcSubagentSurfaceEntry[] {
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
