export type OrcGraphNodeId = "route" | "dispatch" | "verify" | "complete" | "failed";

export type OrcRouteDecision = "dispatch" | "failed";

export interface OrcChainOfCustodyRoute {
	node: OrcGraphNodeId;
	targetGuildMember: string;
	reason: string;
	attempt: number;
	routedAt: string;
}

export interface OrcRoutingState {
	taskType: string;
	requestedBy: string;
	targetGuildMember?: string;
	chainOfCustody: OrcChainOfCustodyRoute[];
}

export interface OrcRetryState {
	attempt: number;
	maxAttempts: number;
	lastFailureCode?: string;
	lastFailureMessage?: string;
}

export interface OrcActiveGuildMember {
	memberId: string;
	role: string;
	sessionId: string;
	activatedAt: string;
}

export interface OrcContractPayloadHandoff {
	contractId: string;
	taskId: string;
	payload: Record<string, unknown>;
	handoffToken: string;
	handedOffAt?: string;
}

/**
 * Explicit master state for graph-level chain-of-custody and contract handoff.
 */
export interface OrcMasterState {
	threadId: string;
	runCorrelationId: string;
	next: OrcGraphNodeId;
	routing: OrcRoutingState;
	retries: OrcRetryState;
	activeGuildMember?: OrcActiveGuildMember;
	contractPayload?: OrcContractPayloadHandoff;
	verificationNotes?: string;
	completionSummary?: string;
	failureSummary?: string;
}

export interface OrcGraphCheckpointer {
	save(state: Readonly<OrcMasterState>): Promise<void>;
}

export interface OrcGraphStoreHooks {
	onRoute?(state: Readonly<OrcMasterState>): Promise<void>;
	onDispatch?(state: Readonly<OrcMasterState>): Promise<void>;
	onVerify?(state: Readonly<OrcMasterState>): Promise<void>;
	onComplete?(state: Readonly<OrcMasterState>): Promise<void>;
	onFailed?(state: Readonly<OrcMasterState>): Promise<void>;
}

export interface OrcGraphExecutors {
	route(state: Readonly<OrcMasterState>): Promise<{
		targetGuildMember: string;
		reason: string;
		activeGuildMember: OrcActiveGuildMember;
		contractPayload: OrcContractPayloadHandoff;
		decision: OrcRouteDecision;
	}>;
	dispatch(state: Readonly<OrcMasterState>): Promise<{ notes?: string }>;
	verify(state: Readonly<OrcMasterState>): Promise<{
		decision: "route" | "complete" | "failed";
		notes: string;
		failureCode?: string;
	}>;
	complete(state: Readonly<OrcMasterState>): Promise<{ summary: string }>;
}

export interface OrcGraphFactoryConfig {
	executors: OrcGraphExecutors;
	checkpointer: OrcGraphCheckpointer;
	storeHooks?: OrcGraphStoreHooks;
	now?: () => Date;
}

export interface OrcCompiledGraph {
	nodes: Readonly<Record<OrcGraphNodeId, OrcGraphNodeId>>;
	edges: Readonly<Record<"route" | "dispatch" | "verify", OrcGraphNodeId>>;
	step(state: OrcMasterState): Promise<OrcMasterState>;
}

const ORC_GRAPH_NODES: Readonly<Record<OrcGraphNodeId, OrcGraphNodeId>> = {
	route: "route",
	dispatch: "dispatch",
	verify: "verify",
	complete: "complete",
	failed: "failed",
};

const ORC_GRAPH_EDGES: Readonly<Record<"route" | "dispatch" | "verify", OrcGraphNodeId>> = {
	route: "dispatch",
	dispatch: "verify",
	verify: "complete",
};

async function checkpointAndHook(
	state: OrcMasterState,
	checkpointer: OrcGraphCheckpointer,
	hook: ((state: Readonly<OrcMasterState>) => Promise<void>) | undefined,
): Promise<OrcMasterState> {
	await checkpointer.save(state);
	if (hook) {
		await hook(state);
	}
	return state;
}

