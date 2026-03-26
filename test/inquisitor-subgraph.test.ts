import assert from "node:assert";
import { describe, it } from "node:test";
import {
	createInquisitorSubgraph,
	type FailureDossier,
	type InquisitorSubgraphState,
} from "../src/orchestration/graph/subagents/inquisitor-subgraph.js";

function createBaseState(overrides: Partial<InquisitorSubgraphState> = {}): InquisitorSubgraphState {
	return {
		threadId: "thread-inquisitor-1",
		taskId: "task-inquisitor-1",
		next: "generate_tests",
		attemptCount: 0,
		generatedArtifacts: [],
		baselineValidationPassed: false,
		...overrides,
	};
}

describe("createInquisitorSubgraph", () => {
	it("routes failing tests into a valid FailureDossier and hands off to Mechanic", async () => {
		const routedDossiers: FailureDossier[] = [];
		const graph = createInquisitorSubgraph({
			now: () => new Date("2026-03-26T09:00:00.000Z"),
			executors: {
				async generateTests() {
					return { generatedArtifacts: ["test/orchestration/inquisitor.spec.ts"], testCommand: "pnpm test inquisitor" };
				},
				async executeTests() {
					return {
						success: false,
						failureCategory: "runtime_error",
						stackTrace: "Error: expected true to equal false\n at test/inquisitor.spec.ts:12:7",
						payload: { test: "inquisitor.spec.ts", retries: 0 },
					};
				},
				async routeFailureToMechanic(_state, dossier) {
					routedDossiers.push(dossier);
				},
			},
		});

		let state = createBaseState();
		state = await graph.step(state);
		state = await graph.step(state);
		state = await graph.step(state);

		assert.equal(state.next, "generate_tests");
		assert.equal(state.attemptCount, 1);
		assert.equal(state.failureDossier?.failureCategory, "runtime_error");
		assert.match(state.failureDossier?.stackTrace ?? "", /expected true to equal false/i);
		assert.deepEqual(state.failureDossier?.payload, { test: "inquisitor.spec.ts", retries: 0 });
		assert.equal(routedDossiers.length, 1);
		assert.equal(routedDossiers[0]?.failedAt, "2026-03-26T09:00:00.000Z");
	});

	it("fills missing failure fields so every failing state has a valid dossier", async () => {
		const graph = createInquisitorSubgraph({
			now: () => new Date("2026-03-26T10:00:00.000Z"),
			executors: {
				async generateTests() {
					return { generatedArtifacts: ["tests/inquisitor.test.ts"] };
				},
				async executeTests() {
					return { success: false };
				},
			},
		});

		let state = createBaseState();
		state = await graph.step(state);
		state = await graph.step(state);

		assert.equal(state.next, "route_failure");
		assert.equal(state.failureDossier?.failureCategory, "unknown");
		assert.equal(state.failureDossier?.stackTrace, "No stack trace captured.");
		assert.deepEqual(state.failureDossier?.payload, { rawPayload: null });
	});

	it("runs optional post-inquisitor optimization only after baseline pass, then revalidates", async () => {
		let validationEvents = 0;
		let optimizationRuns = 0;
		const graph = createInquisitorSubgraph({
			now: () => new Date("2026-03-26T11:00:00.000Z"),
			executors: {
				async generateTests(state) {
					return { generatedArtifacts: ["test/inquisitor/pass.test.ts"], testCommand: `pnpm test -- attempt=${state.attemptCount}` };
				},
				async executeTests(_state, phase) {
					if (phase === "baseline") {
						return { success: true };
					}
					return { success: true };
				},
				async runPostRefactorOptimization() {
					optimizationRuns += 1;
					return {
						complexityDelta: -3,
						styleDelta: -5,
						summary: "Extracted helper methods and normalized naming.",
						artifacts: ["src/orchestration/graph/subagents/inquisitor-subgraph.ts"],
					};
				},
				async emitValidationSuccessToOrc() {
					validationEvents += 1;
				},
			},
		});

		let state = createBaseState();
		for (let i = 0; i < 10; i += 1) {
			if (state.next === "complete") break;
			state = await graph.step(state);
		}

		assert.equal(state.next, "complete");
		assert.equal(state.attemptCount, 1);
		assert.equal(state.baselineValidationPassed, true);
		assert.equal(optimizationRuns, 1);
		assert.equal(validationEvents, 1);
		assert.equal(state.refactorDeltaRecord?.complexityDelta, -3);
		assert.equal(state.refactorDeltaRecord?.styleDelta, -5);
		assert.match(state.completionSummary ?? "", /post-refactor revalidation succeeded/i);
	});

	it("rejects production-file mutations during test generation", async () => {
		const graph = createInquisitorSubgraph({
			executors: {
				async generateTests() {
					return { generatedArtifacts: ["src/orchestration/orc-graph.ts"] };
				},
				async executeTests() {
					return { success: true };
				},
			},
		});

		await assert.rejects(
			() => graph.step(createBaseState()),
			(error: unknown) => error instanceof Error && /cannot mutate production code directly/i.test(error.message),
		);
	});
});
