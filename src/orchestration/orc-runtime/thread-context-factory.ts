import { attachOrcDurableEventLogWriter } from "../orc-event-log.js";
import { createOrcEventBus } from "../orc-event-bus.js";
import { OrcDebugArtifactsWriter } from "../orc-debug.js";
import { OrcPythonChildProcessTransport } from "../orc-python-transport.js";
import type { LaunchOrcRequest } from "../orc-io.js";
import type { OrcCheckpointStore } from "../orc-checkpoints.js";
import type { OrcSecurityPolicy } from "../orc-security.js";
import type { OrcSessionRuntimeHooks } from "../orc-session.js";
import type { OrcControlPlaneState } from "../orc-state.js";
import type { OrcStorage } from "../orc-storage.js";
import type { OrcTracker } from "../orc-tracker.js";
import { cleanupExistingThread } from "./cleanup.js";
import type { OrcRuntimeAdapters, OrcRuntimeLiveHandles, OrcRuntimeThreadContext, OrcSessionFactory } from "./types.js";

export async function createThreadContext(input: {
	request: LaunchOrcRequest;
	threadId: string;
	runCorrelationId: string;
	checkpointId?: string;
	securityPolicy: OrcSecurityPolicy;
	state: OrcControlPlaneState;
	adapters: OrcRuntimeAdapters;
	tracker: OrcTracker;
	checkpointStore: OrcCheckpointStore;
	storage: OrcStorage;
	sessionFactory: OrcSessionFactory;
	activeThreads: Map<string, OrcRuntimeThreadContext>;
	cleanupThread: (context: OrcRuntimeThreadContext, reason: string) => Promise<void>;
	createSessionHooks: (context: OrcRuntimeThreadContext) => OrcSessionRuntimeHooks;
	transportHealth: Map<string, ReturnType<OrcRuntimeLiveHandles["transport"]["getHealth"]>>;
}): Promise<OrcRuntimeThreadContext> {
	await cleanupExistingThread({
		threadId: input.threadId,
		reason: "thread_replaced",
		activeThreads: input.activeThreads,
		cleanupThread: input.cleanupThread,
	});
	const eventBus = input.adapters.createEventBus?.({
		component: "orc-runtime",
		description: `Live Orc event bus for thread ${input.threadId}`,
	}) ?? createOrcEventBus({ component: "orc-runtime", description: `Live Orc event bus for thread ${input.threadId}` });
	const debugArtifactsWriter = input.adapters.debugMode?.enabled
		? new OrcDebugArtifactsWriter(input.threadId, input.runCorrelationId, input.adapters.debugMode)
		: undefined;
	const transport = input.adapters.createPythonTransport?.() ??
		new OrcPythonChildProcessTransport({
			buildSpawnContract: input.adapters.buildPythonRunnerSpawnContract,
			debugArtifactsWriter,
		});
	const live: OrcRuntimeLiveHandles = {
		transport,
		eventBus,
		tracker: input.tracker,
		checkpointStore: input.checkpointStore,
		storage: input.storage,
		debugArtifactsWriter,
	};
	const { writer, subscription } = attachOrcDurableEventLogWriter(eventBus, {
		threadId: input.threadId,
		runCorrelationId: input.runCorrelationId,
	});
	const session = input.sessionFactory.createSession({
		request: input.request,
		threadId: input.threadId,
		runCorrelationId: input.runCorrelationId,
		checkpointId: input.checkpointId,
		securityPolicy: input.securityPolicy,
		state: input.state,
	});
	const context: OrcRuntimeThreadContext = {
		threadId: input.threadId,
		runCorrelationId: input.runCorrelationId,
		session,
		state: input.state,
		securityPolicy: input.securityPolicy,
		live,
		storageHooks: { eventLogWriter: writer, eventLogSubscription: subscription },
		disposed: false,
		listenersBound: false,
		publishedEventIds: new Set(),
		publishedTerminalKeys: new Set(),
	};
	debugArtifactsWriter?.writeRuntimeMetadata({
		threadId: input.threadId,
		runCorrelationId: input.runCorrelationId,
		createdAt: new Date().toISOString(),
		debugMode: "opt_in",
		artifacts: {
			runtimeMetadata: debugArtifactsWriter.location.runtimeMetadataPath,
			pythonStderr: debugArtifactsWriter.location.pythonStderrPath,
			rawEventMirror: debugArtifactsWriter.location.rawEventMirrorPath,
			parserWarnings: debugArtifactsWriter.location.parserWarningsPath,
			transportDiagnostics: debugArtifactsWriter.location.transportDiagnosticsPath,
			eventLogManifest: writer.getSnapshot().manifestPath,
		},
		project: {
			projectId: input.state.project.projectId,
			projectRoot: input.state.project.projectRoot,
		},
		transport: {
			command: transport.getHealth().command,
			args: transport.getHealth().args,
			cwd: transport.getHealth().cwd,
			pid: transport.getHealth().pid,
		},
		state: {
			checkpointId: input.state.checkpointId,
			phase: input.state.phase,
			lastUpdatedAt: input.state.lastUpdatedAt,
		},
		safety: {
			operatorUiSurface: "default_dashboard_unchanged",
			caveats: [
				"Debug artifacts are opt-in and remain separate from default operator-facing Orc dashboard surfaces.",
				"Python stderr and raw-event mirrors may contain noisy provider/tool payloads unsuitable for the default UI.",
				"Use debug mode for transport/parser troubleshooting, then disable it for routine runs.",
			],
		},
	});
	session.attachRuntimeHooks(input.createSessionHooks(context));
	session.updateState(input.state);
	input.activeThreads.set(input.threadId, context);
	input.transportHealth.set(input.threadId, transport.getHealth());
	return context;
}
