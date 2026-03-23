import type {
	EnumerateOrcArtifactsRequest,
	EnumerateOrcArtifactsResponse,
	LaunchOrcRequest,
	LaunchOrcResponse,
	LoadOrcTrackerStateRequest,
	LoadOrcTrackerStateResponse,
	OrcPythonRunnerSpawnContract,
	OrcRunnerLaunchInput,
	ResumeOrcThreadRequest,
	ResumeOrcThreadResponse,
} from "../orc-io.js";
import type { OrcDurableEventLogWriter } from "../orc-event-log.js";
import type { OrcEventBus, OrcEventBusSubscription } from "../orc-event-bus.js";
import type { OrcDebugArtifactsWriter, OrcDebugModeOptions } from "../orc-debug.js";
import type { OrcCheckpointStore } from "../orc-checkpoints.js";
import type { OrcPythonTransport } from "../orc-python-transport.js";
import type { OrcSecurityPolicy } from "../orc-security.js";
import type { OrcSession } from "../orc-session.js";
import type { OrcStorage } from "../orc-storage.js";
import type { OrcTracker } from "../orc-tracker.js";
import type { OrcControlPlaneState } from "../orc-state.js";

/**
 * Construction-time dependencies for the future orchestration runtime.
 * The factories are intentionally opaque in Phase 1 so the implementation can
 * later bind to LangGraph and DeepAgents without exposing unstable SDK types.
 */
export interface OrcRuntimeAdapters {
	createLangGraph?: () => Promise<unknown> | unknown;
	initializeDeepAgents?: () => Promise<unknown> | unknown;
	/**
	 * Phase 2 spawn boundary: the runtime should eventually translate launch/resume requests into
	 * this stable contract and spawn `python -m src.orchestration.python.orc_runner` (or an equivalent
	 * packaged module path) with the JSON payload written to stdin. Runtime code must stay decoupled
	 * from Python implementation details beyond this process boundary and the JSONL/stderr protocols.
	 */
	buildPythonRunnerSpawnContract?: (input: OrcRunnerLaunchInput) => OrcPythonRunnerSpawnContract;
	createPythonTransport?: () => OrcPythonTransport;
	createEventBus?: (owner: { component: string; description?: string }) => OrcEventBus;
	createTracker?: () => OrcTracker;
	createCheckpointStore?: () => OrcCheckpointStore;
	createStorage?: () => OrcStorage;
	debugMode?: OrcDebugModeOptions;
}

export interface OrcSessionFactoryInput {
	request: LaunchOrcRequest;
	threadId: string;
	runCorrelationId: string;
	checkpointId?: string;
	securityPolicy: OrcSecurityPolicy;
	state: OrcControlPlaneState;
}

/**
 * Session creation boundary. The runtime owns transport/bus/tracker/checkpoint resources and injects
 * only stable runtime-facing hooks into the session handle so controller/UI code never sees raw transport APIs.
 */
export interface OrcSessionFactory {
	createSession(input: OrcSessionFactoryInput): OrcSession;
}

export interface OrcRuntimeLiveHandles {
	transport: OrcPythonTransport;
	eventBus: OrcEventBus;
	tracker: OrcTracker;
	checkpointStore: OrcCheckpointStore;
	storage: OrcStorage;
	debugArtifactsWriter?: OrcDebugArtifactsWriter;
}

export interface OrcRuntimeStorageHooks {
	eventLogWriter?: OrcDurableEventLogWriter;
	eventLogSubscription?: OrcEventBusSubscription;
}

export interface OrcRuntimeThreadContext {
	threadId: string;
	runCorrelationId: string;
	session: OrcSession;
	state: OrcControlPlaneState;
	securityPolicy: OrcSecurityPolicy;
	live: OrcRuntimeLiveHandles;
	storageHooks: OrcRuntimeStorageHooks;
	cleanupReason?: string;
	disposed: boolean;
	listenersBound: boolean;
	publishedEventIds: Set<string>;
	publishedTerminalKeys: Set<string>;
}

export interface OrcRuntime {
	launch(request: LaunchOrcRequest): Promise<LaunchOrcResponse>;
	loadTrackerState(request: LoadOrcTrackerStateRequest): Promise<LoadOrcTrackerStateResponse>;
	enumerateArtifacts(request: EnumerateOrcArtifactsRequest): Promise<EnumerateOrcArtifactsResponse>;
	resumeThread(request: ResumeOrcThreadRequest): Promise<ResumeOrcThreadResponse>;
}
