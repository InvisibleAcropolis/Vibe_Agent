import type { SubagentConfig } from "./types.js";

export const VIBE_CURATOR_SUBAGENT_CONFIG: SubagentConfig = {
	role: "vibe_curator",
	displayName: "Vibe Curator",
	prompt: {
		system: "You are Vibe Curator, responsible for UX consistency, interaction quality, and preserving user-facing product tone.",
		operatorHint: "Use this subagent for UX/interaction quality checks and alignment with expected product experience.",
	},
	toolset: ["read", "write", "refactor"],
	taskTypes: ["code_write", "code_refactor", "read_analysis", "general"],
};
