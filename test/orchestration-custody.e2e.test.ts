import assert from "node:assert";
import { describe, it } from "node:test";
import { RpcEventCurator } from "../src/orchestration/bridge/curator.js";
import type { RpcAgentRuntimeState, RpcAgentRole, RpcProcessLauncher, RpcTelemetryEnvelope } from "../src/orchestration/bridge/rpc_launcher.js";
import type { TerminalPaneMetadata, TerminalPaneOrchestrator } from "../src/orchestration/terminal/pane_orchestrator.js";
import { createArchivistSubgraph, type ArchivistSubgraphState } from "../src/orchestration/graph/subagents/archivist-subgraph.js";
import { createInquisitorSubgraph, type InquisitorSubgraphState } from "../src/orchestration/graph/subagents/inquisitor-subgraph.js";
import { createMechanicSubgraph, type MechanicSubgraphState } from "../src/orchestration/graph/subagents/mechanic-subgraph.js";
import { createOrcAgentGraph, type OrcAgentState, type OrcPlanningStateSnapshot, type OrcPlanningStateStore } from "../src/orchestration/graph/orc_agent.js";
import {
	OrcSubagentRouter,
	type OrcSubagentToolPolicyViolationError,
} from "../src/orchestration/graph/subagents/index.js";
import { build_orc_graph, type OrcGraphCheckpointer, type OrcMasterState } from "../src/orchestration/orc-graph.js";

class InMemoryCheckpointer implements OrcGraphCheckpointer {
	readonly snapshots: OrcMasterState[] = [];

	async save(state: Readonly<OrcMasterState>): Promise<void> {
		this.snapshots.push(structuredClone(state));
	}
}

class MemoryPlanningStore implements OrcPlanningStateStore {
	latest?: OrcPlanningStateSnapshot;

	async loadLatest(): Promise<OrcPlanningStateSnapshot | undefined> {
		return this.latest;
	}

	async save(snapshot: OrcPlanningStateSnapshot): Promise<void> {
		this.latest = snapshot;
	}
}

class FakeRpcLauncher implements Pick<RpcProcessLauncher, "startAgent" | "getAgentState"> {
	private readonly states = new Map<RpcAgentRole, RpcAgentRuntimeState>();

	constructor() {
		this.states.set("scout", this.createState("scout", "scout-main", "scout-instance"));
	}

	startAgent(role: RpcAgentRole): RpcAgentRuntimeState {
		const state = this.states.get(role);
		if (!state) {
			throw new Error(`missing state for ${role}`);
		}
		return state;
	}

	getAgentState(role: RpcAgentRole): RpcAgentRuntimeState {
		const state = this.states.get(role);
		if (!state) {
			throw new Error(`missing state for ${role}`);
		}
		return state;
	}

	private createState(role: RpcAgentRole, agentId: string, instanceId: string): RpcAgentRuntimeState {
		return {
			identity: {
				agentRole: role,
				agentId,
				instanceId,
				launchAttempt: 0,
				pid: 2001,
			},
			status: "running",
			restartCount: 0,
		};
	}
}

class FakePaneOrchestrator implements Pick<TerminalPaneOrchestrator, "splitVertical"> {
	async splitVertical(role: "primary" | "secondary" | "observer" | "custom", agentBinding: { agentId: string } | null = null): Promise<TerminalPaneMetadata> {
		return {
			paneId: "%e2e-pane",
			role,
			createdAt: new Date("2026-03-26T00:00:00.000Z"),
			agentBinding: agentBinding ? { agentId: agentBinding.agentId, boundAt: new Date("2026-03-26T00:00:00.000Z") } : null,
		};
	}
}

function createOrcBaseState(): OrcMasterState {
	return {
		threadId: "thread-e2e-1",
		runCorrelationId: "run-e2e-1",
		next: "route",
		memoryRoute: { mode: "vector", namespace: "thread-e2e-1" },
		routing: {
			taskType: "code_write",
			requestedBy: "orchestrator",
			chainOfCustody: [],
		},
		retries: { attempt: 0, maxAttempts: 8 },
	};
}

