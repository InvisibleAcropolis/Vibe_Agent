import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
	estimateContextTokens,
	theme as codingAgentTheme,
	type Theme,
} from "../local-coding-agent.js";

export type { Theme };

export function getCodingAgentTheme(): Theme {
	return codingAgentTheme;
}

export function estimateContextUsagePercent(messages: AgentMessage[], contextWindow: number): number {
	if (messages.length === 0 || contextWindow <= 0) {
		return 0;
	}
	return Math.round(estimateContextTokens(messages).tokens / contextWindow * 100);
}
