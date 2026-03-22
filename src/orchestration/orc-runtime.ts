import { randomUUID } from "node:crypto";
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
} from "./orc-io.js";
import { attachOrcDurableEventLogWriter, type OrcDurableEventLogWriter } from "./orc-event-log.js";
import { createOrcEventBus, type OrcEventBus, type OrcEventBusSubscription } from "./orc-event-bus.js";
import { normalizeOrcTransportEnvelope } from "./orc-events.js";
import {
	NoopOrcCheckpointStore,
	type OrcCheckpointMetadata,
	type OrcCheckpointStore,
} from "./orc-checkpoints.js";
import {
	OrcPythonChildProcessTransport,
	type OrcPythonTransport,
	type OrcPythonTransportHealth,
} from "./orc-python-transport.js";
import { createDefaultOrcSecurityPolicy, mergeOrcSecurityPolicy, type OrcSecurityPolicy } from "./orc-security.js";
import { OrcSessionHandle, type OrcSession, type OrcSessionRuntimeHooks } from "./orc-session.js";
import { NoopOrcStorage, type OrcStorage } from "./orc-storage.js";
import { NoopOrcTracker, type OrcTracker } from "./orc-tracker.js";
import type { OrcControlPlaneState, OrcLifecyclePhase } from "./orc-state.js";

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

interface OrcRuntimeLiveHandles {
	transport: OrcPythonTransport;
	eventBus: OrcEventBus;
	tracker: OrcTracker;
	checkpointStore: OrcCheckpointStore;
	storage: OrcStorage;
}

interface OrcRuntimeStorageHooks {
	eventLogWriter?: OrcDurableEventLogWriter;
	eventLogSubscription?: OrcEventBusSubscription;
}

interface OrcRuntimeThreadContext {
	threadId: string;
	runCorrelationId: string;
	session: OrcSession;
	state: OrcControlPlaneState;
	securityPolicy: OrcSecurityPolicy;
	live: OrcRuntimeLiveHandles;
	storageHooks: OrcRuntimeStorageHooks;
	cleanupReason?: string;
	disposed: boolean;
}

export interface OrcRuntime {
	launch(request: LaunchOrcRequest): Promise<LaunchOrcResponse>;
	loadTrackerState(request: LoadOrcTrackerStateRequest): Promise<LoadOrcTrackerStateResponse>;
	enumerateArtifacts(request: EnumerateOrcArtifactsRequest): Promise<EnumerateOrcArtifactsResponse>;
	resumeThread(request: ResumeOrcThreadRequest): Promise<ResumeOrcThreadResponse>;
}

/**
 * Phase 2 runtime ownership rules:
 * - The runtime constructs and owns the child-process transport, event bus, tracker, checkpoint store, and storage hooks.
 * - Session/controller code receives only stable hooks (`cancel`, `shutdown`, snapshots) and never raw transport listeners.
 * - Launch/resume create a fresh run correlation id, attach durable event logging, supervise transport lifecycle, and tear down deterministically.
 */
export class OrcRuntimeSkeleton implements OrcRuntime {
	private readonly sessionFactory: OrcSessionFactory;
	private readonly securityPolicy: OrcSecurityPolicy;
	private readonly tracker: OrcTracker;
	private readonly checkpoints: OrcCheckpointStore;
	private readonly storage: OrcStorage;
	private readonly activeThreads = new Map<string, OrcRuntimeThreadContext>();
	private readonly transportHealth = new Map<string, OrcPythonTransportHealth>();

	constructor(
		readonly adapters: OrcRuntimeAdapters = {},
		options: {
			sessionFactory?: OrcSessionFactory;
			securityPolicy?: OrcSecurityPolicy;
			tracker?: OrcTracker;
			checkpointStore?: OrcCheckpointStore;
			storage?: OrcStorage;
		} = {},
	) {
		this.securityPolicy = options.securityPolicy ?? createDefaultOrcSecurityPolicy();
		this.tracker = options.tracker ?? this.adapters.createTracker?.() ?? new NoopOrcTracker();
		this.checkpoints = options.checkpointStore ?? this.adapters.createCheckpointStore?.() ?? new NoopOrcCheckpointStore();
		this.storage = options.storage ?? this.adapters.createStorage?.() ?? new NoopOrcStorage();
		this.sessionFactory = options.sessionFactory ?? {
			createSession: (input) =>
				new OrcSessionHandle(input.threadId, input.state, input.checkpointId, input.securityPolicy, input.runCorrelationId),
		};
	}

