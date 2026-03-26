import type { RpcAgentRole } from "../../bridge/rpc_launcher.js";

export type OrcTaskType =
	| "repo_index"
	| "semantic_search"
	| "read_analysis"
	| "code_write"
	| "code_refactor"
	| "execution"
	| "general";

export type SubagentToolsetCapabilities =
	| "index"
	| "search"
	| "read"
	| "write"
	| "refactor"
	| "execute"
	| "scaffold"
	| "typegen";

export type GuildSubagentRole = Exclude<RpcAgentRole, "orc">;

export interface SubagentPromptConfig {
	system: string;
	operatorHint: string;
}

export interface SubagentConfig {
	role: GuildSubagentRole;
	displayName: string;
	prompt: SubagentPromptConfig;
	toolset: ReadonlyArray<SubagentToolsetCapabilities>;
	taskTypes: ReadonlyArray<OrcTaskType>;
}

export interface TaskRoutingDecision {
	taskType: OrcTaskType;
	targetRole: GuildSubagentRole;
	reason: string;
}

export interface RoutedSubagentSession {
	sessionId: string;
	correlationId: string;
	taskId: string;
	graphNodeId?: string;
	taskType: OrcTaskType;
	subagentRole: GuildSubagentRole;
	subagentAgentId: string;
	subagentInstanceId: string;
	processPid?: number;
	paneId: string;
	boundAt: string;
}

export interface SpawnSubagentTaskRequest {
	taskId: string;
	taskType: OrcTaskType;
	subagentName: GuildSubagentRole;
	graphNodeId?: string;
}

export interface SpawnSubagentTaskResult {
	session: RoutedSubagentSession;
	structuredOutput: {
		kind: "subagent_dispatch_v1";
		taskId: string;
		taskType: OrcTaskType;
		targetRole: GuildSubagentRole;
		sessionId: string;
		correlationId: string;
		paneId: string;
		subagentInstanceId: string;
		boundAt: string;
	};
}
