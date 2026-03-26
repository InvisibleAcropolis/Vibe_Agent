import type { RpcAgentRole } from "../../bridge/rpc_launcher.js";

export type OrcTaskType =
	| "repo_index"
	| "semantic_search"
	| "read_analysis"
	| "code_write"
	| "code_refactor"
	| "execution"
	| "general";

export type SubagentToolsetCapabilities = "index" | "search" | "read" | "write" | "refactor" | "execute";

export interface SubagentPromptConfig {
	system: string;
	operatorHint: string;
}

export interface SubagentConfig {
	role: Exclude<RpcAgentRole, "orc">;
	displayName: string;
	prompt: SubagentPromptConfig;
	toolset: ReadonlyArray<SubagentToolsetCapabilities>;
	taskTypes: ReadonlyArray<OrcTaskType>;
}

export interface TaskRoutingDecision {
	taskType: OrcTaskType;
	targetRole: Exclude<RpcAgentRole, "orc">;
	reason: string;
}

export interface RoutedSubagentSession {
	sessionId: string;
	taskId: string;
	taskType: OrcTaskType;
	subagentRole: Exclude<RpcAgentRole, "orc">;
	subagentAgentId: string;
	subagentInstanceId: string;
	paneId: string;
	boundAt: string;
}