/**
 * Single orchestration graph factory. Mirrors DeepAgents-style construction by
 * accepting runtime dependencies at build-time, then returning a compiled graph.
 */
export function build_orc_graph(config: OrcGraphFactoryConfig): OrcCompiledGraph {
	const now = config.now ?? (() => new Date());

	async function runRouteNode(state: OrcMasterState): Promise<OrcMasterState> {
		const route = await config.executors.route(state);
		const next = route.decision === "dispatch" ? ORC_GRAPH_EDGES.route : "failed";
		const routedState: OrcMasterState = {
			...state,
			next,
			activeGuildMember: route.activeGuildMember,
			contractPayload: {
				...route.contractPayload,
				handedOffAt: route.contractPayload.handedOffAt ?? now().toISOString(),
			},
			routing: {
				...state.routing,
				targetGuildMember: route.targetGuildMember,
				chainOfCustody: [
					...state.routing.chainOfCustody,
					{
						node: "route",
						targetGuildMember: route.targetGuildMember,
						reason: route.reason,
						attempt: state.retries.attempt,
						routedAt: now().toISOString(),
					},
				],
			},
		};
		return checkpointAndHook(routedState, config.checkpointer, config.storeHooks?.onRoute);
	}

	async function runDispatchNode(state: OrcMasterState): Promise<OrcMasterState> {
		if (!state.contractPayload) {
			throw new Error("Dispatch blocked: missing contract payload handoff.");
		}
		const dispatched = await config.executors.dispatch(state);
		const dispatchedState: OrcMasterState = {
			...state,
			next: ORC_GRAPH_EDGES.dispatch,
			verificationNotes: dispatched.notes ?? state.verificationNotes,
		};
		return checkpointAndHook(dispatchedState, config.checkpointer, config.storeHooks?.onDispatch);
	}

	async function runVerifyNode(state: OrcMasterState): Promise<OrcMasterState> {
		const verification = await config.executors.verify(state);
		const canRetry = state.retries.attempt < state.retries.maxAttempts;
		const next = verification.decision === "route" && canRetry ? "route" : verification.decision;
		const retries =
			next === "route"
				? {
					...state.retries,
					attempt: state.retries.attempt + 1,
					lastFailureCode: verification.failureCode,
					lastFailureMessage: verification.notes,
				}
				: state.retries;
		const verifiedState: OrcMasterState = {
			...state,
			next,
			retries,
			verificationNotes: verification.notes,
		};
		return checkpointAndHook(verifiedState, config.checkpointer, config.storeHooks?.onVerify);
	}

	async function runCompleteNode(state: OrcMasterState): Promise<OrcMasterState> {
		if (state.next === "failed") {
			const failedState: OrcMasterState = {
				...state,
				failureSummary: state.verificationNotes ?? state.failureSummary ?? "Orchestration failed before completion.",
			};
			return checkpointAndHook(failedState, config.checkpointer, config.storeHooks?.onFailed);
		}
		const complete = await config.executors.complete(state);
		const completedState: OrcMasterState = {
			...state,
			next: "complete",
			completionSummary: complete.summary,
		};
		return checkpointAndHook(completedState, config.checkpointer, config.storeHooks?.onComplete);
	}

	return {
		nodes: ORC_GRAPH_NODES,
		edges: ORC_GRAPH_EDGES,
		async step(state: OrcMasterState): Promise<OrcMasterState> {
			switch (state.next) {
				case "route":
					return runRouteNode(state);
				case "dispatch":
					return runDispatchNode(state);
				case "verify":
					return runVerifyNode(state);
				case "complete":
				case "failed":
					return runCompleteNode(state);
				default: {
					const exhaustiveGuard: never = state.next;
					throw new Error(`Unknown node: ${String(exhaustiveGuard)}`);
				}
			}
		},
	};
}
