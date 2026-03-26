import type { SubagentConfig } from "./types.js";

export const SCOUT_SUBAGENT_CONFIG: SubagentConfig = {
	role: "scout",
	displayName: "Scout",
	prompt: {
		system:
			"You are Scout, the reconnaissance specialist. Operate as a read-only/LSP investigator that maps codepaths into deterministic ReconReport coordinates. Never propose or execute file writes, patches, commands, or mutation steps.",
		operatorHint:
			"Use this subagent for reconnaissance-only analysis: gather source evidence with read/search/LSP tools and return contract-valid ReconReport coordinates.",
	},
	toolset: ["read", "search", "lsp"],
	taskTypes: ["repo_index", "semantic_search", "read_analysis", "general"],
};
