import assert from "node:assert";
import { describe, it } from "node:test";
import {
	build_orc_graph,
	type OrcContractPayloadHandoff,
	type OrcGraphCheckpointer,
	type OrcMasterState,
} from "../src/orchestration/orc-graph.js";

class RecordingCheckpointer implements OrcGraphCheckpointer {
	readonly snapshots: OrcMasterState[] = [];

	async save(state: Readonly<OrcMasterState>): Promise<void> {
		this.snapshots.push(structuredClone(state));
	}
}

function createBaseState(overrides: Partial<OrcMasterState> = {}): OrcMasterState {
	return {
		threadId: "thread-1",
		runCorrelationId: "run-1",
		next: "route",
		memoryRoute: {
			mode: "filesystem",
		},
		routing: {
			taskType: "code_write",
			requestedBy: "orchestrator",
			chainOfCustody: [],
		},
		retries: {
			attempt: 0,
			maxAttempts: 2,
		},
		...overrides,
	};
}

describe("build_orc_graph", () => {
	it("builds deterministic routing and contract payload handoff with injected checkpointer", async () => {
		const checkpointer = new RecordingCheckpointer();
		const hookEvents: string[] = [];
		const payload: OrcContractPayloadHandoff = {
			contractId: "StructuralBlueprint",
			taskId: "task-42",
			payload: {
			objective: "Ship orchestration route",
			scope: ["src/orchestration/orc-graph.ts"],
			constraints: ["strict contracts"],
			deliverables: ["validated handoff"],
		},
			handoffToken: "token-42",
		};
		const graph = build_orc_graph({
			checkpointer,
			now: () => new Date("2026-03-26T02:00:00.000Z"),
			storeHooks: {
				onRoute: async () => {
					hookEvents.push("route");
				},
				onDispatch: async () => {
					hookEvents.push("dispatch");
				},
				onVerify: async () => {
					hookEvents.push("verify");
				},
				onComplete: async () => {
					hookEvents.push("complete");
				},
			},
			executors: {
				route: async () => ({
					targetGuildMember: "alchemist",
					reason: "write-heavy task",
					activeGuildMember: {
						memberId: "guild-alchemist-1",
						role: "alchemist",
						sessionId: "sess-1",
						activatedAt: "2026-03-26T02:00:00.000Z",
					},
					contractPayload: payload,
					decision: "dispatch",
				}),
				dispatch: async () => ({ notes: "dispatched" }),
				verify: async () => ({ decision: "complete", notes: "verified" }),
				complete: async () => ({ summary: "done" }),
			},
		});

		let state = createBaseState();
		state = await graph.step(state);
		state = await graph.step(state);
		state = await graph.step(state);
		state = await graph.step(state);

		assert.equal(state.next, "complete");
		assert.equal(state.routing.targetGuildMember, "alchemist");
		assert.equal(state.routing.chainOfCustody.length, 1);
		assert.equal(state.routing.chainOfCustody[0]?.reason, "write-heavy task");
		assert.equal(state.contractPayload?.contractId, "StructuralBlueprint");
		assert.equal(state.activeGuildMember?.memberId, "guild-alchemist-1");
		assert.deepEqual(hookEvents, ["route", "dispatch", "verify", "complete"]);
		assert.equal(checkpointer.snapshots.length, 4);
		assert.deepEqual(graph.middlewareOrder, ["subagent_dispatch_guard"]);
	});

	it("retries by routing again and records retry metadata", async () => {
		const checkpointer = new RecordingCheckpointer();
		const graph = build_orc_graph({
			checkpointer,
			now: () => new Date("2026-03-26T03:00:00.000Z"),
			executors: {
				route: async (state) => ({
					targetGuildMember: "inquisitor",
					reason: `attempt-${state.retries.attempt}`,
					activeGuildMember: {
						memberId: "guild-inquisitor-1",
						role: "inquisitor",
						sessionId: "sess-2",
						activatedAt: "2026-03-26T03:00:00.000Z",
					},
					contractPayload: {
						contractId: "StructuralBlueprint",
						taskId: "task-retry",
						payload: {
							objective: "Retry contract",
							scope: ["route"],
							constraints: ["max-2"],
							deliverables: ["handoff"],
						},
						handoffToken: "token-retry",
					},
					decision: "dispatch",
				}),
				dispatch: async () => ({ notes: "attempt dispatched" }),
				verify: async (state) => {
					if (state.retries.attempt === 0) {
						return { decision: "route", notes: "retry me", failureCode: "E_RETRY" };
					}
					return { decision: "complete", notes: "stable" };
				},
				complete: async () => ({ summary: "done" }),
			},
		});

		let state = createBaseState();
		state = await graph.step(state); // route
		state = await graph.step(state); // dispatch
		state = await graph.step(state); // verify->route
		state = await graph.step(state); // route retry

		assert.equal(state.next, "dispatch");
		assert.equal(state.retries.attempt, 1);
		assert.equal(state.retries.lastFailureCode, "E_RETRY");
		assert.equal(state.routing.chainOfCustody.length, 2);
	});

	it("injects archivist context with bounded summary/snippet limits", async () => {
		const checkpointer = new RecordingCheckpointer();
		const graph = build_orc_graph({
			checkpointer,
			now: () => new Date("2026-03-26T04:00:00.000Z"),
			executors: {
				route: async () => ({
					targetGuildMember: "archivist",
					reason: "semantic retrieval",
					activeGuildMember: {
						memberId: "guild-archivist-1",
						role: "archivist",
						sessionId: "sess-archivist",
						activatedAt: "2026-03-26T04:00:00.000Z",
					},
					contractPayload: {
						contractId: "StructuralBlueprint",
						taskId: "task-memory",
						payload: {
							objective: "Retrieve context",
							scope: ["history"],
							constraints: ["bounded"],
							deliverables: ["summary"],
						},
						handoffToken: "token-memory",
					},
					decision: "dispatch",
				}),
				dispatch: async () => ({
					notes: "injected context",
					archivistContext: {
						summary: "x".repeat(2000),
						charBudget: 2000,
						truncated: false,
						snippets: Array.from({ length: 9 }, (_, index) => ({
							id: `s${index}`,
							summary: `snippet-${index}`,
							confidenceHint: "medium" as const,
							provenance: {
								backend: "vector" as const,
								threadId: "thread-1",
								sourcePath: `memory/doc-${index}.md`,
							},
						})),
					},
				}),
				verify: async () => ({ decision: "complete", notes: "verified" }),
				complete: async () => ({ summary: "done" }),
			},
		});

		let state = createBaseState({ memoryRoute: { mode: "vector", namespace: "orc-thread-1" } });
		state = await graph.step(state);
		state = await graph.step(state);
		assert.equal(state.archivistContext?.charBudget, 1600);
		assert.equal(state.archivistContext?.snippets.length, 6);
		assert.equal(state.archivistContext?.truncated, true);
	});
});


