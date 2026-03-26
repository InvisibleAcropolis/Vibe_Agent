import assert from "node:assert";
import { describe, it } from "node:test";
import { createOrcAgentGraph, type OrcAgentState, type OrcPlanningStateSnapshot, type OrcPlanningStateStore } from "../src/orchestration/graph/orc_agent.js";

class MemoryPlanningStore implements OrcPlanningStateStore {
	latest?: OrcPlanningStateSnapshot;

	async loadLatest(): Promise<OrcPlanningStateSnapshot | undefined> {
		return this.latest;
	}

	async save(snapshot: OrcPlanningStateSnapshot): Promise<void> {
		this.latest = snapshot;
	}
}

function createBaseState(overrides: Partial<OrcAgentState> = {}): OrcAgentState {
	return {
		threadId: "thread-orc-1",
		runCorrelationId: "run-orc-1",
		goal: "Ship feature",
		iteration: 0,
		maxIterations: 3,
		todos: [],
		next: "plan",
		...overrides,
	};
}

describe("createOrcAgentGraph", () => {
	it("runs scribe before complete and carries diff summary artifact metadata", async () => {
		const planningStore = new MemoryPlanningStore();
		const graph = createOrcAgentGraph({
			planningStore,
			executors: {
				async plan() {
					return {
						planSummary: "Implement orchestration doc sync",
						todos: [{ id: "t1", title: "implement", status: "pending" }],
					};
				},
				async delegate() {
					return { summary: "Delegated implementation" };
				},
				async evaluate() {
					return { notes: "Feature is implemented", decision: "complete" as const };
				},
				async scribe() {
					return {
						success: true,
						updatedTargets: ["README.md", "docs/orchestration/phase-2-execution-plan.md"],
						diffSummaryArtifactPath: "artifacts/docs/feat-doc-sync.md",
					};
				},
				async complete(state) {
					return `done with docs: ${state.scribeResult?.diffSummaryArtifactPath}`;
				},
			},
		});

		let state = createBaseState();
		for (let i = 0; i < 8; i += 1) {
			if (state.next === "complete" && state.scribeResult?.success) {
				state = await graph.step(state);
				break;
			}
			state = await graph.step(state);
		}

		assert.equal(state.next, "complete");
		assert.equal(state.scribeResult?.success, true);
		assert.equal(state.scribeResult?.diffSummaryArtifactPath, "artifacts/docs/feat-doc-sync.md");
		assert.match(state.completionSummary ?? "", /done with docs/i);
	});

	it("blocks final completion when scribe success signal is missing", async () => {
		const planningStore = new MemoryPlanningStore();
		const graph = createOrcAgentGraph({
			planningStore,
			executors: {
				async plan() {
					return { planSummary: "p", todos: [{ id: "t1", title: "x", status: "pending" }] };
				},
				async delegate() {
					return { summary: "d" };
				},
				async evaluate() {
					return { notes: "n", decision: "continue" as const };
				},
				async scribe() {
					return { success: false, updatedTargets: [], diffSummaryArtifactPath: "" };
				},
			},
		});

		await assert.rejects(
			() => graph.step(createBaseState({ next: "complete", scribeResult: undefined })),
			/Orc completion blocked: Scribe success signal is required before emitting done/i,
		);
	});
});
