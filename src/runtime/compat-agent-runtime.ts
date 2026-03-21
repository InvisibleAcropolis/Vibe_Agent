import type { AgentHost, AgentHostStartResult, AgentHostState, HostCommand } from "../agent-host.js";
import type { AgentSessionEvent, ExtensionUIContext, SessionInfo, SessionStats } from "../local-coding-agent.js";
import type { AgentRuntime, RuntimeDescriptor } from "./agent-runtime.js";

export class CompatAgentRuntime implements AgentRuntime {
	constructor(
		readonly descriptor: RuntimeDescriptor,
		private readonly host: AgentHost,
	) {}

	async start(uiContext: ExtensionUIContext): Promise<AgentHostStartResult> {
		return await this.host.start(uiContext);
	}

	async stop(): Promise<void> {
		await this.host.stop();
	}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		return this.host.subscribe(listener);
	}

	getMessages() {
		return this.host.getMessages();
	}

	getState(): AgentHostState {
		return this.host.getState();
	}

	async prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp" }): Promise<void> {
		await this.host.prompt(text, options);
	}

	async abort(): Promise<void> {
		await this.host.abort();
	}

	async cycleThinkingLevel(): Promise<void> {
		await this.host.cycleThinkingLevel();
	}

	async setThinkingLevel(level: AgentHostState["thinkingLevel"]): Promise<void> {
		await this.host.setThinkingLevel(level);
	}

	getAvailableThinkingLevels() {
		return this.host.getAvailableThinkingLevels();
	}

	async cycleModel(direction: "forward" | "backward"): Promise<void> {
		await this.host.cycleModel(direction);
	}

	async getAvailableModels() {
		return await this.host.getAvailableModels();
	}

	async setModel(provider: string, modelId: string): Promise<void> {
		await this.host.setModel(provider, modelId);
	}

	async getCommands(): Promise<HostCommand[]> {
		return await this.host.getCommands();
	}

	async newSession(): Promise<void> {
		await this.host.newSession();
	}

	async compact(customInstructions?: string): Promise<void> {
		await this.host.compact(customInstructions);
	}

	getSessionStats(): SessionStats {
		return this.host.getSessionStats();
	}

	async exportHtml(outputPath?: string): Promise<string> {
		return await this.host.exportHtml(outputPath);
	}

	async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
		return await this.host.getForkMessages();
	}

	async fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
		return await this.host.fork(entryId);
	}

	async getTreeTargets(): Promise<Array<{ entryId: string; text: string }>> {
		return await this.host.getTreeTargets();
	}

	async navigateTree(entryId: string): Promise<{ editorText?: string; cancelled: boolean }> {
		return await this.host.navigateTree(entryId);
	}

	async listSessions(scope: "current" | "all"): Promise<SessionInfo[]> {
		return await this.host.listSessions(scope);
	}

	async switchSession(sessionPath: string): Promise<void> {
		await this.host.switchSession(sessionPath);
	}

	async setSessionName(name: string): Promise<void> {
		await this.host.setSessionName(name);
	}
}
