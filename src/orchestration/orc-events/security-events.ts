import type { OrcCanonicalEventEnvelope, OrcEventSeverity } from "../orc-io.js";
import {
	getOrcSecurityTelemetryDisposition,
	isBlockingOrcSecurityEvent,
	mapCommandInterceptorResultToOrcSecurityEvent,
	type OrcCommandInterceptorResult,
	type OrcSecurityEvent,
} from "../orc-security.js";
import { classifyOrcInteraction } from "./normalization.js";
import type { OrcSecurityApprovalEvent } from "./types.js";

export function mapOrcSecurityEventToCanonicalSeverity(event: OrcSecurityEvent): Extract<OrcEventSeverity, "notice" | "warning" | "error" | "critical"> {
	const disposition = getOrcSecurityTelemetryDisposition(event);
	if (disposition === "blocked") {
		return "error";
	}
	if (disposition === "approval-required") {
		return "warning";
	}
	return "notice";
}

export function createOrcSecurityApprovalEvent(input: {
	envelope: OrcCanonicalEventEnvelope<Record<string, unknown>>;
	event: OrcSecurityEvent;
	normalizedFrom?: string;
	notes?: string[];
	escalationReason?: string;
}): OrcSecurityApprovalEvent {
	return {
		kind: "security.approval",
		envelope: {
			...input.envelope,
			what: {
				...input.envelope.what,
				category: "security",
				severity: mapOrcSecurityEventToCanonicalSeverity(input.event),
				status: isBlockingOrcSecurityEvent(input.event) ? "waiting_on_input" : "succeeded",
				description: input.envelope.what.description ?? input.event.detail,
			},
		},
		payload: {
			event: input.event,
			severityOverride: mapOrcSecurityEventToCanonicalSeverity(input.event),
			escalationReason: input.escalationReason ?? input.event.reason,
		},
		interaction: classifyOrcInteraction(input.envelope),
		debug: {
			rawPayload: input.envelope.rawPayload,
			normalizedFrom: input.normalizedFrom ?? "security-event",
			notes: input.notes,
		},
	};
}

export function createOrcSecurityEventFromInterceptorResult(input: {
	envelope: OrcCanonicalEventEnvelope<Record<string, unknown>>;
	result: OrcCommandInterceptorResult;
	normalizedFrom?: string;
	notes?: string[];
}): OrcSecurityApprovalEvent {
	const event = mapCommandInterceptorResultToOrcSecurityEvent(input.result);
	return createOrcSecurityApprovalEvent({
		envelope: input.envelope,
		event,
		normalizedFrom: input.normalizedFrom ?? "command-interceptor",
		notes: input.notes,
		escalationReason: input.result.reason,
	});
}