	async launch(request: LaunchOrcRequest): Promise<LaunchOrcResponse> {
		const threadId = request.resumeThreadId ?? `orc-thread-${randomUUID()}`;
		const runCorrelationId = `orc-run-${randomUUID()}`;
		const securityPolicy = mergeOrcSecurityPolicy(this.securityPolicy, request.securityPolicyOverrides);
		const initialState = this.createInitialState({
			threadId,
			checkpointId: request.resumeCheckpointId,
			project: request.project,
			securityPolicy,
			phase: "bootstrapping",
			message: request.prompt,
		});
		const context = await this.createThreadContext({
			request,
			threadId,
			runCorrelationId,
			checkpointId: request.resumeCheckpointId,
			securityPolicy,
			state: initialState,
		});

		await this.persistTrackerState(context);
		await this.startTransport(context, this.buildLaunchInput(context, undefined), "launch");
		return {
			threadId,
			checkpointId: context.state.checkpointId,
			state: context.state,
		};
	}

	async loadTrackerState(request: LoadOrcTrackerStateRequest): Promise<LoadOrcTrackerStateResponse> {
		const active = this.activeThreads.get(request.threadId);
		if (active && (!request.checkpointId || request.checkpointId === active.state.checkpointId)) {
			return { found: true, state: active.state };
		}
		const state = await this.tracker.load(request.threadId, request.checkpointId);
		return state ? { found: true, state } : { found: false };
	}

	async enumerateArtifacts(request: EnumerateOrcArtifactsRequest): Promise<EnumerateOrcArtifactsResponse> {
		const entries = request.kind === "log"
			? await this.storage.listLogs(request.threadId, request.checkpointId)
			: request.kind === "artifact"
				? await this.storage.listArtifacts(request.threadId, request.checkpointId)
				: [
					...(await this.storage.listArtifacts(request.threadId, request.checkpointId)),
					...(await this.storage.listLogs(request.threadId, request.checkpointId)),
				];
		return { entries };
	}

	async resumeThread(request: ResumeOrcThreadRequest): Promise<ResumeOrcThreadResponse> {
		const checkpoint = await this.checkpoints.loadCheckpoint({ threadId: request.threadId, checkpointId: request.checkpointId });
		const restoredState = await this.tracker.load(request.threadId, request.checkpointId ?? checkpoint?.checkpointId);
		if (!restoredState) {
			throw new Error(`Unable to resume Orc thread ${request.threadId}: no tracker snapshot was found${request.checkpointId ? ` for checkpoint ${request.checkpointId}` : ""}.`);
		}
		const runCorrelationId = `orc-run-${randomUUID()}`;
		const securityPolicy = restoredState.securityPolicy ?? this.securityPolicy;
		const resumeState: OrcControlPlaneState = {
			...restoredState,
			phase: checkpoint?.phase === "completed" || checkpoint?.phase === "cancelled" ? checkpoint.phase : "bootstrapping",
			lastUpdatedAt: new Date().toISOString(),
		};
		const requestShape: LaunchOrcRequest = {
			project: restoredState.project,
			prompt: checkpoint?.resumeData?.instructions ?? `Resume Orc thread ${request.threadId}`,
			resumeThreadId: request.threadId,
			resumeCheckpointId: request.checkpointId ?? checkpoint?.checkpointId,
		};
		const context = await this.createThreadContext({
			request: requestShape,
			threadId: request.threadId,
			runCorrelationId,
			checkpointId: request.checkpointId ?? checkpoint?.checkpointId,
			securityPolicy,
			state: resumeState,
		});

		await this.persistTrackerState(context);
		await this.startTransport(context, this.buildLaunchInput(context, checkpoint), "resume");
		return {
			threadId: request.threadId,
			checkpointId: context.state.checkpointId,
			state: context.state,
		};
	}

	async dispose(): Promise<void> {
		await Promise.all([...this.activeThreads.values()].map((context) => this.cleanupThread(context, "runtime_disposed")));
	}

