/**
 * State projection boundary: reduce normalized bus events into UI-friendly activity, overlay, wave, and error state.
 * This layer must consume normalized event fields instead of reaching back into transport envelope parsing helpers.
 */
import { isBlockingOrcSecurityEvent } from "../orc-security.js";
import { mapOrcSecurityEventToCanonicalSeverity } from "./security-events.js";
import { summarizeOrcEvent } from "./summary.js";
import type {
	OrcActiveOverlay,
	OrcBusEvent,
	OrcEventReducerState,
	OrcReducedErrorEntry,
	OrcWaveCounts,
} from "./types.js";

export const ORC_EVENT_REDUCER_INITIAL_STATE: OrcEventReducerState = {
	latestActivityByAgent: {},
	activeOverlays: [],
	waveCounts: {
		active: 0,
		queued: 0,
		completed: 0,
		failed: 0,
		cancelled: 0,
		byWaveId: {},
	},
	transportHealth: {
		status: "unknown",
		consecutiveWarnings: 0,
		consecutiveFaults: 0,
	},
	recentErrors: [],
};

export function reduceOrcBusEvent(state: OrcEventReducerState, event: OrcBusEvent): OrcEventReducerState {
	const next: OrcEventReducerState = {
		latestActivityByAgent: { ...state.latestActivityByAgent },
		activeOverlays: [...state.activeOverlays],
		waveCounts: {
			...state.waveCounts,
			byWaveId: { ...state.waveCounts.byWaveId },
		},
		transportHealth: { ...state.transportHealth },
		recentErrors: [...state.recentErrors],
	};

	applyLatestActivity(next, event);
	applyOverlayState(next, event);
	applyWaveCounts(next, event);
	applyTransportHealth(next, event);
	applyRecentErrors(next, event);

	return next;
}

function applyLatestActivity(state: OrcEventReducerState, event: OrcBusEvent): void {
	const agentId = extractAgentId(event);
	if (!agentId) {
		return;
	}
	state.latestActivityByAgent[agentId] = {
		agentId,
		workerId: extractWorkerId(event),
		label: event.envelope.who.label,
		lastEventKind: event.kind,
		lastStatus: event.envelope.what.status,
		interactionLane: event.interaction.lane,
		summary: summarizeOrcEvent(event),
		updatedAt: event.envelope.when,
		severity: event.envelope.what.severity,
		rawEvent: event,
	};
}

function applyOverlayState(state: OrcEventReducerState, event: OrcBusEvent): void {
	const overlay = deriveOverlay(event);
	if (!overlay) {
		return;
	}
	const index = state.activeOverlays.findIndex((item) => item.id === overlay.id);
	if (overlay.status === "hidden") {
		if (index >= 0) {
			state.activeOverlays.splice(index, 1);
		}
		return;
	}
	if (index >= 0) {
		state.activeOverlays[index] = overlay;
		return;
	}
	state.activeOverlays.push(overlay);
}

