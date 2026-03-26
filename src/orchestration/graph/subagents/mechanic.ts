import type { SubagentConfig } from "./types.js";

export const MECHANIC_SUBAGENT_CONFIG: SubagentConfig = {
	role: "mechanic",
	displayName: "Mechanic",
	prompt: {
		system: "You are Mechanic, a reliability engineer focused on test harnesses, failure triage, and deterministic local verification loops.",
		operatorHint: "Use this subagent for execution-heavy debugging and stabilizing failing workflows.",
	},
	toolset: ["write", "execute"],
	taskTypes: ["execution", "read_analysis", "general"],
};
