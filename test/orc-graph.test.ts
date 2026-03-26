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
			contractId: "contract-42",
			taskId: "task-42",
			payload: { files: ["src/orchestration/orc-graph.ts"] },
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
		assert.equal(state.contractPayload?.contractId, "contract-42");
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
						contractId: "contract-retry",
						taskId: "task-retry",
						payload: {},
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
				contractPayload: { contractId: "c1", taskId: "t1", payload: {}, handoffToken: "h1" },
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
