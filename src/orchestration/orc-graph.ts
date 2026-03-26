import { type OrcContractModelName, type OrcContractValidationIssue, validateOrcContractPayload } from "./contracts.js";

export type OrcGraphNodeId = "route" | "dispatch" | "verify" | "complete" | "failed" | "contract_error";

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
	contractId: OrcContractModelName;
	taskId: string;
	payload: Record<string, unknown>;
	handoffToken: string;
	handedOffAt?: string;
}

/**
 * Explicit master state for graph-level chain-of-custody and contract handoff.
 */
export interface OrcContractValidationFailure {
	node: OrcGraphNodeId;
	contractId: OrcContractModelName;
	issues: OrcContractValidationIssue[];
	failedAt: string;
}

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
	reconReport?: Record<string, unknown>;
	failureDossier?: Record<string, unknown>;
	contractValidationFailure?: OrcContractValidationFailure;
}

export interface OrcGraphCheckpointer {
	save(state: Readonly<OrcMasterState>): Promise<void>;
}

export interface OrcGraphStoreHooks {
	onRoute?(state: Readonly<OrcMasterState>): Promise<void>;
	onDispatch?(state: Readonly<OrcMasterState>): Promise<void>;
	onVerify?(state: Readonly<OrcMasterState>): Promise<void>;
	onComplete?(state: Readonly<OrcMasterState>): Promise<void>;
	onContractError?(state: Readonly<OrcMasterState>): Promise<void>;
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
	dispatch(state: Readonly<OrcMasterState>): Promise<{ notes?: string; reconReport?: Record<string, unknown> }>;
	verify(state: Readonly<OrcMasterState>): Promise<{
		decision: "route" | "complete" | "failed";
		notes: string;
		failureCode?: string;
		failureDossier?: Record<string, unknown>;
	}>;
	complete(state: Readonly<OrcMasterState>): Promise<{ summary: string }>;
}

export interface OrcGraphMiddleware {
	name: string;
	onRoute?(state: Readonly<OrcMasterState>): Promise<void>;
	onDispatch?(state: Readonly<OrcMasterState>): Promise<void>;
	onVerify?(state: Readonly<OrcMasterState>): Promise<void>;
	onComplete?(state: Readonly<OrcMasterState>): Promise<void>;
	onContractError?(state: Readonly<OrcMasterState>): Promise<void>;
}

export interface OrcGraphFactoryConfig {
	executors: OrcGraphExecutors;
	checkpointer: OrcGraphCheckpointer;
	storeHooks?: OrcGraphStoreHooks;
	now?: () => Date;
	middleware?: ReadonlyArray<OrcGraphMiddleware>;
}

export interface OrcCompiledGraph {
	nodes: Readonly<Record<OrcGraphNodeId, OrcGraphNodeId>>;
	edges: Readonly<Record<"route" | "dispatch" | "verify", OrcGraphNodeId>>;
	middlewareOrder: ReadonlyArray<string>;
	step(state: OrcMasterState): Promise<OrcMasterState>;
}

const ORC_GRAPH_NODES: Readonly<Record<OrcGraphNodeId, OrcGraphNodeId>> = {
	route: "route",
	dispatch: "dispatch",
	verify: "verify",
	complete: "complete",
	failed: "failed",
	contract_error: "contract_error",
};

const ORC_GRAPH_EDGES: Readonly<Record<"route" | "dispatch" | "verify", OrcGraphNodeId>> = {
	route: "dispatch",
	dispatch: "verify",
	verify: "complete",
};

function createSubAgentMiddleware(): OrcGraphMiddleware {
	return {
		name: "subagent_dispatch_guard",
		async onDispatch(state) {
			if (!state.activeGuildMember) {
				throw new Error("Dispatch blocked: missing active guild member.");
			}
			if (!state.contractPayload) {
				throw new Error("Dispatch blocked: missing contract payload handoff.");
			}
		},
	};
}

