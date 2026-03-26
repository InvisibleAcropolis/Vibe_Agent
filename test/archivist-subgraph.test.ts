import assert from "node:assert";
import { describe, it } from "node:test";
import {
	createArchivistSubgraph,
	type ArchivistSubgraphState,
} from "../src/orchestration/graph/subagents/archivist-subgraph.js";
import {
	createFilesystemMemoryRetrievalBackend,
	createVectorMemoryRetrievalBackend,
	retrieveOrcMemory,
} from "../src/orchestration/memory/index.js";

function createBaseState(overrides: Partial<ArchivistSubgraphState> = {}): ArchivistSubgraphState {
	return {
		threadId: "thread-archivist",
		taskId: "task-archivist",
		next: "retrieve_semantic_context",
		query: "routing",
		memoryRoute: { mode: "filesystem" },
		maxSources: 2,
		maxSummaryChars: 200,
		...overrides,
	};
}

describe("createArchivistSubgraph", () => {
	it("retrieves semantic context, compresses it, and emits bounded context injection with provenance", async () => {
		const injections: string[] = [];
		const graph = createArchivistSubgraph({
			executors: {
				async retrieveSemanticMemory() {
					return {
						backend: "filesystem",
						query: "routing",
						retrievedAt: "2026-03-26T05:00:00.000Z",
						hits: [
							{
								id: "h1",
								snippet: "Routing guard blocks invalid handoffs.",
								confidenceHint: "high",
								provenance: { backend: "filesystem", threadId: "thread-archivist", agentId: "scout", paneId: "pane-1" },
							},
							{
								id: "h2",
								snippet: "Dispatch retries were recorded in chain-of-custody.",
								confidenceHint: "medium",
								provenance: { backend: "filesystem", threadId: "thread-archivist", agentId: "archivist", paneId: "pane-2" },
							},
							{
								id: "h3",
								snippet: "Additional context that should be truncated by maxSources.",
								confidenceHint: "low",
								provenance: { backend: "filesystem", threadId: "thread-archivist", agentId: "scout", paneId: "pane-3" },
							},
						],
					};
				},
				async emitContextInjection(_state, injection) {
					injections.push(injection.summary);
				},
			},
		});

		let state = createBaseState();
		state = await graph.step(state);
		state = await graph.step(state);
		state = await graph.step(state);

		assert.equal(state.next, "complete");
		assert.equal(state.contextInjection?.snippets.length, 2);
		assert.equal(state.contextInjection?.truncated, true);
		assert.equal(state.contextInjection?.snippets[0]?.provenance.backend, "filesystem");
		assert.equal(injections.length, 1);
		assert.match(state.contextInjection?.summary ?? "", /confidence=high/);
	});
});

describe("memory retrieval api", () => {
	it("routes retrieval calls to explicit filesystem and vector backends", async () => {
		const filesystem = createFilesystemMemoryRetrievalBackend({
			async listBundles(threadId) {
				assert.equal(threadId, "thread-routes");
				return [
					{
						coordinates: { threadId, agentId: "archivist", paneId: "pane-9" },
						bundle: {
							subagentFindings: {
								schemaVersion: 1,
								kind: "subagent_findings",
								threadId,
								agentId: "archivist",
								paneId: "pane-9",
								updatedAt: "2026-03-26T06:00:00.000Z",
								findings: [{ id: "f1", summary: "routing handoff memo", evidence: ["e1"], confidence: "high" }],
							},
						},
					},
				];
			},
		});
		const vector = createVectorMemoryRetrievalBackend({
			async search(input) {
				assert.equal(input.namespace, "thread-routes");
				return [{ id: "v1", snippet: "Vectorized routing transcript", score: 0.9, sourcePath: "memory/vector/routing.md" }];
			},
		});

		const fsResult = await retrieveOrcMemory(
			{ route: { mode: "filesystem" }, threadId: "thread-routes", query: "routing", maxHits: 3 },
			[filesystem, vector],
		);
		const vectorResult = await retrieveOrcMemory(
			{ route: { mode: "vector", namespace: "thread-routes" }, threadId: "thread-routes", query: "routing", maxHits: 3 },
			[filesystem, vector],
		);

		assert.equal(fsResult.backend, "filesystem");
		assert.equal(fsResult.hits[0]?.provenance.backend, "filesystem");
		assert.equal(fsResult.hits[0]?.confidenceHint, "high");
		assert.equal(vectorResult.backend, "vector");
		assert.equal(vectorResult.hits[0]?.provenance.sourcePath, "memory/vector/routing.md");
		assert.equal(vectorResult.hits[0]?.confidenceHint, "high");
	});
});
