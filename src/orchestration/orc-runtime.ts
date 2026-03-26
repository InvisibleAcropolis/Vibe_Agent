import { randomUUID } from "node:crypto";
import type {
	EnumerateOrcArtifactsRequest,
	EnumerateOrcArtifactsResponse,
	LaunchOrcRequest,
	LaunchOrcResponse,
	LoadOrcTrackerStateRequest,
	LoadOrcTrackerStateResponse,
	ResumeOrcThreadRequest,
	ResumeOrcThreadResponse,
} from "./orc-io.js";
import {
	NoopOrcCheckpointStore,
	type OrcCheckpointStore,
} from "./orc-checkpoints.js";
import type { OrcPythonTransportHealth, OrcPythonTransportLifecycleEvent } from "./orc-python-transport.js";
import { createDefaultOrcSecurityPolicy, mergeOrcSecurityPolicy, type OrcSecurityPolicy } from "./orc-security.js";
import { OrcSessionHandle, type OrcSession } from "./orc-session.js";
import { NoopOrcStorage, type OrcStorage } from "./orc-storage.js";
import { NoopOrcTracker, type OrcTracker } from "./orc-tracker.js";
import { type OrcControlPlaneState, type OrcLifecyclePhase } from "./orc-state.js";
import { cleanupExistingThread, cleanupThread } from "./orc-runtime/cleanup.js";
import { reduceOrcControlPlaneEvent } from "./orc-events/control-plane-reducer.js";
import { OrcRuntimePersistenceCoordinator } from "./orc-runtime/persistence.js";
import {
	buildLaunchInput,
	createInitialState,
	createResumeLaunchRequest,
	createResumeState,
} from "./orc-runtime/state-bootstrap.js";
import { createRuntimeSessionHooks } from "./orc-runtime/session-hooks.js";
import { OrcRuntimeTransportSupervisor, bindTransport, publishRuntimeEvent, startTransport } from "./orc-runtime/transport-supervisor.js";
import { getTerminalSessionManager } from "./terminal/session_manager.js";
import { createThreadContext } from "./orc-runtime/thread-context-factory.js";
import type {
	OrcRuntime,
	OrcRuntimeAdapters,
	OrcRuntimeThreadContext,
	OrcSessionFactory,
} from "./orc-runtime/types.js";

