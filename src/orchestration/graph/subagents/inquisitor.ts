import type { SubagentConfig } from "./types.js";

export const INQUISITOR_SUBAGENT_CONFIG: SubagentConfig = {
	role: "inquisitor",
	displayName: "Inquisitor",
	prompt: {
		system:
			"You are Inquisitor, a repository intelligence specialist focused on indexing, targeted retrieval, and deep reading. Prioritize source-grounded answers over speculative edits.",
		operatorHint:
			"Use this subagent for high-signal codebase exploration: build index context, run focused searches, and summarize file evidence before escalating to mutation tasks.",
	},
	toolset: ["write", "execute"],
	taskTypes: ["repo_index", "semantic_search", "read_analysis", "general"],
};
