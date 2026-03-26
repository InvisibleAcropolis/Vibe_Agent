export type OrcAgentNodeId = "plan" | "delegate" | "evaluate" | "scribe" | "complete";

export type OrcTodoStatus = "pending" | "in_progress" | "completed";

/**
 * DeepAgents-style todo item generated via `write_todos` semantics.
 *
 * The orchestrator requires at least one todo before sub-agent delegation.
 */
export interface OrcTodoItem {
	id: string;
	title: string;
	status: OrcTodoStatus;
	description?: string;
	owner?: string;
}

/**
 * Durable planning snapshot persisted outside short-term model context.
 *
 * The `revision` and `savedAt` fields allow future runtime code to restore
 * the most recent plan snapshot before continuing graph execution.
 */
export interface OrcPlanningStateSnapshot {
	threadId: string;
	runCorrelationId: string;
	revision: number;
	savedAt: string;
	todos: OrcTodoItem[];
	planSummary: string;
	activeObjective?: string;
	metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Persistence boundary for planning state.
 *
 * This intentionally stays storage-agnostic so runtime wiring can back it with
 * files, sqlite, LangGraph checkpoints, or remote stores.
 */
export interface OrcPlanningStateStore {
	loadLatest(threadId: string): Promise<OrcPlanningStateSnapshot | undefined>;
	save(snapshot: OrcPlanningStateSnapshot): Promise<void>;
}

/**
 * Success signal emitted by Scribe after docs/docstrings/README updates land.
 * Orc must not emit final "done" unless this signal is present and successful.
 */
export interface OrcAgentScribeResult {
	success: boolean;
	updatedTargets: string[];
	diffSummaryArtifactPath: string;
	notes?: string;
}

export interface OrcAgentState {
	threadId: string;
	runCorrelationId: string;
	goal: string;
	iteration: number;
	maxIterations: number;
	planSummary?: string;
	todos: OrcTodoItem[];
	lastDelegationSummary?: string;
	evaluationNotes?: string;
	completionSummary?: string;
	scribeResult?: OrcAgentScribeResult;
	planningSnapshotRevision?: number;
	next: OrcAgentNodeId;
}

export interface OrcPlanNodeResult {
	planSummary: string;
	todos: OrcTodoItem[];
	activeObjective?: string;
	metadata?: Record<string, string | number | boolean | null>;
}

export interface OrcDelegateNodeResult {
	summary: string;
}

export interface OrcEvaluateNodeResult {
	notes: string;
	decision: "continue" | "complete";
}

export interface OrcAgentGraphExecutors {
	plan(state: Readonly<OrcAgentState>): Promise<OrcPlanNodeResult>;
	delegate(state: Readonly<OrcAgentState>): Promise<OrcDelegateNodeResult>;
	evaluate(state: Readonly<OrcAgentState>): Promise<OrcEvaluateNodeResult>;
	scribe(state: Readonly<OrcAgentState>): Promise<OrcAgentScribeResult>;
	complete?(state: Readonly<OrcAgentState>): Promise<string | undefined>;
}

export interface OrcAgentGraph {
	nodes: Readonly<Record<OrcAgentNodeId, OrcAgentNodeId>>;
	edges: Readonly<Record<Exclude<OrcAgentNodeId, "evaluate">, OrcAgentNodeId>>;
	decisionEdges: Readonly<Record<OrcEvaluateNodeResult["decision"], OrcAgentNodeId>>;
	step(state: OrcAgentState): Promise<OrcAgentState>;
}

const ORC_AGENT_NODES: Readonly<Record<OrcAgentNodeId, OrcAgentNodeId>> = {
	plan: "plan",
	delegate: "delegate",
	evaluate: "evaluate",
	scribe: "scribe",
	complete: "complete",
};

const ORC_AGENT_EDGES: Readonly<Record<Exclude<OrcAgentNodeId, "evaluate">, OrcAgentNodeId>> = {
	plan: "delegate",
	delegate: "evaluate",
	scribe: "complete",
	complete: "complete",
};

const ORC_AGENT_DECISION_EDGES: Readonly<Record<OrcEvaluateNodeResult["decision"], OrcAgentNodeId>> = {
	continue: "plan",
	complete: "scribe",
};

function assertWriteTodosDecomposition(todos: OrcTodoItem[]): void {
	if (todos.length === 0) {
		throw new Error("Delegation blocked: `write_todos` decomposition is required before sub-agent execution.");
	}
	for (const todo of todos) {
		if (!todo.id.trim() || !todo.title.trim()) {
			throw new Error("Delegation blocked: each todo must include both `id` and `title`.");
		}
	}
}

function deriveNextPlanningRevision(snapshot: OrcPlanningStateSnapshot | undefined): number {
	if (!snapshot) {
		return 1;
	}
	return snapshot.revision + 1;
}

function clampIteration(iteration: number, maxIterations: number): number {
	if (iteration < 0) {
		return 0;
	}
	if (iteration > maxIterations) {
		return maxIterations;
	}
	return iteration;
}

/**
 * Creates a LangGraph-inspired agent graph with explicit nodes and transitions:
 * `plan -> delegate -> evaluate -> (continue -> plan | complete)`.
 *
 * DeepAgents-inspired guardrails are enforced in `delegate`:
 * - `write_todos`-style decomposition is mandatory.
 * - planning state is persisted via `OrcPlanningStateStore` before sub-agent execution.
 */
export function createOrcAgentGraph(deps: {
	executors: OrcAgentGraphExecutors;
	planningStore: OrcPlanningStateStore;
	now?: () => Date;
}): OrcAgentGraph {
	const now = deps.now ?? (() => new Date());

	async function runPlanNode(state: OrcAgentState): Promise<OrcAgentState> {
		const plan = await deps.executors.plan(state);
		assertWriteTodosDecomposition(plan.todos);
		const latestSnapshot = await deps.planningStore.loadLatest(state.threadId);
		const snapshot: OrcPlanningStateSnapshot = {
			threadId: state.threadId,
			runCorrelationId: state.runCorrelationId,
			revision: deriveNextPlanningRevision(latestSnapshot),
			savedAt: now().toISOString(),
			todos: plan.todos,
			planSummary: plan.planSummary,
			activeObjective: plan.activeObjective,
			metadata: plan.metadata,
		};
		await deps.planningStore.save(snapshot);
		return {
			...state,
			planSummary: plan.planSummary,
			todos: plan.todos,
			planningSnapshotRevision: snapshot.revision,
			next: ORC_AGENT_EDGES.plan,
		};
	}

	async function runDelegateNode(state: OrcAgentState): Promise<OrcAgentState> {
		assertWriteTodosDecomposition(state.todos);
		const delegation = await deps.executors.delegate(state);
		return {
			...state,
			lastDelegationSummary: delegation.summary,
			next: ORC_AGENT_EDGES.delegate,
		};
	}

	async function runEvaluateNode(state: OrcAgentState): Promise<OrcAgentState> {
		const evaluation = await deps.executors.evaluate(state);
		const nextNode = ORC_AGENT_DECISION_EDGES[evaluation.decision];
		const incrementedIteration = clampIteration(state.iteration + 1, state.maxIterations);
		const forcedCompletion = incrementedIteration >= state.maxIterations;
		return {
			...state,
			iteration: incrementedIteration,
			evaluationNotes: evaluation.notes,
			next: forcedCompletion ? "scribe" : nextNode,
		};
	}

	async function runScribeNode(state: OrcAgentState): Promise<OrcAgentState> {
		const scribeResult = await deps.executors.scribe(state);
		if (!scribeResult.success) {
			throw new Error("Orc completion blocked: Scribe must succeed before finalizing the run.");
		}
		return {
			...state,
			next: ORC_AGENT_EDGES.scribe,
			scribeResult,
		};
	}

	async function runCompleteNode(state: OrcAgentState): Promise<OrcAgentState> {
		if (!state.scribeResult?.success) {
			throw new Error("Orc completion blocked: Scribe success signal is required before emitting done.");
		}
		const completionSummary = deps.executors.complete
			? await deps.executors.complete(state)
			: state.evaluationNotes;
		return {
			...state,
			next: "complete",
			completionSummary,
		};
	}

	return {
		nodes: ORC_AGENT_NODES,
		edges: ORC_AGENT_EDGES,
		decisionEdges: ORC_AGENT_DECISION_EDGES,
		async step(state: OrcAgentState): Promise<OrcAgentState> {
			switch (state.next) {
				case "plan":
					return runPlanNode(state);
				case "delegate":
					return runDelegateNode(state);
				case "evaluate":
					return runEvaluateNode(state);
				case "scribe":
					return runScribeNode(state);
				case "complete":
					return runCompleteNode(state);
				default: {
					const exhaustiveGuard: never = state.next;
					throw new Error(`Unknown node: ${String(exhaustiveGuard)}`);
				}
			}
		},
	};
}
