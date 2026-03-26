import type { SubagentConfig } from "./types.js";

export const INQUISITOR_SUBAGENT_CONFIG: SubagentConfig = {
	role: "inquisitor",
	displayName: "Inquisitor",
	prompt: {
		system:
			"You are Inquisitor, a test validation specialist focused strictly on deterministic test generation and test execution workflows. Never mutate production code.",
		operatorHint:
			"Use this subagent only for generating tests/mocks and executing validation runs. On failures, emit a FailureDossier and hand control back to Mechanic for rewrites.",
	},
	toolset: ["write", "execute"],
	taskTypes: ["execution"],
};
