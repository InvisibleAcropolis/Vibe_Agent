import { normalizeOrcTransportEnvelope } from "../orc-events/index.js";
import type { OrcBusEvent } from "../orc-events/index.js";
import type { OrcRuntimeThreadContext } from "./types.js";

export function deriveTrackerPersistenceNeed(event: ReturnType<typeof normalizeOrcTransportEnvelope>): boolean {
	return event.kind === "process.lifecycle"
		|| event.kind === "graph.lifecycle"
		|| event.kind === "worker.status"
		|| event.kind === "tool.result"
		|| event.kind === "stream.warning"
		|| event.kind === "transport.fault"
		|| event.kind === "security.approval";
}

export async function persistTrackerState(context: OrcRuntimeThreadContext): Promise<void> {
	context.session.updateState(context.state);
	await context.live.tracker.save(context.state);
}

export function shouldPersistAfterEvent(context: OrcRuntimeThreadContext, busEvent: OrcBusEvent): boolean {
	return busEvent.kind === "checkpoint.status"
		|| deriveTrackerPersistenceNeed(busEvent)
		|| context.state.terminalState.status !== "running";
}