function describeContractIssues(issues: OrcContractValidationIssue[]): string {
	if (issues.length === 0) {
		return "no validation issues reported";
	}
	return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

function routeContractError(state: OrcMasterState, node: OrcGraphNodeId, contractId: OrcContractModelName, issues: OrcContractValidationIssue[], now: () => Date): OrcMasterState {
	return {
		...state,
		next: "contract_error",
		failureSummary: `Contract validation failed in ${node} for ${contractId}: ${describeContractIssues(issues)}`,
		contractValidationFailure: {
			node,
			contractId,
			issues,
			failedAt: now().toISOString(),
		},
	};
}

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

function shouldBlockMechanicRouting(state: {
	targetGuildMember: string;
	contractPayload: OrcContractPayloadHandoff;
}): state is { targetGuildMember: "mechanic"; contractPayload: OrcContractPayloadHandoff } {
	return state.targetGuildMember === "mechanic" && state.contractPayload.contractId !== "StructuralBlueprint";
}

function shouldBlockArchitectContract(state: {
	targetGuildMember: string;
	contractPayload: OrcContractPayloadHandoff;
}): state is { targetGuildMember: "architect"; contractPayload: OrcContractPayloadHandoff } {
	return state.targetGuildMember === "architect" && state.contractPayload.contractId !== "StructuralBlueprint";
}

/**
 * Single orchestration graph factory with deterministic middleware layering:
 * 1) `subagent_dispatch_guard` (built-in)
 * 2) caller-provided middleware in declaration order
 *
 * This mirrors DeepAgents stack semantics where framework middleware is applied
 * first, then consumer middleware extends behavior without reordering base guards.
 */
export function build_orc_graph(config: OrcGraphFactoryConfig): OrcCompiledGraph {
	const now = config.now ?? (() => new Date());
	const middleware = [createSubAgentMiddleware(), ...(config.middleware ?? [])];

	async function runRouteNode(state: OrcMasterState): Promise<OrcMasterState> {
		for (const layer of middleware) {
			await layer.onRoute?.(state);
		}
		const route = await config.executors.route(state);
		const blueprintValidation = validateOrcContractPayload(route.contractPayload.contractId, route.contractPayload.payload);
		if (!blueprintValidation.ok) {
			const errored = routeContractError(state, "route", route.contractPayload.contractId, blueprintValidation.issues, now);
			return checkpointAndHook(errored, config.checkpointer, config.storeHooks?.onContractError);
		}
		if (shouldBlockArchitectContract(route)) {
			const errored = routeContractError(
				state,
				"route",
				route.contractPayload.contractId,
				[
					{
						path: "route.contractPayload.contractId",
						expected: "StructuralBlueprint",
						received: route.contractPayload.contractId,
						message: "Architect must emit StructuralBlueprint contract output only.",
					},
				],
				now,
			);
			return checkpointAndHook(errored, config.checkpointer, config.storeHooks?.onContractError);
		}
		if (shouldBlockMechanicRouting(route)) {
			const errored = routeContractError(
				state,
				"route",
				route.contractPayload.contractId,
				[
					{
						path: "route.contractPayload.contractId",
						expected: "StructuralBlueprint",
						received: route.contractPayload.contractId,
						message: "Routing to Mechanic is blocked unless StructuralBlueprint validation passes.",
					},
				],
				now,
			);
			return checkpointAndHook(errored, config.checkpointer, config.storeHooks?.onContractError);
		}
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
		for (const layer of middleware) {
			await layer.onDispatch?.(state);
		}
		if (state.contractPayload) {
			const handoffValidation = validateOrcContractPayload(state.contractPayload.contractId, state.contractPayload.payload);
			if (!handoffValidation.ok) {
				const errored = routeContractError(state, "dispatch", state.contractPayload.contractId, handoffValidation.issues, now);
				return checkpointAndHook(errored, config.checkpointer, config.storeHooks?.onContractError);
			}
		}
		const dispatched = await config.executors.dispatch(state);
		if (dispatched.reconReport) {
			const reconValidation = validateOrcContractPayload("ReconReport", dispatched.reconReport);
			if (!reconValidation.ok) {
				const errored = routeContractError(state, "dispatch", "ReconReport", reconValidation.issues, now);
				return checkpointAndHook(errored, config.checkpointer, config.storeHooks?.onContractError);
			}
		}
		const dispatchedState: OrcMasterState = {
			...state,
			next: ORC_GRAPH_EDGES.dispatch,
			verificationNotes: dispatched.notes ?? state.verificationNotes,
			reconReport: dispatched.reconReport ?? state.reconReport,
		};
		return checkpointAndHook(dispatchedState, config.checkpointer, config.storeHooks?.onDispatch);
	}

	async function runVerifyNode(state: OrcMasterState): Promise<OrcMasterState> {
		for (const layer of middleware) {
			await layer.onVerify?.(state);
		}
		if (state.reconReport) {
			const reconValidation = validateOrcContractPayload("ReconReport", state.reconReport);
			if (!reconValidation.ok) {
				const errored = routeContractError(state, "verify", "ReconReport", reconValidation.issues, now);
				return checkpointAndHook(errored, config.checkpointer, config.storeHooks?.onContractError);
			}
		}
		const verification = await config.executors.verify(state);
		if (verification.failureDossier) {
			const failureValidation = validateOrcContractPayload("FailureDossier", verification.failureDossier);
			if (!failureValidation.ok) {
				const errored = routeContractError(state, "verify", "FailureDossier", failureValidation.issues, now);
				return checkpointAndHook(errored, config.checkpointer, config.storeHooks?.onContractError);
			}
		}
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
			failureDossier: verification.failureDossier ?? state.failureDossier,
		};
		return checkpointAndHook(verifiedState, config.checkpointer, config.storeHooks?.onVerify);
	}


	async function runContractErrorNode(state: OrcMasterState): Promise<OrcMasterState> {
		const erroredState: OrcMasterState = {
			...state,
			next: "contract_error",
			failureSummary:
				state.failureSummary ??
				`Contract validation failed for ${state.contractValidationFailure?.contractId ?? "unknown"} in ${state.contractValidationFailure?.node ?? "unknown"}.`,
		};
		return checkpointAndHook(erroredState, config.checkpointer, config.storeHooks?.onContractError);
	}

	async function runCompleteNode(state: OrcMasterState): Promise<OrcMasterState> {
		for (const layer of middleware) {
			await layer.onComplete?.(state);
		}
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
		middlewareOrder: middleware.map((layer) => layer.name),
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
				case "contract_error":
					return runContractErrorNode(state);
				default: {
					const exhaustiveGuard: never = state.next;
					throw new Error(`Unknown node: ${String(exhaustiveGuard)}`);
				}
			}
		},
	};
}
