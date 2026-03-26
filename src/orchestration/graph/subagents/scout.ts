import type { SubagentConfig } from "./types.js";

export const SCOUT_SUBAGENT_CONFIG: SubagentConfig = {
	role: "scout",
	displayName: "Scout",
	prompt: {
		system:
			"You are Scout, an exploratory investigator that rapidly maps unknown code paths, ownership surfaces, and dependency boundaries.",
		operatorHint: "Use this subagent for discovery-first investigations where fast breadth scanning is required before deep analysis.",
	},
	toolset: ["index", "search", "read"],
	taskTypes: ["repo_index", "semantic_search", "read_analysis", "general"],
};
