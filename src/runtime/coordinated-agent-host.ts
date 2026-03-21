import type { AgentHost, AgentHostStartResult, AgentHostState, HostCommand } from "../agent-host.js";
import type { AgentSessionEvent, ExtensionUIContext, SessionInfo, SessionStats } from "../local-coding-agent.js";
import { RuntimeCoordinator } from "./runtime-coordinator.js";

export class CoordinatedAgentHost implements AgentHost {
	constructor(private readonly coordinator: RuntimeCoordinator) {}

	async start(uiContext: ExtensionUIContext): Promise<AgentHostStartResult> {
		return await this.coordinator.start(uiContext);
	}

	async stop(): Promise<void> {
		await this.coordinator.stop();
	}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		return this.coordinator.getActiveRuntime().subscribe(listener);
	}

	getMessages() {
		return this.coordinator.getActiveRuntime().getMessages();
	}

	getState(): AgentHostState {
		return this.coordinator.getActiveRuntime().getState();
	}

	async prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp" }): Promise<void> {
		await this.coordinator.getActiveRuntime().prompt(text, options);
	}

	async abort(): Promise<void> {
		await this.coordinator.getActiveRuntime().abort();
	}

	async cycleThinkingLevel(): Promise<void> {
		await this.coordinator.getActiveRuntime().cycleThinkingLevel();
	}

	async setThinkingLevel(level: AgentHostState["thinkingLevel"]): Promise<void> {
		await this.coordinator.getActiveRuntime().setThinkingLevel(level);
	}

	getAvailableThinkingLevels() {
		return this.coordinator.getActiveRuntime().getAvailableThinkingLevels();
	}

	async cycleModel(direction: "forward" | "backward"): Promise<void> {
		await this.coordinator.getActiveRuntime().cycleModel(direction);
	}

	async getAvailableModels() {
		return await this.coordinator.getActiveRuntime().getAvailableModels();
	}

	async setModel(provider: string, modelId: string): Promise<void> {
		await this.coordinator.getActiveRuntime().setModel(provider, modelId);
	}

	async getCommands(): Promise<HostCommand[]> {
		return await this.coordinator.getActiveRuntime().getCommands();
	}

	async newSession(): Promise<void> {
		await this.coordinator.getActiveRuntime().newSession();
	}

	async compact(customInstructions?: string): Promise<void> {
		await this.coordinator.getActiveRuntime().compact(customInstructions);
	}

	getSessionStats(): SessionStats {
		return this.coordinator.getActiveRuntime().getSessionStats();
	}

	async exportHtml(outputPath?: string): Promise<string> {
		return await this.coordinator.getActiveRuntime().exportHtml(outputPath);
	}

	async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
		return await this.coordinator.getActiveRuntime().getForkMessages();
	}

	async fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
		return await this.coordinator.getActiveRuntime().fork(entryId);
	}

	async getTreeTargets(): Promise<Array<{ entryId: string; text: string }>> {
		return await this.coordinator.getActiveRuntime().getTreeTargets();
	}

	async navigateTree(entryId: string): Promise<{ editorText?: string; cancelled: boolean }> {
		return await this.coordinator.getActiveRuntime().navigateTree(entryId);
	}

	async listSessions(scope: "current" | "all"): Promise<SessionInfo[]> {
		return await this.coordinator.getActiveRuntime().listSessions(scope);
	}

	async switchSession(sessionPath: string): Promise<void> {
		await this.coordinator.getActiveRuntime().switchSession(sessionPath);
	}

	async setSessionName(name: string): Promise<void> {
		await this.coordinator.getActiveRuntime().setSessionName(name);
	}
}
