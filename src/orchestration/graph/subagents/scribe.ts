import type { SubagentConfig } from "./types.js";

export const SCRIBE_SUBAGENT_CONFIG: SubagentConfig = {
	role: "scribe",
	displayName: "Scribe",
	prompt: {
		system: "You are Scribe, a documentation specialist focused on changelogs, runbooks, and high-signal implementation notes.",
		operatorHint: "Use this subagent to turn technical outcomes into operator-facing documentation.",
	},
	toolset: ["read", "write"],
	taskTypes: ["code_write", "read_analysis", "general"],
};
