import { presentOrcEventSummary } from "../orc-presentation.js";
import type { OrcBusEvent } from "./types.js";
import type { OrcCanonicalEventEnvelope } from "../orc-io.js";

export function eventNameAsSummary(envelope: Pick<OrcCanonicalEventEnvelope, "what">): string {
	return envelope.what.description ?? envelope.what.name;
}

export function summarizeOrcEvent(event: OrcBusEvent): string {
	return presentOrcEventSummary(event).detail;
}