export type {
	OrcRuntime,
	OrcRuntimeAdapters,
	OrcRuntimeLiveHandles,
	OrcRuntimeStorageHooks,
	OrcRuntimeThreadContext,
	OrcSessionFactory,
	OrcSessionFactoryInput,
} from "./orc-runtime/index.js";
export * from "./orc-runtime/index.js";

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
	private readonly persistenceCoordinator = new OrcRuntimePersistenceCoordinator();
	private readonly transportSupervisor = new OrcRuntimeTransportSupervisor();
	private readonly terminalSessionManager = getTerminalSessionManager();

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
		const context = await this.prepareLaunchContext({
			request,
			threadId,
			runCorrelationId,
			checkpointId: request.resumeCheckpointId,
			securityPolicy,
			state: createInitialState({
				threadId,
				checkpointId: request.resumeCheckpointId,
				project: request.project,
				securityPolicy,
				phase: "bootstrapping",
				message: request.prompt,
			}),
		});
		await this.launchTransport(context, undefined, "launch");
		return this.toLaunchResponse(context);
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
		const context = await this.prepareLaunchContext({
			request: createResumeLaunchRequest({ request, restoredState, checkpoint }),
			threadId: request.threadId,
			runCorrelationId,
			checkpointId: request.checkpointId ?? checkpoint?.checkpointId,
			securityPolicy,
			state: createResumeState({ restoredState, checkpoint }),
		});
		await this.launchTransport(context, checkpoint, "resume");
		return this.toResumeResponse(context);
	}

	async dispose(): Promise<void> {
		await Promise.all([...this.activeThreads.values()].map((context) => this.cleanupThread(context, "runtime_disposed")));
	}

	getTransportHealth(threadId: string): OrcPythonTransportHealth | undefined {
		return this.transportHealth.get(threadId);
	}

	getSession(threadId: string): OrcSession | undefined {
		return this.activeThreads.get(threadId)?.session;
	}

	private async prepareLaunchContext(input: {
		request: LaunchOrcRequest;
		threadId: string;
		runCorrelationId: string;
		checkpointId?: string;
		securityPolicy: OrcSecurityPolicy;
		state: OrcControlPlaneState;
	}): Promise<OrcRuntimeThreadContext> {
		await cleanupExistingThread({
			threadId: input.threadId,
			reason: "thread_replaced",
			activeThreads: this.activeThreads,
			cleanupThread: (context, reason) => this.cleanupThread(context, reason),
		});
		const context = await createThreadContext({
			...input,
			adapters: this.adapters,
			tracker: this.tracker,
			checkpointStore: this.checkpoints,
			storage: this.storage,
			sessionFactory: this.sessionFactory,
		});
		context.session.attachRuntimeHooks(createRuntimeSessionHooks({
			context,
			transportHealth: this.transportHealth,
			persistTrackerState: (runtimeContext) => this.persistTrackerState(runtimeContext),
			cleanupThread: (runtimeContext, reason) => this.cleanupThread(runtimeContext, reason),
		}));
		context.session.updateState(context.state);
		this.activeThreads.set(context.threadId, context);
		this.transportHealth.set(context.threadId, context.live.transport.getHealth());
		this.bindTransport(context);
		await this.persistTrackerState(context);
		return context;
	}

	private async launchTransport(
		context: OrcRuntimeThreadContext,
		checkpoint: Awaited<ReturnType<OrcCheckpointStore["loadCheckpoint"]>>,
		mode: "launch" | "resume",
	): Promise<void> {
		await this.ensureTerminalSession(mode);
		await startTransport(context, buildLaunchInput(context, checkpoint), mode, this.transportHealth);
	}

	private toLaunchResponse(context: OrcRuntimeThreadContext): LaunchOrcResponse {
		return {
			threadId: context.threadId,
			checkpointId: context.state.checkpointId,
			state: context.state,
		};
	}

	private toResumeResponse(context: OrcRuntimeThreadContext): ResumeOrcThreadResponse {
		return {
			threadId: context.threadId,
			checkpointId: context.state.checkpointId,
			state: context.state,
		};
	}

	private bindTransport(context: OrcRuntimeThreadContext): void {
		bindTransport({
			context,
			transportHealth: this.transportHealth,
			publishRuntimeEvent: (runtimeContext, busEvent) => this.publishRuntimeEvent(runtimeContext, busEvent),
			handleTerminalLifecycle: (runtimeContext, event) => void this.handleTerminalLifecycle(runtimeContext, event),
		});
	}

	private publishRuntimeEvent(context: OrcRuntimeThreadContext, busEvent: Parameters<typeof publishRuntimeEvent>[0]["busEvent"]): void {
		const published = this.transportSupervisor.publishRuntimeEvent({
			context,
			busEvent,
		});
		if (!published) {
			return;
		}
		context.state = reduceOrcControlPlaneEvent(context.state, busEvent);
		context.session.updateState(context.state);
		if (this.persistenceCoordinator.shouldPersistAfterEvent(context, busEvent)) {
			void this.persistTrackerState(context);
		}
	}

	private async cleanupThread(context: OrcRuntimeThreadContext, reason: string): Promise<void> {
		await cleanupThread({
			context,
			reason,
			activeThreads: this.activeThreads,
			transportHealth: this.transportHealth,
		});
		try {
			await this.terminalSessionManager.shutdownCoreSession();
		} catch {
			// Keep runtime cleanup resilient; transport disposal and tracker persistence stay authoritative.
		}
	}

	private async ensureTerminalSession(mode: "launch" | "resume"): Promise<void> {
		try {
			if (mode === "resume") {
				await this.terminalSessionManager.recoverCoreSession();
				return;
			}
			await this.terminalSessionManager.ensureCoreSessionDetached();
		} catch {
			// psmux is optional outside the target host profile; transport launch still proceeds.
		}
	}


	private async handleTerminalLifecycle(context: OrcRuntimeThreadContext, event: OrcPythonTransportLifecycleEvent): Promise<void> {
		await this.persistTrackerState(context);
		await this.cleanupThread(context, `transport_${event.stage}`);
	}

	private async persistTrackerState(context: OrcRuntimeThreadContext): Promise<void> {
		await this.persistenceCoordinator.persistTrackerState(context);
	}
}
