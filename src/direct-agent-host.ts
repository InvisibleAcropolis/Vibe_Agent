import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import { supportsXhigh } from "@mariozechner/pi-ai";
import {
	type AgentSession,
	type AgentSessionEvent,
	type CreateAgentSessionOptions,
	type ExtensionError,
	type ExtensionUIContext,
	type SessionInfo,
	type SessionStats,
	SessionManager,
	createAgentSession,
} from "./local-coding-agent.js";
import type { AgentHost, AgentHostStartResult, AgentHostState, HostCommand } from "./agent-host.js";
import type { RuntimeDescriptor } from "./runtime/agent-runtime.js";

type DirectAgentHostOptions = {
	createOptions?: CreateAgentSessionOptions;
	onSessionReady?: (session: AgentSession, modelFallbackMessage: string | undefined) => void | Promise<void>;
	onExtensionError?: (error: ExtensionError) => void;
};

export class DirectAgentHost implements AgentHost {
	private session?: AgentSession;
	private unsubscribers: Array<() => void> = [];

	constructor(private readonly options: DirectAgentHostOptions = {}) {}

	async start(uiContext: ExtensionUIContext): Promise<AgentHostStartResult> {
		const { session, modelFallbackMessage } = await createAgentSession(this.options.createOptions);
		this.session = session;

		await session.bindExtensions({
			uiContext,
			onError: this.options.onExtensionError,
			commandContextActions: {
				waitForIdle: () => session.agent.waitForIdle(),
				newSession: async (options) => ({ cancelled: !(await session.newSession(options)) }),
				fork: async (entryId) => {
					const result = await session.fork(entryId);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, options) => {
					const result = await session.navigateTree(targetId, options);
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath) => ({ cancelled: !(await session.switchSession(sessionPath)) }),
				reload: async () => {
					await session.reload();
				},
			},
		});
		await this.options.onSessionReady?.(session, modelFallbackMessage);

		const availableModels = await session.modelRegistry.getAvailable();
		const providerCount = new Set(availableModels.map((model) => model.provider)).size;

		return {
			messages: session.messages,
			state: this.getState(),
			modelFallbackMessage,
			availableProviderCount: providerCount,
		};
	}

