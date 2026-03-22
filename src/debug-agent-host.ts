import type { PiMonoAppDebugger } from "./app-debugger.js";
import type { AgentHost, AgentHostStartResult, AgentHostState, HostCommand } from "./agent-host.js";
import { DirectAgentHost } from "./direct-agent-host.js";
import type { AgentSession, CreateAgentSessionOptions, ExtensionError } from "./local-coding-agent.js";
import type { RuntimeDescriptor } from "./runtime/agent-runtime.js";

function durationMs(startTime: number): number {
	return Date.now() - startTime;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function reportSessionWarnings(session: AgentSession, debuggerSink: PiMonoAppDebugger): Promise<void> {
	for (const { scope, error } of session.settingsManager.drainErrors()) {
		debuggerSink.log("host.settings.warning", {
			scope,
			message: error.message,
			stack: error.stack,
		});
	}

	for (const error of session.modelRegistry.authStorage.drainErrors()) {
		debuggerSink.log("host.auth.warning", {
			message: error.message,
			stack: error.stack,
		});
	}
}

export interface DefaultAgentHostOptions {
	createOptions?: CreateAgentSessionOptions;
	onSessionReady?: (session: AgentSession, modelFallbackMessage: string | undefined) => void | Promise<void>;
	onExtensionError?: (error: ExtensionError) => void;
}

export function createDefaultAgentHost(debuggerSink: PiMonoAppDebugger, options: DefaultAgentHostOptions = {}): AgentHost {
	const directHost = new DirectAgentHost({
		createOptions: options.createOptions,
		onSessionReady: async (session, modelFallbackMessage) => {
			await options.onSessionReady?.(session, modelFallbackMessage);
			await reportSessionWarnings(session, debuggerSink);
		},
		onExtensionError: (error: ExtensionError) => {
			debuggerSink.log("host.extension.error", error as unknown as Record<string, unknown>);
			options.onExtensionError?.(error);
		},
	});
	return new DebugAgentHost(directHost, debuggerSink);
}

export class DebugAgentHost implements AgentHost {
	constructor(
		private readonly inner: AgentHost,
		private readonly debuggerSink: PiMonoAppDebugger,
	) {}

	async start(uiContext: Parameters<AgentHost["start"]>[0]): Promise<AgentHostStartResult> {
		return await this.measure("start", () => this.inner.start(uiContext));
	}

	async stop(): Promise<void> {
		await this.measure("stop", () => this.inner.stop());
	}

	subscribe(listener: Parameters<AgentHost["subscribe"]>[0]): () => void {
		this.debuggerSink.log("host.subscribe");
		return this.inner.subscribe(listener);
	}

	getMessages() {
		return this.inner.getMessages();
	}

	getState(): AgentHostState {
		return this.inner.getState();
	}

	async prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp" }): Promise<void> {
		await this.measure("prompt", () => this.inner.prompt(text, options), { length: text.length, redacted: true });
	}

	async abort(): Promise<void> {
		await this.measure("abort", () => this.inner.abort());
	}

	async cycleThinkingLevel(): Promise<void> {
		await this.measure("cycleThinkingLevel", () => this.inner.cycleThinkingLevel());
	}

	async setThinkingLevel(level: AgentHostState["thinkingLevel"]): Promise<void> {
		await this.measure("setThinkingLevel", () => this.inner.setThinkingLevel(level), { level });
	}

	getAvailableThinkingLevels() {
		return this.inner.getAvailableThinkingLevels();
	}

	async cycleModel(direction: "forward" | "backward"): Promise<void> {
		await this.measure("cycleModel", () => this.inner.cycleModel(direction), { direction });
	}

	async getAvailableModels() {
		return await this.measure("getAvailableModels", () => this.inner.getAvailableModels());
	}

	async setModel(provider: string, modelId: string): Promise<void> {
		await this.measure("setModel", () => this.inner.setModel(provider, modelId), { provider, modelId });
	}

	listRuntimes(): RuntimeDescriptor[] {
		return this.inner.listRuntimes();
	}

	getActiveRuntimeDescriptor(): RuntimeDescriptor {
		return this.inner.getActiveRuntimeDescriptor();
	}

	async switchRuntime(runtimeId: string): Promise<void> {
		await this.measure("switchRuntime", () => this.inner.switchRuntime(runtimeId), { runtimeId });
	}

	async getCommands(): Promise<HostCommand[]> {
		return await this.measure("getCommands", () => this.inner.getCommands());
	}

	async newSession(): Promise<void> {
		await this.measure("newSession", () => this.inner.newSession());
	}

	async compact(customInstructions?: string): Promise<void> {
		await this.measure("compact", () => this.inner.compact(customInstructions), {
			customInstructionsLength: customInstructions?.length ?? 0,
			redacted: !!customInstructions,
		});
	}

	getSessionStats() {
		return this.inner.getSessionStats();
	}

	async exportHtml(outputPath?: string): Promise<string> {
		return await this.measure("exportHtml", () => this.inner.exportHtml(outputPath), { outputPath });
	}

	async getForkMessages() {
		return await this.measure("getForkMessages", () => this.inner.getForkMessages());
	}

	async fork(entryId: string) {
		return await this.measure("fork", () => this.inner.fork(entryId), { entryId });
	}

	async getTreeTargets() {
		return await this.measure("getTreeTargets", () => this.inner.getTreeTargets());
	}

	async navigateTree(entryId: string) {
		return await this.measure("navigateTree", () => this.inner.navigateTree(entryId), { entryId });
	}

	async listSessions(scope: "current" | "all") {
		return await this.measure("listSessions", () => this.inner.listSessions(scope), { scope });
	}

	async switchSession(sessionPath: string): Promise<void> {
		await this.measure("switchSession", () => this.inner.switchSession(sessionPath), { sessionPath });
	}

	async setSessionName(name: string): Promise<void> {
		await this.measure("setSessionName", () => this.inner.setSessionName(name), { length: name.length, redacted: true });
	}

	private async measure<T>(method: string, action: () => Promise<T>, details: Record<string, unknown> = {}): Promise<T> {
		const startTime = Date.now();
		this.debuggerSink.log("host.method.start", { method, ...details });
		try {
			const result = await action();
			this.debuggerSink.log("host.method.end", { method, durationMs: durationMs(startTime) });
			return result;
		} catch (error) {
			this.debuggerSink.logError(`host.${method}`, error, {
				...details,
				durationMs: durationMs(startTime),
				message: getErrorMessage(error),
			});
			throw error;
		}
	}
}
