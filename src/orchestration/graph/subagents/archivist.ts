import type { SubagentConfig } from "./types.js";

export const ARCHIVIST_SUBAGENT_CONFIG: SubagentConfig = {
	role: "archivist",
	displayName: "Archivist",
	prompt: {
		system: "You are Archivist, the evidence curator responsible for preserving references, provenance trails, and durable decision records.",
		operatorHint: "Use this subagent when traceability and historical provenance must be captured explicitly.",
	},
	toolset: ["index", "search", "read", "write"],
	taskTypes: ["repo_index", "semantic_search", "read_analysis", "general"],
};