	async stop(): Promise<void> {
		this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
		this.session?.dispose();
		this.session = undefined;
	}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		const session = this.requireSession();
		const unsubscribe = session.subscribe(listener);
		this.unsubscribers.push(unsubscribe);
		return () => {
			const index = this.unsubscribers.indexOf(unsubscribe);
			if (index >= 0) {
				this.unsubscribers.splice(index, 1);
			}
			unsubscribe();
		};
	}

	getMessages(): AgentMessage[] {
		return this.requireSession().messages;
	}

	getState(): AgentHostState {
		const session = this.requireSession();
		return {
			model: session.model,
			thinkingLevel: session.thinkingLevel,
			isStreaming: session.isStreaming,
			isCompacting: session.isCompacting,
			steeringMode: session.steeringMode,
			followUpMode: session.followUpMode,
			sessionFile: session.sessionFile,
			sessionId: session.sessionId,
			sessionName: session.sessionName,
			autoCompactionEnabled: session.autoCompactionEnabled,
			pendingMessageCount: session.pendingMessageCount,
			messageCount: session.messages.length,
		};
	}

	async prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp" }): Promise<void> {
		await this.requireSession().prompt(text, options);
	}

	async abort(): Promise<void> {
		await this.requireSession().abort();
	}

	async cycleThinkingLevel(): Promise<void> {
		this.requireSession().cycleThinkingLevel();
	}

	async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		this.requireSession().setThinkingLevel(level);
	}

	getAvailableThinkingLevels(): ThinkingLevel[] {
		const model = this.requireSession().model;
		if (!model?.reasoning) {
			return ["off"];
		}
		if (supportsXhigh(model)) {
			return ["off", "minimal", "low", "medium", "high", "xhigh"];
		}
		return ["off", "minimal", "low", "medium", "high"];
	}

	async cycleModel(direction: "forward" | "backward"): Promise<void> {
		const session = this.requireSession();
		if (direction === "forward") {
			await session.cycleModel();
			return;
		}
		const models =
			session.scopedModels.length > 0 ? session.scopedModels.map((entry) => entry.model) : await session.modelRegistry.getAvailable();
		if (models.length === 0) {
			return;
		}
		const currentIndex = models.findIndex((model) => model.provider === session.model?.provider && model.id === session.model?.id);
		const nextIndex = currentIndex <= 0 ? models.length - 1 : currentIndex - 1;
		const nextModel = models[nextIndex];
		if (nextModel) {
			await session.setModel(nextModel);
		}
	}

	async getAvailableModels(): Promise<Model<any>[]> {
		return await this.requireSession().modelRegistry.getAvailable();
	}

	async setModel(provider: string, modelId: string): Promise<void> {
		const session = this.requireSession();
		const model = session.modelRegistry.find(provider, modelId);
		if (!model) {
			throw new Error(`Model not found: ${provider}/${modelId}`);
		}
		await session.setModel(model);
	}

	listRuntimes(): RuntimeDescriptor[] {
		return [{
			id: "coding",
			kind: "coding",
			displayName: "Coding Runtime",
			capabilities: ["interactive-prompt", "session-management", "model-selection", "artifact-source", "log-source"],
			primary: true,
		}];
	}

	getActiveRuntimeDescriptor(): RuntimeDescriptor {
		return this.listRuntimes()[0]!;
	}

	async switchRuntime(runtimeId: string): Promise<void> {
		if (runtimeId !== this.getActiveRuntimeDescriptor().id) {
			throw new Error(`Runtime not found: ${runtimeId}`);
		}
	}

	async getCommands(): Promise<HostCommand[]> {
		const session = this.requireSession();
		const commands: HostCommand[] = [
			{ name: "settings", description: "Open app settings and session controls.", source: "builtin" },
			{ name: "resume", description: "Resume or switch sessions.", source: "builtin" },
			{ name: "fork", description: "Fork from a previous user message.", source: "builtin" },
			{ name: "tree", description: "Navigate to another branch point in this session.", source: "builtin" },
			{ name: "stats", description: "Show session statistics and token usage.", source: "builtin" },
			{ name: "artifacts", description: "List artifacts from the current session.", source: "builtin" },
			{ name: "clear", description: "Clear the chat display.", source: "builtin" },
			{ name: "help", description: "Show keybindings and usage information.", source: "builtin" },
		];

		for (const { command } of session.extensionRunner?.getRegisteredCommandsWithPaths() ?? []) {
			commands.push({
				name: command.name,
				description: command.description,
				source: "extension",
			});
		}

		for (const template of session.promptTemplates) {
			commands.push({
				name: template.name,
				description: template.description,
				source: "prompt",
			});
		}

		for (const skill of session.resourceLoader.getSkills().skills) {
			commands.push({
				name: `skill:${skill.name}`,
				description: skill.description,
				source: "skill",
			});
		}

		return commands.sort((a, b) => a.name.localeCompare(b.name));
	}

	async newSession(): Promise<void> {
		await this.requireSession().newSession();
	}

	async compact(customInstructions?: string): Promise<void> {
		await this.requireSession().compact(customInstructions);
	}

	getSessionStats(): SessionStats {
		return this.requireSession().getSessionStats();
	}

	async exportHtml(outputPath?: string): Promise<string> {
		return await this.requireSession().exportToHtml(outputPath);
	}

	async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
		return this.requireSession().getUserMessagesForForking();
	}

	async fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
		const result = await this.requireSession().fork(entryId);
		return { text: result.selectedText, cancelled: result.cancelled };
	}

	async getTreeTargets(): Promise<Array<{ entryId: string; text: string }>> {
		const session = this.requireSession();
		return session.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "message")
			.map((entry) => {
				if (entry.message.role === "user") {
					const text =
						typeof entry.message.content === "string"
							? entry.message.content.trim()
							: entry.message.content
									.filter((item): item is { type: "text"; text: string } => item.type === "text")
									.map((item) => item.text)
									.join(" ")
									.trim();
					return { entryId: entry.id, text: text || "User message" };
				}
				return { entryId: entry.id, text: `${entry.message.role} message` };
			});
	}

	async navigateTree(entryId: string): Promise<{ editorText?: string; cancelled: boolean }> {
		return await this.requireSession().navigateTree(entryId);
	}

	async listSessions(scope: "current" | "all"): Promise<SessionInfo[]> {
		const session = this.requireSession();
		if (scope === "current") {
			return await SessionManager.list(session.sessionManager.getCwd(), session.sessionManager.getSessionDir());
		}
		return await SessionManager.listAll();
	}

	async switchSession(sessionPath: string): Promise<void> {
		await this.requireSession().switchSession(sessionPath);
	}

	async setSessionName(name: string): Promise<void> {
		this.requireSession().setSessionName(name);
	}

	private requireSession(): AgentSession {
		if (!this.session) {
			throw new Error("Agent host not started");
		}
		return this.session;
	}
}
