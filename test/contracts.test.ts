import assert from "node:assert";
import { test } from "node:test";
import { validateOrcContractPayload } from "../src/orchestration/contracts.js";

test("ReconReport accepts deterministic absolute coordinates", () => {
	const result = validateOrcContractPayload("ReconReport", {
		summary: "Scout mapped targets",
		findings: ["Dispatcher validates contract payloads before verify."],
		recommendations: ["Route all recon tasks through Scout."],
		coordinates: [
			{
				absoluteFilePath: "/workspace/Vibe_Agent/src/orchestration/orc-graph.ts",
				lineStart: 296,
				lineEnd: 321,
				semanticChangeTarget: "ReconReport validation gate in dispatch/verify nodes",
			},
		],
	});
	assert.equal(result.ok, true);
});

test("ReconReport rejects non-deterministic coordinate ordering", () => {
	const result = validateOrcContractPayload("ReconReport", {
		summary: "Scout mapped targets",
		findings: ["Found write path."],
		recommendations: ["Keep read-only."],
		coordinates: [
			{
				absoluteFilePath: "/workspace/Vibe_Agent/src/zeta.ts",
				lineStart: 5,
				lineEnd: 8,
				semanticChangeTarget: "later",
			},
			{
				absoluteFilePath: "/workspace/Vibe_Agent/src/alpha.ts",
				lineStart: 1,
				lineEnd: 2,
				semanticChangeTarget: "earlier",
			},
		],
	});
	assert.equal(result.ok, false);
	assert.equal(result.issues.some((issue) => issue.path.includes("payload.coordinates")), true);
});
