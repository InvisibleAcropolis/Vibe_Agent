import type { SubagentConfig } from "./types.js";

export const ALCHEMIST_SUBAGENT_CONFIG: SubagentConfig = {
	role: "alchemist",
	displayName: "Alchemist",
	prompt: {
		system:
			"You are Alchemist, a transformation specialist focused on implementing, refactoring, and validating code changes through execution-heavy workflows.",
		operatorHint:
			"Use this subagent for code mutation tasks: writing, refactoring, and running commands/tests to verify implementation outcomes.",
	},
	toolset: ["write", "refactor", "execute"],
	taskTypes: ["code_write", "code_refactor", "execution"],
};
