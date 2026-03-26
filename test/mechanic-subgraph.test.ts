import assert from "node:assert";
import { describe, it } from "node:test";
import {
	classifyMechanicVerifyFailure,
	createMechanicSubgraph,
	type MechanicEscalationPayload,
	type MechanicEnvironmentStateUpdate,
	type MechanicSubgraphState,
	type MechanicVerificationDiagnostic,
} from "../src/orchestration/graph/subagents/mechanic-subgraph.js";

function createBaseState(overrides: Partial<MechanicSubgraphState> = {}): MechanicSubgraphState {
	return {
		threadId: "thread-mechanic-1",
		taskId: "task-mechanic-1",
		next: "edit",
		attemptCount: 0,
		maxAttempts: 3,
		changedFiles: [],
		verificationDiagnostics: [],
		...overrides,
	};
}

describe("createMechanicSubgraph", () => {
	it("loops edit -> verify and terminates deterministically on success", async () => {
		const visited: string[] = [];
		const graph = createMechanicSubgraph({
			now: () => new Date("2026-03-26T06:00:00.000Z"),
			executors: {
				async edit() {
					visited.push("edit");
					return { changedFiles: ["src/orchestration/orc-graph.ts"] };
				},
				async verify() {
					visited.push("verify");
					return { success: true, diagnostics: [] };
				},
			},
		});

		let state = createBaseState();
		state = await graph.step(state);
		state = await graph.step(state);

		assert.equal(state.next, "complete");
		assert.equal(state.attemptCount, 1);
		assert.deepEqual(state.changedFiles, ["src/orchestration/orc-graph.ts"]);
		assert.deepEqual(visited, ["edit", "verify"]);
		assert.match(state.completionSummary ?? "", /verification passed/i);
	});

	it("enforces retry ceiling of 3 attempts and escalates unresolved failures to Orc", async () => {
		const escalations: MechanicEscalationPayload[] = [];
		const diagnostics: MechanicVerificationDiagnostic[] = [
			{ tool: "lint", severity: "error", code: "ESLINT", message: "Unexpected any.", file: "src/main.ts", line: 8, column: 12 },
			{ tool: "compile", severity: "error", code: "TS2322", message: "Type mismatch.", file: "src/main.ts", line: 19, column: 3 },
		];
		const graph = createMechanicSubgraph({
			now: () => new Date("2026-03-26T07:00:00.000Z"),
			executors: {
				async edit(state) {
					return { changedFiles: ["src/main.ts", `src/attempt-${state.attemptCount}.ts`] };
				},
				async verify() {
					return { success: false, diagnostics };
				},
				async escalateToOrc(_state, payload) {
					escalations.push(payload);
				},
			},
		});

		let state = createBaseState();
		for (let i = 0; i < 8; i += 1) {
			if (state.next === "complete") break;
			state = await graph.step(state);
		}

		assert.equal(state.next, "complete");
		assert.equal(state.attemptCount, 3);
		assert.equal(state.escalation?.reason, "retry_ceiling_reached");
		assert.equal(state.escalation?.escalatedTo, "orc");
		assert.equal(state.escalation?.maxAttempts, 3);
		assert.equal(state.escalation?.attemptCount, 3);
		assert.equal(escalations.length, 1);
		assert.equal(state.escalation?.diagnostics.length, 2);
		assert.equal(state.lastError, "lint:ESLINT: Unexpected any.");
		assert.ok((state.escalation?.changedFiles.length ?? 0) >= 3);
	});

	it("caps configured retries above 3 to the hard ceiling", async () => {
		const graph = createMechanicSubgraph({
			executors: {
				async edit() {
					return { changedFiles: [] };
				},
				async verify() {
					return { success: false, diagnostics: [{ tool: "compile", severity: "error", message: "Fail" }] };
				},
			},
		});

		let state = createBaseState({ maxAttempts: 99 });
		for (let i = 0; i < 8; i += 1) {
			if (state.next === "complete") break;
			state = await graph.step(state);
		}

		assert.equal(state.escalation?.maxAttempts, 3);
		assert.equal(state.attemptCount, 3);
	});

	it("routes environment/dependency verify failures to Warden and resumes verify path", async () => {
		const visited: string[] = [];
		const wardenUpdates: MechanicEnvironmentStateUpdate[] = [];
		const graph = createMechanicSubgraph({
			executors: {
				async edit() {
					visited.push("edit");
					return { changedFiles: ["src/app.ts"] };
				},
				async verify(state) {
					visited.push("verify");
					if (state.environmentStateUpdate) {
						return { success: true, diagnostics: [] };
					}
					return {
						success: false,
						diagnostics: [{ tool: "compile", severity: "error", code: "TS2307", message: "Cannot find module 'zod'." }],
					};
				},
				async routeToWardenForRemediation() {
					visited.push("warden");
					const environmentStateUpdate: MechanicEnvironmentStateUpdate = {
						updatedFiles: ["package.json", "package-lock.json", ".env.example"],
						installedDependencies: ["zod"],
						resolvedEnvironmentVariables: ["OPENAI_API_KEY"],
						notes: "Installed missing package and documented required env vars.",
					};
					wardenUpdates.push(environmentStateUpdate);
					return { environmentStateUpdate };
				},
			},
		});

		let state = createBaseState();
		for (let i = 0; i < 6; i += 1) {
			if (state.next === "complete") break;
			state = await graph.step(state);
		}

		assert.equal(state.next, "complete");
		assert.equal(state.attemptCount, 1);
		assert.deepEqual(visited, ["edit", "verify", "warden", "verify"]);
		assert.equal(state.verifyFailureClass, undefined);
		assert.equal(wardenUpdates.length, 1);
		assert.equal(state.environmentStateUpdate?.installedDependencies[0], "zod");
		assert.ok((state.changedFiles ?? []).includes("package.json"));
	});

	it("does not misroute non-environment failures to Warden", async () => {
		let wardenCalls = 0;
		const graph = createMechanicSubgraph({
			executors: {
				async edit() {
					return { changedFiles: [] };
				},
				async verify() {
					return { success: false, diagnostics: [{ tool: "compile", severity: "error", code: "TS2322", message: "Type 'string' is not assignable to type 'number'." }] };
				},
				async routeToWardenForRemediation() {
					wardenCalls += 1;
					return { environmentStateUpdate: { updatedFiles: [], installedDependencies: [], resolvedEnvironmentVariables: [] } };
				},
			},
		});

		let state = createBaseState();
		state = await graph.step(state);
		state = await graph.step(state);

		assert.equal(state.next, "edit");
		assert.equal(state.verifyFailureClass, "code");
		assert.equal(wardenCalls, 0);
	});

	it("classifies module/import/env errors as environment failures", () => {
		assert.equal(
			classifyMechanicVerifyFailure([{ tool: "compile", severity: "error", message: "Cannot find module '@scope/pkg'." }]),
			"environment",
		);
		assert.equal(
			classifyMechanicVerifyFailure([{ tool: "compile", severity: "error", message: "Missing environment variable: OPENAI_API_KEY" }]),
			"environment",
		);
		assert.equal(
			classifyMechanicVerifyFailure([{ tool: "compile", severity: "error", code: "TS2322", message: "Type mismatch." }]),
			"code",
		);
	});
});
