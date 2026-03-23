import type { OrcSessionRuntimeHooks } from "../orc-session.js";
import type { OrcControlPlaneState, OrcLifecyclePhase } from "../orc-state.js";
import type { OrcPythonTransportHealth } from "../orc-python-transport.js";
import type { OrcRuntimeThreadContext } from "./types.js";

export function setStatePhase(
	context: OrcRuntimeThreadContext,
	phase: OrcLifecyclePhase,
	checkpointId?: string,
): OrcControlPlaneState {
	const nextState: OrcControlPlaneState = {
		...context.state,
		phase,
		checkpointId,
		lastUpdatedAt: new Date().toISOString(),
	};
	context.session.updateState(nextState);
	return nextState;
}

export function createRuntimeSessionHooks(input: {
	context: OrcRuntimeThreadContext;
	transportHealth: Map<string, OrcPythonTransportHealth>;
	persistTrackerState: (context: OrcRuntimeThreadContext) => Promise<void>;
	cleanupThread: (context: OrcRuntimeThreadContext, reason: string) => Promise<void>;
}): OrcSessionRuntimeHooks {
	const { cleanupThread, context, persistTrackerState, transportHealth } = input;
	return {
		cancel: async (reason?: string) => {
			context.state = setStatePhase(context, "cancelled", context.state.checkpointId);
			await persistTrackerState(context);
			await context.live.transport.cancel(reason ?? "session_cancelled");
			await cleanupThread(context, reason ?? "session_cancelled");
		},
		shutdown: async (reason?: string) => {
			await context.live.transport.shutdown(reason ?? "session_shutdown");
			await cleanupThread(context, reason ?? "session_shutdown");
		},
		getTransportHealth: () => transportHealth.get(context.threadId),
		getEventBusSnapshot: () => context.live.eventBus.getSnapshot(),
	};
}
