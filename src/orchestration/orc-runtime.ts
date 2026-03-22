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
import {
	OrcPythonChildProcessTransport,
	type OrcPythonTransport,
	type OrcPythonTransportHealth,
} from "./orc-python-transport.js";
import { createDefaultOrcSecurityPolicy, mergeOrcSecurityPolicy, type OrcSecurityPolicy } from "./orc-security.js";
import { OrcSessionHandle, type OrcSession } from "./orc-session.js";

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
}

/**
 * Placeholder session factory boundary for Phase 1.
 * Enforcement points should attach the merged security policy here before sub-agent execution exists.
 */
export interface OrcSessionFactory {
	createSession(request: LaunchOrcRequest, securityPolicy: OrcSecurityPolicy): OrcSession;
}

export interface OrcRuntime {
	launch(request: LaunchOrcRequest): Promise<LaunchOrcResponse>;
	loadTrackerState(request: LoadOrcTrackerStateRequest): Promise<LoadOrcTrackerStateResponse>;
	enumerateArtifacts(request: EnumerateOrcArtifactsRequest): Promise<EnumerateOrcArtifactsResponse>;
	resumeThread(request: ResumeOrcThreadRequest): Promise<ResumeOrcThreadResponse>;
}

/**
 * Phase 1 placeholder runtime that defines the adapter boundary but does not
 * implement orchestration behavior yet.
 */
export class OrcRuntimeSkeleton implements OrcRuntime {
	private readonly sessionFactory: OrcSessionFactory;
	private readonly securityPolicy: OrcSecurityPolicy;
	private readonly activeTransports = new Map<string, OrcPythonTransport>();
	private readonly transportHealth = new Map<string, OrcPythonTransportHealth>();

	constructor(
		readonly adapters: OrcRuntimeAdapters = {},
		options: {
			sessionFactory?: OrcSessionFactory;
			securityPolicy?: OrcSecurityPolicy;
		} = {},
	) {
		this.securityPolicy = options.securityPolicy ?? createDefaultOrcSecurityPolicy();
		this.sessionFactory = options.sessionFactory ?? {
			createSession: (request, securityPolicy) =>
				new OrcSessionHandle(request.resumeThreadId ?? "pending-thread", undefined, request.resumeCheckpointId, securityPolicy),
		};
	}

	async launch(_request: LaunchOrcRequest): Promise<LaunchOrcResponse> {
		const securityPolicy = mergeOrcSecurityPolicy(this.securityPolicy, _request.securityPolicyOverrides);
		const session = this.sessionFactory.createSession(_request, securityPolicy);
		this.transportHealth.set(session.threadId, {
			stage: "idle",
			status: "idle",
			threadId: session.threadId,
			args: [],
			stdoutLines: 0,
			stderrLines: 0,
			stdoutBufferedBytes: 0,
			stderrBufferedBytes: 0,
			diagnosticsDropped: 0,
		});
		throw new Error("Orc runtime launch is not implemented yet.");
	}

	async loadTrackerState(_request: LoadOrcTrackerStateRequest): Promise<LoadOrcTrackerStateResponse> {
		return { found: false };
	}

	async enumerateArtifacts(_request: EnumerateOrcArtifactsRequest): Promise<EnumerateOrcArtifactsResponse> {
		return { entries: [] };
	}

	async resumeThread(_request: ResumeOrcThreadRequest): Promise<ResumeOrcThreadResponse> {
		throw new Error("Orc runtime resume is not implemented yet.");
	}

	createPythonTransport(): OrcPythonTransport {
		const transport =
			this.adapters.createPythonTransport?.() ??
			new OrcPythonChildProcessTransport({
				buildSpawnContract: this.adapters.buildPythonRunnerSpawnContract,
			});
		transport.onLifecycle((event) => {
			if (event.threadId) {
				this.transportHealth.set(event.threadId, transport.getHealth());
				if (event.stage === "exit" || event.stage === "terminated" || event.stage === "spawn_failed") {
					this.activeTransports.delete(event.threadId);
				}
			}
		});
		transport.onEnvelope((envelope) => {
			const threadId = envelope.origin.threadId;
			if (threadId) {
				this.transportHealth.set(threadId, transport.getHealth());
			}
		});
		transport.onDiagnostic((event) => {
			if (event.threadId) {
				this.transportHealth.set(event.threadId, transport.getHealth());
			}
		});
		return transport;
	}

	getTransportHealth(threadId: string): OrcPythonTransportHealth | undefined {
		return this.transportHealth.get(threadId);
	}
}
