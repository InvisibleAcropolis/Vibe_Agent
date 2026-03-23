import type { OrcTransportFaultCode, OrcTransportWarningCode } from "../orc-events/types.js";
import { classifyOrcTransportIssue } from "../orc-events/transport-policy.js";

export type OrcTransportPolicyAction = "continue" | "restart" | "terminate";

export interface OrcTransportWarningEmissionRequest {
	kind: "warning";
	code: OrcTransportWarningCode;
	message: string;
	payload: Record<string, unknown>;
}

export interface OrcTransportFaultEmissionRequest {
	kind: "fault";
	code: OrcTransportFaultCode;
	message: string;
	payload: Record<string, unknown>;
}

export type OrcTransportEmissionRequest = OrcTransportWarningEmissionRequest | OrcTransportFaultEmissionRequest;

export interface OrcTransportPolicyResult {
	emissions: OrcTransportEmissionRequest[];
	action: OrcTransportPolicyAction;
}

export interface OrcTransportTimeoutHealthMarks {
	lastIdleWarningAt?: string;
	lastReadyTimeoutAt?: string;
	lastStallFaultAt?: string;
}

export interface OrcTransportTimeoutPolicyResult extends OrcTransportPolicyResult {
	healthMarks: OrcTransportTimeoutHealthMarks;
	nowIso: string;
	silenceMs: number;
}

export function mapTransportRecoveryToPolicyAction(
	code: OrcTransportWarningCode | OrcTransportFaultCode,
): OrcTransportPolicyAction {
	const rule = classifyOrcTransportIssue(code);
	return rule.recovery === "continue_stream"
		? "continue"
		: rule.recovery === "request_supervisor_restart"
			? "restart"
			: "terminate";
}

export function maxTransportPolicyAction(
	left: OrcTransportPolicyAction,
	right: OrcTransportPolicyAction,
): OrcTransportPolicyAction {
	const order: Record<OrcTransportPolicyAction, number> = { continue: 0, restart: 1, terminate: 2 };
	return order[right] > order[left] ? right : left;
}
