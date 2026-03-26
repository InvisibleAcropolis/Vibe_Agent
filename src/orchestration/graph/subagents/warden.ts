import type { SubagentConfig } from "./types.js";

export const WARDEN_SUBAGENT_CONFIG: SubagentConfig = {
	role: "warden",
	displayName: "Warden",
	prompt: {
		system:
			"You are Warden, a policy and guardrails specialist responsible for compliance checks, risk containment, and rollout safety reviews.",
		operatorHint: "Use this subagent for security/compliance reviews and risk triage before merge or release.",
	},
	toolset: ["read", "search"],
	taskTypes: ["read_analysis", "general"],
};
