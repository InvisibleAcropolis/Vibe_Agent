import type { OrcTransportFaultCode, OrcTransportWarningCode } from "../orc-events/index.js";

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
