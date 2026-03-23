import { ORC_FAILURE_DISPOSITIONS, normalizeOrcTransportEnvelope } from "../orc-events/index.js";
import { reduceOrcControlPlaneEvent, type OrcBusEvent, type OrcTransportFaultCode } from "../orc-events/index.js";
import type { OrcPythonTransportHealth, OrcPythonTransportLifecycleEvent } from "../orc-python-transport.js";
import type { OrcRunnerLaunchInput } from "../orc-io.js";
import type { OrcRuntimeThreadContext } from "./types.js";
import { shouldPersistAfterEvent } from "./persistence.js";

export function bindTransport(input: {
	context: OrcRuntimeThreadContext;
	transportHealth: Map<string, OrcPythonTransportHealth>;
	publishRuntimeEvent: (context: OrcRuntimeThreadContext, busEvent: OrcBusEvent) => void;
	persistTrackerState: (context: OrcRuntimeThreadContext) => Promise<void>;
	cleanupThread: (context: OrcRuntimeThreadContext, reason: string) => Promise<void>;
}): void {
	const { context, transportHealth, publishRuntimeEvent, persistTrackerState, cleanupThread } = input;
	if (context.listenersBound) {
		return;
	}
	context.listenersBound = true;
	context.live.transport.onLifecycle((event) => {
		if (!event.threadId || event.threadId !== context.threadId || context.disposed) {
			return;
		}
		transportHealth.set(context.threadId, context.live.transport.getHealth());
		const synthetic = createLifecycleBusEvent(context, event);
		if (synthetic) {
			publishRuntimeEvent(context, synthetic);
		}
		if (event.stage === "exit" || event.stage === "terminated" || event.stage === "spawn_failed") {
			void persistTrackerState(context).finally(() => cleanupThread(context, `transport_${event.stage}`));
		}
	});
	context.live.transport.onEnvelope((envelope) => {
		if (envelope.origin.threadId !== context.threadId || context.disposed) {
			return;
		}
		transportHealth.set(context.threadId, context.live.transport.getHealth());
		publishRuntimeEvent(context, normalizeOrcTransportEnvelope(envelope));
	});
	context.live.transport.onDiagnostic((event) => {
		if (event.threadId && event.threadId !== context.threadId) {
			return;
		}
		transportHealth.set(context.threadId, context.live.transport.getHealth());
	});
}

export function publishRuntimeEvent(input: {
	context: OrcRuntimeThreadContext;
	busEvent: OrcBusEvent;
	persistTrackerState: (context: OrcRuntimeThreadContext) => Promise<void>;
}): void {
	const { context, busEvent, persistTrackerState } = input;
	if (context.disposed || context.publishedEventIds.has(busEvent.envelope.origin.eventId)) {
		return;
	}
	const terminalKey = getTerminalPublicationKey(busEvent);
	if (terminalKey && context.publishedTerminalKeys.has(terminalKey)) {
		return;
	}
	context.publishedEventIds.add(busEvent.envelope.origin.eventId);
	if (terminalKey) {
		context.publishedTerminalKeys.add(terminalKey);
	}
	context.live.eventBus.publish(busEvent);
	context.state = reduceOrcControlPlaneEvent(context.state, busEvent);
	context.session.updateState(context.state);
	if (shouldPersistAfterEvent(context, busEvent)) {
		void persistTrackerState(context);
	}
}

export async function startTransport(context: OrcRuntimeThreadContext, input: OrcRunnerLaunchInput, mode: "launch" | "resume", transportHealth: Map<string, OrcPythonTransportHealth>): Promise<void> {
	transportHealth.set(context.threadId, context.live.transport.getHealth());
	if (mode === "resume") {
		await context.live.transport.resume(input);
		return;
	}
	await context.live.transport.launch(input);
}