function applyWaveCounts(state: OrcEventReducerState, event: OrcBusEvent): void {
	if (event.kind !== "worker.status") {
		return;
	}
	const waveId = event.payload.waveId;
	if (!waveId) {
		return;
	}
	const bucket = state.waveCounts.byWaveId[waveId] ?? { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
	bucket.queued = event.payload.status === "queued" ? bucket.queued + 1 : bucket.queued;
	bucket.running = ["running", "waiting_on_input"].includes(event.payload.status) ? bucket.running + 1 : bucket.running;
	bucket.completed = event.payload.status === "completed" ? bucket.completed + 1 : bucket.completed;
	bucket.failed = event.payload.status === "failed" ? bucket.failed + 1 : bucket.failed;
	bucket.cancelled = event.payload.status === "cancelled" ? bucket.cancelled + 1 : bucket.cancelled;
	state.waveCounts.byWaveId[waveId] = bucket;
	state.waveCounts.queued = sumWaveMetric(state.waveCounts.byWaveId, "queued");
	state.waveCounts.active = sumWaveMetric(state.waveCounts.byWaveId, "running");
	state.waveCounts.completed = sumWaveMetric(state.waveCounts.byWaveId, "completed");
	state.waveCounts.failed = sumWaveMetric(state.waveCounts.byWaveId, "failed");
	state.waveCounts.cancelled = sumWaveMetric(state.waveCounts.byWaveId, "cancelled");
}

function applyTransportHealth(state: OrcEventReducerState, event: OrcBusEvent): void {
	if (event.kind === "process.lifecycle" || event.kind === "graph.lifecycle" || event.kind === "agent.message" || event.kind === "worker.status") {
		state.transportHealth.status = "healthy";
		state.transportHealth.lastHeartbeatAt = event.envelope.when;
		state.transportHealth.lastMessage = summarizeOrcEvent(event);
		state.transportHealth.rawEvent = event;
		state.transportHealth.consecutiveWarnings = 0;
		state.transportHealth.consecutiveFaults = 0;
		state.transportHealth.lastRemediationHint = undefined;
		state.transportHealth.lastFailureCode = undefined;
		state.transportHealth.retryability = undefined;
		return;
	}

	if (event.kind === "security.approval" && !isBlockingOrcSecurityEvent(event.payload.event)) {
		state.transportHealth.lastHeartbeatAt = event.envelope.when;
		state.transportHealth.lastMessage = summarizeOrcEvent(event);
		return;
	}
	if (event.kind === "stream.warning") {
		state.transportHealth.status = "degraded";
		state.transportHealth.lastWarningAt = event.envelope.when;
		state.transportHealth.lastMessage = event.payload.message;
		state.transportHealth.lastFailureCode = event.payload.warningCode;
		state.transportHealth.consecutiveWarnings += 1;
		state.transportHealth.rawEvent = event;
		return;
	}
	if (event.kind === "transport.fault") {
		state.transportHealth.status = event.payload.status;
		state.transportHealth.lastFaultAt = event.envelope.when;
		state.transportHealth.lastMessage = event.payload.message;
		state.transportHealth.lastFailureCode = event.payload.faultCode;
		state.transportHealth.lastRemediationHint = event.payload.remediationHint;
		state.transportHealth.retryability = event.payload.retryability;
		state.transportHealth.consecutiveFaults += 1;
		state.transportHealth.rawEvent = event;
	}
}

function applyRecentErrors(state: OrcEventReducerState, event: OrcBusEvent): void {
	const errorEntry = deriveReducedError(event);
	if (!errorEntry) {
		return;
	}
	state.recentErrors = [errorEntry, ...state.recentErrors].slice(0, 20);
}

function extractAgentId(event: OrcBusEvent): string | undefined {
	if (event.envelope.who.kind === "agent") {
		return event.envelope.who.id;
	}
	if ("agentId" in event.payload && typeof event.payload.agentId === "string") {
		return event.payload.agentId;
	}
	return undefined;
}

function extractWorkerId(event: OrcBusEvent): string | undefined {
	if ("workerId" in event.payload && typeof event.payload.workerId === "string") {
		return event.payload.workerId;
	}
	return event.envelope.origin.workerId ?? event.envelope.who.workerId;
}

function deriveOverlay(event: OrcBusEvent): OrcActiveOverlay | undefined {
	const base = {
		relatedEventId: event.envelope.origin.eventId,
		openedAt: event.envelope.when,
		updatedAt: event.envelope.when,
		summary: summarizeOrcEvent(event),
		severity: event.envelope.what.severity,
		workerId: extractWorkerId(event),
		agentId: extractAgentId(event),
	};
	switch (event.kind) {
		case "tool.call":
			return {
				id: `tool:${event.payload.callId}`,
				kind: "tool-call",
				title: `Tool: ${event.payload.toolName}`,
				status: event.envelope.what.status,
				...base,
			};
		case "security.approval":
			if (!isBlockingOrcSecurityEvent(event.payload.event)) {
				return undefined;
			}
			return {
				id: `approval:${event.envelope.origin.eventId}`,
				kind: "approval",
				title: event.payload.event.statusText,
				status: event.payload.event.kind === "blocked-command" ? "visible" : event.envelope.what.status,
				...base,
			};
		case "transport.fault":
			return {
				id: "transport-health",
				kind: "transport-health",
				title: "Transport health",
				status: event.payload.status === "offline" ? "visible" : event.envelope.what.status,
				...base,
			};
		case "checkpoint.status":
			return event.payload.status === "captured" || event.payload.status === "restored"
				? {
					id: `checkpoint:${event.payload.checkpointId ?? event.envelope.origin.eventId}`,
					kind: "checkpoint",
					title: "Checkpoint status",
					status: event.envelope.what.status,
					...base,
				}
				: undefined;
		case "tool.result":
			return ["failed", "cancelled", "timed_out"].includes(event.payload.status)
				? {
					id: `tool:${event.payload.callId}`,
					kind: "error",
					title: `Tool issue: ${event.payload.toolName}`,
					status: "visible",
					...base,
				}
				: {
					id: `tool:${event.payload.callId}`,
					kind: "tool-call",
					title: `Tool: ${event.payload.toolName}`,
					status: "hidden",
					...base,
				};
		default:
			return undefined;
	}
}

function deriveReducedError(event: OrcBusEvent): OrcReducedErrorEntry | undefined {
	switch (event.kind) {
		case "stream.warning":
			return {
				id: `warn:${event.envelope.origin.eventId}`,
				kind: event.kind,
				message: event.payload.message,
				severity: event.envelope.what.severity,
				createdAt: event.envelope.when,
				workerId: extractWorkerId(event),
				agentId: extractAgentId(event),
				eventId: event.envelope.origin.eventId,
				rawEvent: event,
			};
		case "transport.fault":
			return {
				id: `fault:${event.envelope.origin.eventId}`,
				kind: event.kind,
				message: event.payload.message,
				severity: event.envelope.what.severity,
				createdAt: event.envelope.when,
				workerId: extractWorkerId(event),
				agentId: extractAgentId(event),
				eventId: event.envelope.origin.eventId,
				rawEvent: event,
			};
		case "tool.result":
			return event.payload.status === "succeeded"
				? undefined
				: {
					id: `tool-error:${event.envelope.origin.eventId}`,
					kind: event.kind,
					message: event.payload.errorText ?? `${event.payload.toolName} ${event.payload.status}`,
					severity: event.envelope.what.severity,
					createdAt: event.envelope.when,
					workerId: extractWorkerId(event),
					agentId: extractAgentId(event),
					eventId: event.envelope.origin.eventId,
					rawEvent: event,
				};
		case "security.approval":
			return {
				id: `security:${event.envelope.origin.eventId}`,
				kind: event.kind,
				message: event.payload.event.detail,
				severity: mapOrcSecurityEventToCanonicalSeverity(event.payload.event),
				createdAt: event.envelope.when,
				workerId: event.payload.event.workerId,
				agentId: extractAgentId(event),
				eventId: event.envelope.origin.eventId,
				rawEvent: event,
			};
		default:
			return undefined;
	}
}

function sumWaveMetric(
	byWaveId: OrcWaveCounts["byWaveId"],
	key: keyof OrcWaveCounts["byWaveId"][string],
): number {
	return Object.values(byWaveId).reduce((sum, bucket) => sum + bucket[key], 0);
}