describe("orchestration custody e2e", () => {
	it("covers Architect → Scout → Mechanic ↔ Inquisitor, optional Alchemist, Scribe completion, Archivist retrieval, and Curator signaling", async () => {
		const checkpointer = new InMemoryCheckpointer();
		const routeOrder = ["architect", "scout", "mechanic", "inquisitor", "alchemist", "scribe", "archivist", "vibe_curator"] as const;
		const graph = build_orc_graph({
			checkpointer,
			now: () => new Date("2026-03-26T14:00:00.000Z"),
			executors: {
				async route(state) {
					const role = routeOrder[state.retries.attempt] ?? "vibe_curator";
					return {
						targetGuildMember: role,
						reason: `${role} custody`,
						activeGuildMember: {
							memberId: `member-${role}`,
							role,
							sessionId: `session-${role}`,
							activatedAt: "2026-03-26T14:00:00.000Z",
						},
						contractPayload: {
							contractId: "StructuralBlueprint",
							taskId: `task-${role}`,
							handoffToken: `handoff-${role}`,
							payload: {
								objective: "Deliver orchestrated feature",
								scope: ["src/orchestration"],
								constraints: ["strict contracts"],
								deliverables: ["checked custody transition"],
							},
						},
						decision: "dispatch",
					};
				},
				async dispatch(state) {
					if (state.retries.attempt === 6) {
						return {
							notes: "archivist injection",
							archivistContext: {
								summary: "Historical snippet about prior custody fixes",
								charBudget: 240,
								truncated: false,
								snippets: [{
									id: "memo-1",
									summary: "Mechanic retries should be audited.",
									confidenceHint: "high",
									provenance: {
										backend: "vector",
										threadId: "thread-e2e-1",
										sourcePath: "memory/custody.md",
									},
								}],
							},
						};
					}
					return { notes: `dispatch-${state.retries.attempt}` };
				},
				async verify(state) {
					if (state.retries.attempt < routeOrder.length - 1) {
						return {
							decision: "route",
							notes: `advance-${state.retries.attempt}`,
							failureCode: `ADVANCE_${state.retries.attempt}`,
							failureDossier: {
								failureCode: "NEEDS_NEXT_CUSTODIAN",
								failureSummary: "Escalate to next custody member",
								actionsTaken: ["handoff"],
							},
						};
					}
					return { decision: "complete", notes: "custody completed" };
				},
				async complete() {
					return { summary: "custody chain finished" };
				},
			},
		});

		let state = createOrcBaseState();
		for (let i = 0; i < 64; i += 1) {
			state = await graph.step(state);
			if (state.next === "complete" && state.completionSummary) {
				break;
			}
		}

		assert.equal(state.next, "complete");
		assert.equal(state.completionSummary, "custody chain finished");
		assert.deepEqual(state.routing.chainOfCustody.map((entry) => entry.targetGuildMember), routeOrder);
		assert.equal(state.archivistContext?.snippets[0]?.provenance.sourcePath, "memory/custody.md");
		assert.equal(checkpointer.snapshots.length >= 16, true);

		const mechanicGraph = createMechanicSubgraph({
			executors: {
				async edit() {
					return { changedFiles: ["src/orchestration/orc-graph.ts"] };
				},
				async verify(mechanicState) {
					if (mechanicState.environmentStateUpdate) {
						return { success: true, diagnostics: [] };
					}
					return {
						success: false,
						diagnostics: [{ tool: "compile", severity: "error", code: "TS2307", message: "Cannot find module 'zod'." }],
					};
				},
				async routeToWardenForRemediation() {
					return {
						environmentStateUpdate: {
							updatedFiles: ["package.json", ".env.example"],
							installedDependencies: ["zod"],
							resolvedEnvironmentVariables: ["OPENAI_API_KEY"],
						},
					};
				},
			},
		});
		let mechanicState: MechanicSubgraphState = {
			threadId: "thread-mech-e2e",
			taskId: "task-mech-e2e",
			next: "edit",
			attemptCount: 0,
			maxAttempts: 3,
			changedFiles: [],
			verificationDiagnostics: [],
		};
		for (let i = 0; i < 8; i += 1) {
			if (mechanicState.next === "complete") break;
			mechanicState = await mechanicGraph.step(mechanicState);
		}
		assert.equal(mechanicState.next, "complete");
		assert.equal(mechanicState.environmentStateUpdate?.installedDependencies[0], "zod");

		const inquisitorGraph = createInquisitorSubgraph({
			executors: {
				async generateTests() {
					return { generatedArtifacts: ["test/orchestration-custody.e2e.test.ts"] };
				},
				async executeTests(_state, phase) {
					return { success: true, payload: { phase } };
				},
				async runPostRefactorOptimization() {
					return { complexityDelta: -1, styleDelta: -2, summary: "Optional alchemist optimization" };
				},
			},
		});
		let inquisitorState: InquisitorSubgraphState = {
			threadId: "thread-inq-e2e",
			taskId: "task-inq-e2e",
			next: "generate_tests",
			attemptCount: 0,
			generatedArtifacts: [],
			baselineValidationPassed: false,
		};
		for (let i = 0; i < 12; i += 1) {
			if (inquisitorState.next === "complete") break;
			inquisitorState = await inquisitorGraph.step(inquisitorState);
		}
		assert.equal(inquisitorState.next, "complete");
		assert.equal(inquisitorState.refactorDeltaRecord?.complexityDelta, -1);

		const planningStore = new MemoryPlanningStore();
		const agentGraph = createOrcAgentGraph({
			planningStore,
			executors: {
				async plan() {
					return {
						planSummary: "ship feature with docs",
						todos: [{ id: "t1", title: "implement", status: "pending" }],
					};
				},
				async delegate() {
					return { summary: "delegated" };
				},
				async evaluate() {
					return { notes: "ready", decision: "complete" as const };
				},
				async scribe() {
					return {
						success: true,
						updatedTargets: ["README.md", "docs/orchestration/phase-2-execution-plan.md"],
						diffSummaryArtifactPath: "artifacts/docs/custody-e2e.md",
					};
				},
			},
		});
		let agentState: OrcAgentState = {
			threadId: "thread-agent-e2e",
			runCorrelationId: "run-agent-e2e",
			goal: "complete",
			iteration: 0,
			maxIterations: 2,
			todos: [],
			next: "plan",
		};
		for (let i = 0; i < 8; i += 1) {
			agentState = await agentGraph.step(agentState);
			if (agentState.next === "complete" && agentState.scribeResult?.success) {
				agentState = await agentGraph.step(agentState);
				break;
			}
		}
		assert.equal(agentState.next, "complete");
		assert.equal(agentState.scribeResult?.success, true);

		const archivistGraph = createArchivistSubgraph({
			executors: {
				async retrieveSemanticMemory() {
					return {
						backend: "vector",
						query: "custody",
						retrievedAt: "2026-03-26T14:00:01.000Z",
						hits: [{
							id: "hist-1",
							snippet: "Prior run recovered from tool-policy violation.",
							confidenceHint: "high",
							provenance: { backend: "vector", threadId: "thread-e2e-1", sourcePath: "memory/custody.md" },
						}],
					};
				},
				async emitContextInjection() {
					return;
				},
			},
		});
		let archivistState: ArchivistSubgraphState = {
			threadId: "thread-arch-e2e",
			taskId: "task-arch-e2e",
			next: "retrieve_semantic_context",
			query: "custody",
			memoryRoute: { mode: "vector", namespace: "thread-e2e-1" },
			maxSources: 2,
			maxSummaryChars: 160,
		};
		for (let i = 0; i < 6; i += 1) {
			if (archivistState.next === "complete") break;
			archivistState = await archivistGraph.step(archivistState);
		}
		assert.equal(archivistState.next, "complete");
		assert.equal(archivistState.contextInjection?.snippets[0]?.provenance.sourcePath, "memory/custody.md");

		const curator = new RpcEventCurator({ now: () => 1_710_000_000_000, watchdogMs: 2_000 });
		curator.handleRpcEvent({ type: "agent_start", agentId: "orc", paneId: "left" });
		const fiery = curator.handleRpcEvent({
			type: "auto_retry_start",
			agentId: "orc",
			paneId: "left",
			attempt: 1,
			maxAttempts: 3,
		});
		const calm = curator.handleRpcEvent({
			type: "auto_retry_end",
			agentId: "orc",
			paneId: "left",
			success: true,
		});
		assert.equal(fiery.signal.element, "fire");
		assert.equal(calm.signal.element, "water");
	});

	it("blocks invalid contracts at route/dispatch/verify and prevents incomplete custody handoff", async () => {
		const checkpointer = new InMemoryCheckpointer();
		const graph = build_orc_graph({
			checkpointer,
			executors: {
				async route() {
					return {
						targetGuildMember: "mechanic",
						reason: "invalid contract",
						activeGuildMember: {
							memberId: "member-mechanic",
							role: "mechanic",
							sessionId: "session-mechanic",
							activatedAt: "2026-03-26T15:00:00.000Z",
						},
						contractPayload: {
							contractId: "ReconReport",
							taskId: "bad-contract",
							handoffToken: "bad-token",
							payload: {
								summary: "invalid target",
								findings: ["f1"],
								recommendations: ["r1"],
								coordinates: [{
									absoluteFilePath: "/workspace/Vibe_Agent/src/orchestration/orc-graph.ts",
									lineStart: 1,
									lineEnd: 2,
									semanticChangeTarget: "guard",
								}],
							},
						},
						decision: "dispatch",
					};
				},
				async dispatch() {
					return { notes: "not reached" };
				},
				async verify() {
					return {
						decision: "complete",
						notes: "not reached",
						failureDossier: { failureCode: "X", failureSummary: "X", actionsTaken: [] },
					};
				},
				async complete() {
					return { summary: "not reached" };
				},
			},
		});
		const routeState = await graph.step(createOrcBaseState());
		assert.equal(routeState.next, "contract_error");
		assert.match(routeState.failureSummary ?? "", /Routing to Mechanic is blocked unless StructuralBlueprint validation passes/);

		await assert.rejects(
			() =>
				graph.step({
					...createOrcBaseState(),
					next: "dispatch",
					activeGuildMember: undefined,
					contractPayload: undefined,
				}),
			/Dispatch blocked: missing active guild member\./,
		);
	});

	it("blocks tool-policy violations for isolated subagents", async () => {
		const router = new OrcSubagentRouter({
			rpcLauncher: new FakeRpcLauncher(),
			paneOrchestrator: new FakePaneOrchestrator(),
			routerNow: () => new Date("2026-03-26T16:00:00.000Z"),
		});
		await router.routeTask({ taskId: "task-policy", taskType: "repo_index" });

		const violatingToolCall: RpcTelemetryEnvelope = {
			schema: "pi.rpc.telemetry.v1",
			eventId: "evt-violation",
			emittedAt: "2026-03-26T16:00:01.000Z",
			source: {
				agentRole: "scout",
				agentId: "scout-main",
				instanceId: "scout-instance",
				launchAttempt: 0,
			},
			telemetry: {
				kind: "tool_call",
				severity: "warning",
				payload: {
					toolName: "npm install",
				},
			},
		};

		assert.throws(
			() => router.bindTelemetry(violatingToolCall),
			/error:|Policy violation by scout/i,
		);
	});
});