export function createLifecycleBusEvent(context: OrcRuntimeThreadContext, event: OrcPythonTransportLifecycleEvent): OrcBusEvent | undefined {
	const when = event.at;
	const baseEnvelope = {
		origin: {
			eventId: `${context.runCorrelationId}:${event.stage}:${event.signal ?? event.exitCode ?? event.reason ?? "none"}`,
			emittedAt: when,
			threadId: context.threadId,
			runCorrelationId: context.runCorrelationId,
			streamSequence: Number.MAX_SAFE_INTEGER,
			source: "orc_runtime" as const,
		},
		who: { id: "orc-runtime", kind: "transport" as const, label: "Orc runtime transport supervisor" },
		how: { channel: "event_bus" as const, interactionTarget: "computer" as const, environment: "transport" as const, transport: "python_child_process" as const },
		when,
	};
	if (event.stage === "spawned" || event.stage === "ready") {
		return normalizeOrcTransportEnvelope({
			...baseEnvelope,
			what: { category: "transport", name: `process_${event.stage}`, status: event.stage === "ready" ? "succeeded" : "started", severity: "info", description: event.reason },
			rawPayload: { namespace: "orc.runtime.lifecycle", payload: { eventKind: "process.lifecycle", stage: event.stage, pid: event.pid, reason: event.reason } },
		});
	}
	const failureCode = classifyLifecycleFailureCode(context, event);
	if (event.stage === "exit" && (event.exitCode ?? 0) === 0 && !failureCode) {
		return normalizeOrcTransportEnvelope({
			...baseEnvelope,
			what: { category: "transport", name: "process_exited", status: "succeeded", severity: "info", description: event.reason },
			rawPayload: { namespace: "orc.runtime.lifecycle", payload: { eventKind: "process.lifecycle", stage: "exited", pid: event.pid, exitCode: event.exitCode ?? 0, reason: event.reason } },
		});
	}
	if (!failureCode) {
		return undefined;
	}
	const disposition = ORC_FAILURE_DISPOSITIONS[failureCode];
	const stage = event.stage === "exit" ? "exited" : event.stage === "terminated" ? "terminated" : "terminated";
	const status = disposition.terminalState === "cancelled" ? "cancelled" : "failed";
	return normalizeOrcTransportEnvelope({
		...baseEnvelope,
		what: { category: "transport", name: failureCode, status, severity: disposition.terminalState === "cancelled" ? "warning" : "error", description: event.reason },
		rawPayload: {
			namespace: "orc.runtime.lifecycle",
			payload: {
				eventKind: "process.lifecycle",
				stage,
				pid: event.pid,
				exitCode: event.exitCode,
				signal: event.signal,
				reason: event.reason ?? failureCode,
				failureCode,
				retryability: disposition.retryability,
				remediationHint: disposition.remediationHint,
			},
		},
	});
}

export function classifyLifecycleFailureCode(context: OrcRuntimeThreadContext, event: OrcPythonTransportLifecycleEvent): OrcTransportFaultCode | undefined {
	if (event.stage === "spawn_failed") {
		const reason = (event.reason ?? event.error?.message ?? "").toLowerCase();
		return reason.includes("epipe") ? "transport_broken_pipe" : "transport_startup_failure";
	}
	if (event.stage === "terminated") {
		if ((event.reason ?? "").includes("cancel") || context.state.phase === "cancelled") {
			return "transport_user_cancellation";
		}
		if (event.signal === "SIGINT" || event.signal === "SIGTERM") {
			return "transport_signal_shutdown";
		}
		return "transport_disconnect";
	}
	if (event.stage === "exit" && (event.exitCode ?? 0) !== 0) {
		return "transport_non_zero_exit";
	}
	return undefined;
}

export function getTerminalPublicationKey(event: OrcBusEvent): string | undefined {
	if (event.kind !== "process.lifecycle") {
		return undefined;
	}
	if (event.payload.stage !== "exited" && event.payload.stage !== "terminated") {
		return undefined;
	}
	return `${event.payload.failureCode ?? event.payload.stage}:${event.payload.exitCode ?? "none"}:${event.payload.signal ?? "none"}:${event.payload.reason ?? "none"}`;
}
