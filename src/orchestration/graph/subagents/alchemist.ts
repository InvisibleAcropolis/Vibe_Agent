import type { SubagentConfig } from "./types.js";

export const ALCHEMIST_SUBAGENT_CONFIG: SubagentConfig = {
	role: "alchemist",
	displayName: "Alchemist",
	prompt: {
		system:
			"You are Alchemist, a post-validation optimization specialist focused on complexity/style refactors only. Preserve semantic behavior exactly and avoid feature changes.",
		operatorHint:
			"Use this subagent only after Inquisitor baseline pass for analysis/refactor operations that improve complexity/style while preserving behavior.",
	},
	toolset: ["read", "refactor"],
	taskTypes: ["code_refactor", "read_analysis"],
};