	createPythonTransport(): OrcPythonTransport {
		return (
			this.adapters.createPythonTransport?.() ??
			new OrcPythonChildProcessTransport({
				buildSpawnContract: this.adapters.buildPythonRunnerSpawnContract,
			})
		);
	}

	getTransportHealth(threadId: string): OrcPythonTransportHealth | undefined {
		return this.transportHealth.get(threadId);
	}

	getSession(threadId: string): OrcSession | undefined {
		return this.activeThreads.get(threadId)?.session;
	}

	private async createThreadContext(input: {
		request: LaunchOrcRequest;
		threadId: string;
		runCorrelationId: string;
		checkpointId?: string;
		securityPolicy: OrcSecurityPolicy;
		state: OrcControlPlaneState;
	}): Promise<OrcRuntimeThreadContext> {
		await this.cleanupExistingThread(input.threadId, "thread_replaced");
		const eventBus = this.adapters.createEventBus?.({
			component: "orc-runtime",
			description: `Live Orc event bus for thread ${input.threadId}`,
		}) ?? createOrcEventBus({ component: "orc-runtime", description: `Live Orc event bus for thread ${input.threadId}` });
		const transport = this.createPythonTransport();
		const live: OrcRuntimeLiveHandles = {
			transport,
			eventBus,
			tracker: this.tracker,
			checkpointStore: this.checkpoints,
			storage: this.storage,
		};
		const { writer, subscription } = attachOrcDurableEventLogWriter(eventBus, {
			threadId: input.threadId,
			runCorrelationId: input.runCorrelationId,
		});
		const session = this.sessionFactory.createSession({
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
		};
		this.bindTransport(context);
		session.attachRuntimeHooks(this.createSessionHooks(context));
		session.updateState(input.state);
		this.activeThreads.set(input.threadId, context);
		this.transportHealth.set(input.threadId, transport.getHealth());
		return context;
	}

	private createSessionHooks(context: OrcRuntimeThreadContext): OrcSessionRuntimeHooks {
		return {
			cancel: async (reason?: string) => {
				context.state = this.setStatePhase(context, "cancelled", context.state.checkpointId);
				await this.persistTrackerState(context);
				await context.live.transport.cancel(reason ?? "session_cancelled");
				await this.cleanupThread(context, reason ?? "session_cancelled");
			},
			shutdown: async (reason?: string) => {
				await context.live.transport.shutdown(reason ?? "session_shutdown");
				await this.cleanupThread(context, reason ?? "session_shutdown");
			},
			getTransportHealth: () => this.transportHealth.get(context.threadId),
			getEventBusSnapshot: () => context.live.eventBus.getSnapshot(),
		};
	}

	private bindTransport(context: OrcRuntimeThreadContext): void {
		context.live.transport.onLifecycle((event) => {
			if (!event.threadId || event.threadId !== context.threadId || context.disposed) {
				return;
			}
			this.transportHealth.set(context.threadId, context.live.transport.getHealth());
			if (event.stage === "ready") {
				context.state = this.setStatePhase(context, "planning", context.state.checkpointId);
				void this.persistTrackerState(context);
			}
			if (event.stage === "exit") {
				const phase: OrcLifecyclePhase = event.exitCode === 0 ? "completed" : context.state.phase === "cancelled" ? "cancelled" : "failed";
				context.state = this.setStatePhase(context, phase, context.state.checkpointId);
				void this.persistTrackerState(context).finally(() => this.cleanupThread(context, `transport_${event.stage}`));
			}
			if (event.stage === "terminated" || event.stage === "spawn_failed") {
				const phase: OrcLifecyclePhase = context.state.phase === "cancelled" ? "cancelled" : "failed";
				context.state = this.setStatePhase(context, phase, context.state.checkpointId);
				void this.persistTrackerState(context).finally(() => this.cleanupThread(context, `transport_${event.stage}`));
			}
		});
		context.live.transport.onEnvelope((envelope) => {
			if (envelope.origin.threadId !== context.threadId || context.disposed) {
				return;
			}
			this.transportHealth.set(context.threadId, context.live.transport.getHealth());
			const busEvent = normalizeOrcTransportEnvelope(envelope);
			context.live.eventBus.publish(busEvent);
			const nextCheckpointId = envelope.how.checkpointId ?? context.state.checkpointId;
			if (busEvent.kind === "checkpoint.status") {
				context.state = this.setStatePhase(context, busEvent.payload.status === "failed" ? "failed" : "checkpointed", busEvent.payload.checkpointId ?? nextCheckpointId);
				void this.persistTrackerState(context);
			}
		});
		context.live.transport.onDiagnostic((event) => {
			if (event.threadId && event.threadId !== context.threadId) {
				return;
			}
			this.transportHealth.set(context.threadId, context.live.transport.getHealth());
		});
	}

	private async startTransport(context: OrcRuntimeThreadContext, input: OrcRunnerLaunchInput, mode: "launch" | "resume"): Promise<void> {
		this.transportHealth.set(context.threadId, context.live.transport.getHealth());
		if (mode === "resume") {
			await context.live.transport.resume(input);
			return;
		}
		await context.live.transport.launch(input);
	}

	private buildLaunchInput(context: OrcRuntimeThreadContext, checkpoint?: OrcCheckpointMetadata): OrcRunnerLaunchInput {
		const checkpointId = checkpoint?.checkpointId ?? context.state.checkpointId;
		return {
			threadId: context.threadId,
			projectRoot: context.state.project.projectRoot,
			workspaceRoot: context.securityPolicy.workerSandbox.workspaceRoot,
			phaseIntent: checkpoint ? `resume:${checkpoint.phase}` : `launch:${context.state.phase}`,
			securityPolicy: context.securityPolicy,
			checkpointId,
			runCorrelationId: context.runCorrelationId,
			metadata: {
				projectId: context.state.project.projectId,
				projectName: context.state.project.projectName ?? null,
				branchName: context.state.project.branchName ?? null,
			},
			resume: {
				checkpointId,
				resumeToken: checkpoint?.resumeData?.resumeToken,
				resumeCursor: checkpoint?.resumeData?.resumeCursor,
				activeWaveId: checkpoint?.resumeData?.activeWaveId,
				metadata: {
					...(checkpoint?.resumeData?.metadata ?? {}),
					trackerStateId: checkpoint?.trackerStateId ?? null,
					latestCheckpointId: checkpointId ?? null,
				},
			},
		};
	}

	private async cleanupExistingThread(threadId: string, reason: string): Promise<void> {
		const existing = this.activeThreads.get(threadId);
		if (existing) {
			await this.cleanupThread(existing, reason);
		}
	}

	private async cleanupThread(context: OrcRuntimeThreadContext, reason: string): Promise<void> {
		if (context.disposed) {
			return;
		}
		context.disposed = true;
		context.cleanupReason = reason;
		this.activeThreads.delete(context.threadId);
		context.storageHooks.eventLogSubscription?.unsubscribe();
		try {
			context.live.eventBus.dispose();
		} catch {
			// Best effort: cleanup must stay deterministic even if subscribers were already removed.
		}
		await context.live.transport.dispose();
		this.transportHealth.set(context.threadId, context.live.transport.getHealth());
	}

	private createInitialState(input: {
		threadId: string;
		checkpointId?: string;
		project: LaunchOrcRequest["project"];
		securityPolicy: OrcSecurityPolicy;
		phase: OrcLifecyclePhase;
		message: string;
	}): OrcControlPlaneState {
		const now = new Date().toISOString();
		return {
			threadId: input.threadId,
			checkpointId: input.checkpointId,
			phase: input.phase,
			project: input.project,
			securityPolicy: input.securityPolicy,
			messages: [
				{
					id: `orc-message-${randomUUID()}`,
					role: "user",
					phase: input.phase,
					createdAt: now,
					content: input.message,
				},
			],
			workerResults: [],
			verificationErrors: [],
			lastUpdatedAt: now,
		};
	}

	private setStatePhase(context: OrcRuntimeThreadContext, phase: OrcLifecyclePhase, checkpointId?: string): OrcControlPlaneState {
		const nextState: OrcControlPlaneState = {
			...context.state,
			phase,
			checkpointId,
			lastUpdatedAt: new Date().toISOString(),
		};
		context.session.updateState(nextState);
		return nextState;
	}

	private async persistTrackerState(context: OrcRuntimeThreadContext): Promise<void> {
		context.session.updateState(context.state);
		await context.live.tracker.save(context.state);
	}
}
