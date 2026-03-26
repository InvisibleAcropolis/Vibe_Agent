import assert from "node:assert";
import { describe, it } from "node:test";
import { createScribeSubgraph, type ScribeSubgraphState } from "../src/orchestration/graph/subagents/scribe-subgraph.js";

function createBaseState(overrides: Partial<ScribeSubgraphState> = {}): ScribeSubgraphState {
	return {
		threadId: "thread-scribe-1",
		taskId: "task-scribe-1",
		next: "hydrate_context",
		updatedDocTargets: [],
		successSignal: false,
		...overrides,
	};
}

describe("createScribeSubgraph", () => {
	it("requires API/readme/architecture docs and emits diff summary artifact", async () => {
		const graph = createScribeSubgraph({
			now: () => new Date("2026-03-26T12:00:00.000Z"),
			executors: {
				async hydrateContext() {
					return {
						implementationContext: {
							featureId: "feat-doc-sync",
							summary: "Add Scribe completion gate",
							publicInterfaces: ["createOrcAgentGraph", "createScribeSubgraph"],
							implementationCoordinates: ["src/orchestration/graph/orc_agent.ts"],
							readmeSections: ["Phase 2 orchestration architecture"],
							architectureNotes: ["phase-2-execution-plan"],
						},
					};
				},
				async updateDocs() {
					return {
						updatedDocTargets: [
							"README.md",
							"docs/orchestration/phase-2-execution-plan.md",
							"src/orchestration/graph/orc_agent.ts",
						],
					};
				},
				async emitDiffSummaryArtifact(_state, _context, updatedDocTargets) {
					return {
						artifact: {
							artifactId: "doc-diff-1",
							path: "artifacts/docs/doc-diff-1.md",
							summary: `Updated ${updatedDocTargets.length} doc targets`,
							changedDocPaths: [...updatedDocTargets],
							createdAt: "2026-03-26T12:00:00.000Z",
						},
					};
				},
			},
		});

		let state = createBaseState();
		state = await graph.step(state);
		state = await graph.step(state);
		state = await graph.step(state);

		assert.equal(state.next, "complete");
		assert.equal(state.successSignal, true);
		assert.equal(state.updatedDocTargets.length, 3);
		assert.equal(state.diffSummaryArtifact?.artifactId, "doc-diff-1");
		assert.match(state.completionSummary ?? "", /diff artifact/i);
	});

	it("blocks completion when readme/architecture requirements are not documented", async () => {
		const graph = createScribeSubgraph({
			executors: {
				async hydrateContext() {
					return {
						implementationContext: {
							featureId: "feat-doc-guard",
							summary: "guard",
							publicInterfaces: ["createScribeSubgraph"],
							implementationCoordinates: ["src/orchestration/graph/subagents/scribe-subgraph.ts"],
							readmeSections: ["Changelog"],
							architectureNotes: ["phase-2"],
						},
					};
				},
				async updateDocs() {
					return { updatedDocTargets: ["src/orchestration/graph/subagents/scribe-subgraph.ts"] };
				},
				async emitDiffSummaryArtifact() {
					throw new Error("should not run");
				},
			},
		});

		let state = createBaseState();
		state = await graph.step(state);
		await assert.rejects(() => graph.step(state), /README updates are required/i);
	});
});