it("blocks dispatch when subagent handoff is incomplete", async () => {
	const checkpointer = new RecordingCheckpointer();
	const graph = build_orc_graph({
		checkpointer,
		executors: {
			route: async () => ({
				targetGuildMember: "inquisitor",
				reason: "missing member",
				activeGuildMember: { memberId: "m1", role: "inquisitor", sessionId: "s1", activatedAt: "2026-03-26T00:00:00.000Z" },
				contractPayload: { contractId: "StructuralBlueprint", taskId: "t1", payload: {
							objective: "Retry contract",
							scope: ["route"],
							constraints: ["max-2"],
							deliverables: ["handoff"],
						}, handoffToken: "h1" },
				decision: "dispatch",
			}),
			dispatch: async () => ({ notes: "should not run" }),
			verify: async () => ({ decision: "complete", notes: "n/a" }),
			complete: async () => ({ summary: "done" }),
		},
	});

	await assert.rejects(
		() =>
			graph.step(createBaseState({
				next: "dispatch",
				contractPayload: undefined,
				activeGuildMember: undefined,
			})),
		/Dispatch blocked: missing active guild member\./,
	);
	assert.equal(checkpointer.snapshots.length, 0);
});

it("blocks architect routing when contract is not StructuralBlueprint", async () => {
	const checkpointer = new RecordingCheckpointer();
	const graph = build_orc_graph({
		checkpointer,
		executors: {
			route: async () => ({
				targetGuildMember: "architect",
				reason: "planning handoff",
				activeGuildMember: { memberId: "a1", role: "architect", sessionId: "s-a1", activatedAt: "2026-03-26T00:00:00.000Z" },
				contractPayload: {
					contractId: "ReconReport",
					taskId: "task-a1",
					handoffToken: "tok-a1",
					payload: { summary: "x", findings: ["f1"], recommendations: ["r1"], coordinates: [{ absoluteFilePath: "/workspace/Vibe_Agent/src/orchestration/orc-graph.ts", lineStart: 1, lineEnd: 12, semanticChangeTarget: "routing guard" }] },
				},
				decision: "dispatch" as const,
			}),
			dispatch: async () => ({ notes: "should not run" }),
			verify: async () => ({ decision: "complete", notes: "n/a" }),
			complete: async () => ({ summary: "done" }),
		},
	});
	const state = await graph.step(createBaseState());
	assert.equal(state.next, "contract_error");
	assert.equal(state.contractValidationFailure?.contractId, "ReconReport");
	assert.match(state.failureSummary ?? "", /Architect must emit StructuralBlueprint/);
});

it("blocks routing to mechanic when contract is not StructuralBlueprint", async () => {
	const checkpointer = new RecordingCheckpointer();
	const graph = build_orc_graph({
		checkpointer,
		executors: {
			route: async () => ({
				targetGuildMember: "mechanic",
				reason: "execution handoff",
				activeGuildMember: { memberId: "m1", role: "mechanic", sessionId: "s-m1", activatedAt: "2026-03-26T00:00:00.000Z" },
				contractPayload: {
					contractId: "ReconReport",
					taskId: "task-m1",
					handoffToken: "tok-m1",
					payload: { summary: "x", findings: ["f1"], recommendations: ["r1"], coordinates: [{ absoluteFilePath: "/workspace/Vibe_Agent/src/orchestration/orc-graph.ts", lineStart: 1, lineEnd: 12, semanticChangeTarget: "routing guard" }] },
				},
				decision: "dispatch" as const,
			}),
			dispatch: async () => ({ notes: "should not run" }),
			verify: async () => ({ decision: "complete", notes: "n/a" }),
			complete: async () => ({ summary: "done" }),
		},
	});
	const state = await graph.step(createBaseState());
	assert.equal(state.next, "contract_error");
	assert.equal(state.contractValidationFailure?.contractId, "ReconReport");
	assert.match(state.failureSummary ?? "", /Routing to Mechanic is blocked unless StructuralBlueprint validation passes/);
});
