import type { OrcPythonTransportHealth } from "../orc-python-transport.js";
import type { OrcRuntimeThreadContext } from "./types.js";

export async function cleanupExistingThread(input: {
	threadId: string;
	reason: string;
	activeThreads: Map<string, OrcRuntimeThreadContext>;
	cleanupThread: (context: OrcRuntimeThreadContext, reason: string) => Promise<void>;
}): Promise<void> {
	const existing = input.activeThreads.get(input.threadId);
	if (existing) {
		await input.cleanupThread(existing, input.reason);
	}
}

export async function cleanupThread(input: {
	context: OrcRuntimeThreadContext;
	reason: string;
	activeThreads: Map<string, OrcRuntimeThreadContext>;
	transportHealth: Map<string, OrcPythonTransportHealth>;
}): Promise<void> {
	const { context, reason, activeThreads, transportHealth } = input;
	if (context.disposed) {
		return;
	}
	context.disposed = true;
	context.cleanupReason = reason;
	activeThreads.delete(context.threadId);
	context.storageHooks.eventLogSubscription?.unsubscribe();
	try {
		context.live.eventBus.dispose();
	} catch {
		// Best effort: cleanup must stay deterministic even if subscribers were already removed.
	}
	await context.live.transport.dispose();
	transportHealth.set(context.threadId, context.live.transport.getHealth());
}
