import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import type {
	AgentSessionEvent,
	ExtensionUIContext,
	SessionInfo,
	SessionStats,
} from "./local-coding-agent.js";

export interface HostCommand {
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill" | "builtin";
}

export interface AgentHostState {
	model?: Model<any>;
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	autoCompactionEnabled: boolean;
	pendingMessageCount: number;
	messageCount: number;
}

export interface AgentHostStartResult {
	messages: AgentMessage[];
	state: AgentHostState;
	modelFallbackMessage?: string;
	availableProviderCount: number;
}

export interface AgentHost {
	start(uiContext: ExtensionUIContext): Promise<AgentHostStartResult>;
	stop(): Promise<void>;
	subscribe(listener: (event: AgentSessionEvent) => void): () => void;
	getMessages(): AgentMessage[];
	getState(): AgentHostState;
	prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp" }): Promise<void>;
	abort(): Promise<void>;
	cycleThinkingLevel(): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): Promise<void>;
	getAvailableThinkingLevels(): ThinkingLevel[];
	cycleModel(direction: "forward" | "backward"): Promise<void>;
	getAvailableModels(): Promise<Model<any>[]>;
	setModel(provider: string, modelId: string): Promise<void>;
	getCommands(): Promise<HostCommand[]>;
	newSession(): Promise<void>;
	compact(customInstructions?: string): Promise<void>;
	getSessionStats(): SessionStats;
	exportHtml(outputPath?: string): Promise<string>;
	getForkMessages(): Promise<Array<{ entryId: string; text: string }>>;
	fork(entryId: string): Promise<{ text: string; cancelled: boolean }>;
	getTreeTargets(): Promise<Array<{ entryId: string; text: string }>>;
	navigateTree(entryId: string): Promise<{ editorText?: string; cancelled: boolean }>;
	listSessions(scope: "current" | "all"): Promise<SessionInfo[]>;
	switchSession(sessionPath: string): Promise<void>;
	setSessionName(name: string): Promise<void>;
}
