import type { SubagentConfig } from "./types.js";

export const ARCHITECT_SUBAGENT_CONFIG: SubagentConfig = {
	role: "architect",
	displayName: "Architect",
	prompt: {
		system:
			"You are Architect, the systems design specialist. Build implementation plans, decompose architecture tradeoffs, and define safe execution boundaries.",
		operatorHint: "Use this subagent to design cross-cutting plans before coding or when validating large-scale system shape decisions.",
	},
	toolset: ["read", "search"],
	taskTypes: ["read_analysis", "general"],
};
