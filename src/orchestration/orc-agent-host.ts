import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Model, TextContent } from "@mariozechner/pi-ai";
import type { AgentHost, AgentHostStartResult, AgentHostState, HostCommand } from "../agent-host.js";
import type { RuntimeDescriptor } from "../runtime/agent-runtime.js";
import type { AppConfigRepository } from "../app/app-config-repository.js";
import type { AgentSessionEvent, ExtensionUIContext, SessionInfo, SessionStats } from "../local-coding-agent.js";
import { AuthStorage, ModelRegistry } from "../local-coding-agent.js";
import { LocalFileOrcCheckpointStore } from "./orc-checkpoints.js";
import { buildOrcPythonEnv, getOrcRepoRoot, resolvePreferredPythonInvocation, verifyPythonModules, type OrcPythonInvocation } from "./orc-python-environment.js";
import { OrcRuntimeSkeleton } from "./orc-runtime.js";
import { FileSystemOrcTracker } from "./orc-tracker.js";
import { OrcSessionHandle, type OrcSession, type OrcSessionRuntimeHooks } from "./orc-session.js";
import type { LaunchOrcRequest, OrcPythonRunnerSpawnContract, OrcRunnerLaunchInput } from "./orc-io.js";
import type { OrcControlPlaneState } from "./orc-state.js";
import { OrcSharedLaunchContextResolver, type OrcResolvedLaunchContext } from "./orc-shared-launch-context.js";

const ORC_RUNTIME_DESCRIPTOR: RuntimeDescriptor = {
	id: "orc",
	kind: "orchestration",
	displayName: "Orc Deepagent",
	capabilities: ["interactive-prompt", "planning", "checkpoint-visibility", "orchestration-status"],
	primary: true,
};

type PendingRunnerContext = {
	invocation: OrcPythonInvocation;
	env: NodeJS.ProcessEnv;
};

export interface OrcAgentHostOptions {
	configRepository: AppConfigRepository;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	durableRootPath: string;
	workspaceRoot?: string;
}

export function createOrcAgentHost(options: OrcAgentHostOptions): AgentHost {
	return new OrcAgentHost(options);
}

class OrcAgentHost implements AgentHost {
	private readonly workspaceRoot: string;
	private readonly selectionResolver: OrcSharedLaunchContextResolver;
	private readonly checkpointStore: LocalFileOrcCheckpointStore;
	private readonly tracker: FileSystemOrcTracker;
	private readonly eventListeners = new Set<(event: AgentSessionEvent) => void>();
	private readonly pendingRunnerContexts = new Map<string, PendingRunnerContext>();
	private readonly runtime: OrcRuntimeSkeleton;
	private messages: AgentMessage[] = [];
	private hostState: AgentHostState = createInitialHostState();
	private activeThreadId?: string;
	private activeState?: OrcControlPlaneState;
	private currentModel?: Model<any>;
	private currentSession?: ObservableOrcSession;

	constructor(private readonly options: OrcAgentHostOptions) {
		this.workspaceRoot = options.workspaceRoot ?? process.cwd();
		this.selectionResolver = new OrcSharedLaunchContextResolver(
			options.configRepository,
			options.authStorage,
			options.modelRegistry,
		);
		this.checkpointStore = new LocalFileOrcCheckpointStore({ durableRoot: options.durableRootPath });
		this.tracker = new FileSystemOrcTracker(this.checkpointStore, { durableRoot: options.durableRootPath });
		this.runtime = new OrcRuntimeSkeleton(
			{
				createCheckpointStore: () => this.checkpointStore,
				createTracker: () => this.tracker,
				buildPythonRunnerSpawnContract: (input) => this.buildSpawnContract(input),
			},
			{
				sessionFactory: {
					createSession: (input) => this.attachSession(
						new ObservableOrcSession(
							input.threadId,
							input.state,
							input.checkpointId,
							input.securityPolicy,
							input.runCorrelationId,
							input.request.modelSelection,
							input.request.runnerContextId,
							(state) => this.onSessionStateUpdated(state),
						),
					),
				},
			},
		);
	}

	async start(_uiContext: ExtensionUIContext): Promise<AgentHostStartResult> {
		const availableModels = this.options.modelRegistry.getAvailable();
		const availableProviderCount = new Set(availableModels.map((model) => model.provider)).size;
		let modelFallbackMessage: string | undefined;
		try {
			const selection = await this.selectionResolver.resolveSavedSelection();
			this.currentModel = selection.model;
			this.hostState.model = selection.model;
		} catch (error) {
			modelFallbackMessage = error instanceof Error ? error.message : String(error);
		}
		this.syncCounts();
		return {
			messages: this.messages,
			state: this.hostState,
			modelFallbackMessage,
			availableProviderCount,
		};
	}

	async stop(): Promise<void> {
		await this.runtime.dispose();
	}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	getMessages(): AgentMessage[] {
		return this.messages;
	}

	getState(): AgentHostState {
		return this.hostState;
	}

	async prompt(text: string): Promise<void> {
		if (this.hostState.isStreaming) {
			this.pushAssistantError("Orc is already running. Wait for the current deepagent task to finish before submitting another prompt.");
			return;
		}

		let runnerContextId: string | undefined;
		try {
			const selection = await this.selectionResolver.resolveSavedSelection();
			await this.prepareRunnerContext(selection);
			this.currentModel = selection.model;
			this.hostState.model = selection.model;
			this.hostState.isStreaming = true;
			this.emitEvent({ type: "agent_start" });

			runnerContextId = `orc-runner-${randomUUID()}`;
			const invocation = await resolvePreferredPythonInvocation();
			const env = buildOrcPythonEnv({
				[selection.apiKeyEnvVar]: selection.apiKey,
				ORC_PROVIDER_ID: selection.providerId,
				ORC_MODEL_ID: selection.modelId,
				ORC_MODEL_SPEC: selection.modelSpec,
			});
			await verifyPythonModules(invocation, env, selection.requiredPythonModules);
			this.pendingRunnerContexts.set(runnerContextId, { invocation, env });

			const response = await this.runtime.launch(this.createLaunchRequest(text, selection, runnerContextId));
			this.activeThreadId = response.threadId;
			this.hostState.sessionId = response.threadId;
			this.hostState.sessionFile = response.threadId;
			this.syncCounts();
			this.emitTranscriptRefresh();
		} catch (error) {
			if (runnerContextId) {
				this.pendingRunnerContexts.delete(runnerContextId);
			}
			this.hostState.isStreaming = false;
			this.pushAssistantError(error instanceof Error ? error.message : String(error));
		}
	}

	async abort(): Promise<void> {
		await this.currentSession?.getRuntimeHooks()?.cancel("user_cancelled");
	}

	async cycleThinkingLevel(): Promise<void> {}

	async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		this.hostState.thinkingLevel = level;
	}

	getAvailableThinkingLevels(): ThinkingLevel[] {
		return ["off"];
	}

	async cycleModel(direction: "forward" | "backward"): Promise<void> {
		const available = this.options.modelRegistry.getAvailable();
		if (available.length === 0) {
			throw new Error("No models are available for Orc.");
		}
		const currentIndex = this.currentModel ? available.findIndex((model) => model.provider === this.currentModel?.provider && model.id === this.currentModel?.id) : -1;
		const delta = direction === "forward" ? 1 : -1;
		const nextIndex = currentIndex < 0 ? 0 : (currentIndex + delta + available.length) % available.length;
		const nextModel = available[nextIndex]!;
		await this.setModel(nextModel.provider, nextModel.id);
	}

	async getAvailableModels(): Promise<Model<any>[]> {
		return this.options.modelRegistry.getAvailable();
	}

	async setModel(provider: string, modelId: string): Promise<void> {
		const model = this.options.modelRegistry.find(provider, modelId);
		if (!model) {
			throw new Error(`Orc model '${provider}/${modelId}' is unavailable.`);
		}
		this.currentModel = model;
		this.hostState.model = model;
	}

	listRuntimes(): RuntimeDescriptor[] {
		return [ORC_RUNTIME_DESCRIPTOR];
	}

	getActiveRuntimeDescriptor(): RuntimeDescriptor {
		return ORC_RUNTIME_DESCRIPTOR;
	}

	async switchRuntime(_runtimeId: string): Promise<void> {}

	async getCommands(): Promise<HostCommand[]> {
		return [];
	}

	async newSession(): Promise<void> {
		this.activeThreadId = undefined;
		this.activeState = undefined;
		this.messages = [];
		this.currentSession = undefined;
		this.hostState = {
			...createInitialHostState(),
			model: this.currentModel,
			sessionName: this.hostState.sessionName,
		};
		this.emitTranscriptRefresh();
	}

	async compact(): Promise<void> {}

	getSessionStats(): SessionStats {
		const userMessages = this.messages.filter((message) => message.role === "user").length;
		const assistantMessages = this.messages.filter((message) => message.role === "assistant").length;
		const toolCalls = this.messages.filter((message) => message.role === "assistant").flatMap((message) =>
			(message as AssistantMessage).content.filter((content) => content.type === "toolCall"),
		).length;
		return {
			sessionFile: this.hostState.sessionFile,
			sessionId: this.hostState.sessionId,
			userMessages,
			assistantMessages,
			toolCalls,
			toolResults: this.messages.filter((message) => message.role === "toolResult").length,
			totalMessages: this.messages.length,
			tokens: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
			cost: 0,
		};
	}

	async exportHtml(outputPath?: string): Promise<string> {
		const exportPath = outputPath ? path.resolve(outputPath) : path.join(this.workspaceRoot, `orc-session-${Date.now()}.html`);
		ensureParentDir(exportPath);
		const body = this.messages
			.map((message) => {
				if (message.role === "user") {
					return `<section><h2>User</h2><pre>${escapeHtml(renderUserMessage(message))}</pre></section>`;
				}
				if (message.role === "assistant") {
					return `<section><h2>Orc</h2><pre>${escapeHtml(renderAssistantMessage(message as AssistantMessage))}</pre></section>`;
				}
				return `<section><h2>Event</h2><pre>${escapeHtml(JSON.stringify(message, null, 2))}</pre></section>`;
			})
			.join("\n");
		writeFileSync(exportPath, `<!doctype html><html><body>${body}</body></html>`, "utf8");
		return exportPath;
	}

	async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
		return [];
	}

	async fork(_entryId: string): Promise<{ text: string; cancelled: boolean }> {
		return { text: "", cancelled: true };
	}

	async getTreeTargets(): Promise<Array<{ entryId: string; text: string }>> {
		return [];
	}

	async navigateTree(_entryId: string): Promise<{ editorText?: string; cancelled: boolean }> {
		return { cancelled: true };
	}

	async listSessions(_scope: "current" | "all"): Promise<SessionInfo[]> {
		if (!this.activeThreadId) {
			return [];
		}
		return [{
			id: this.activeThreadId,
			path: this.activeThreadId,
			cwd: this.workspaceRoot,
			name: this.hostState.sessionName ?? "Orc Deepagent",
			created: new Date(),
			modified: new Date(),
			messageCount: this.messages.length,
			firstMessage: this.messages[0] ? (this.messages[0].role === "user" ? renderUserMessage(this.messages[0]) : renderAssistantMessage(this.messages[0] as AssistantMessage)) : "",
			allMessagesText: this.messages.map((message) => message.role === "user" ? renderUserMessage(message) : message.role === "assistant" ? renderAssistantMessage(message as AssistantMessage) : JSON.stringify(message)).join("\n\n"),
		}];
	}

	async switchSession(sessionPath: string): Promise<void> {
		const restored = await this.runtime.loadTrackerState({ threadId: sessionPath });
		if (!restored.found || !restored.state) {
			throw new Error(`Unable to restore Orc thread '${sessionPath}'.`);
		}
		this.activeThreadId = restored.state.threadId;
		this.activeState = restored.state;
		this.hostState.sessionId = restored.state.threadId;
		this.hostState.sessionFile = restored.state.threadId;
		this.messages = mapControlPlaneStateToAgentMessages(restored.state, this.currentModel);
		this.syncStreamingState(restored.state);
		this.syncCounts();
		this.emitTranscriptRefresh();
	}

	async setSessionName(name: string): Promise<void> {
		this.hostState.sessionName = name;
	}

	private createLaunchRequest(
		prompt: string,
		selection: OrcResolvedLaunchContext,
		runnerContextId: string,
	): LaunchOrcRequest {
		return {
			project: {
				projectId: createWorkspaceProjectId(this.workspaceRoot),
				projectRoot: this.workspaceRoot,
				projectName: path.basename(this.workspaceRoot) || this.workspaceRoot,
				branchName: readGitBranch(this.workspaceRoot) ?? undefined,
				metadata: {
					sessionName: this.hostState.sessionName ?? "Orc Deepagent",
					workspaceRoot: this.workspaceRoot,
				},
			},
			prompt,
			modelSelection: {
				providerId: selection.providerId,
				modelId: selection.modelId,
				modelSpec: selection.modelSpec,
			},
			runnerContextId,
		};
	}

	private async prepareRunnerContext(_selection: OrcResolvedLaunchContext): Promise<void> {
		// This hook exists to preserve the explicit launch boundary for future auth refresh or session metadata work.
	}

	private buildSpawnContract(input: OrcRunnerLaunchInput): OrcPythonRunnerSpawnContract {
		const runnerContextId = input.runnerContextId;
		if (!runnerContextId) {
			throw new Error("Orc runner context id is missing; refusing to launch Python without an ephemeral auth context.");
		}
		const context = this.pendingRunnerContexts.get(runnerContextId);
		if (!context) {
			throw new Error("The Orc runner auth context has expired before Python launch.");
		}
		this.pendingRunnerContexts.delete(runnerContextId);
		const { runnerContextId: _omitted, ...stdinPayload } = input;
		return {
			command: context.invocation.command,
			args: [...context.invocation.args, "-m", "src.orchestration.python.orc_runner"],
			cwd: getOrcRepoRoot(),
			env: context.env,
			stdinPayload,
			stdoutProtocol: "jsonl",
			stderrProtocol: "diagnostic_text",
		};
	}

	private attachSession(session: ObservableOrcSession): OrcSession {
		this.currentSession = session;
		return session;
	}

	private onSessionStateUpdated(state: OrcControlPlaneState): void {
		this.activeState = state;
		this.activeThreadId = state.threadId;
		this.messages = mapControlPlaneStateToAgentMessages(state, this.currentModel);
		this.hostState.sessionId = state.threadId;
		this.hostState.sessionFile = state.threadId;
		this.syncStreamingState(state);
		this.syncCounts();
		this.emitTranscriptRefresh();
	}

	private syncStreamingState(state: OrcControlPlaneState): void {
		const terminalStatus = state.terminalState.status;
		this.hostState.isStreaming = terminalStatus === "running";
	}

	private syncCounts(): void {
		this.hostState.messageCount = this.messages.length;
		this.hostState.pendingMessageCount = 0;
	}

	private emitTranscriptRefresh(): void {
		this.emitEvent({ type: "agent_end", messages: this.messages });
	}

	private emitEvent(event: AgentSessionEvent): void {
		for (const listener of this.eventListeners) {
			listener(event);
		}
	}

	private pushAssistantError(message: string): void {
		const assistantMessage = createAssistantTextMessage(message, this.currentModel);
		this.messages = [...this.messages, assistantMessage];
		this.syncCounts();
		this.emitTranscriptRefresh();
	}
}

class ObservableOrcSession extends OrcSessionHandle {
	constructor(
		threadId: string,
		state: OrcControlPlaneState | undefined,
		checkpointId: string | undefined,
		securityPolicy: OrcSession["securityPolicy"],
		runCorrelationId: string | undefined,
		readonly modelSelection: LaunchOrcRequest["modelSelection"],
		readonly runnerContextId: string | undefined,
		private readonly onStateUpdated: (state: OrcControlPlaneState) => void,
	) {
		super(threadId, state, checkpointId, securityPolicy, runCorrelationId);
	}

	override updateState(state: OrcControlPlaneState): void {
		super.updateState(state);
		this.onStateUpdated(state);
	}

	override attachRuntimeHooks(hooks: OrcSessionRuntimeHooks): void {
		super.attachRuntimeHooks(hooks);
	}
}

function createInitialHostState(): AgentHostState {
	return {
		thinkingLevel: "off",
		isStreaming: false,
		isCompacting: false,
		steeringMode: "all",
		followUpMode: "all",
		sessionId: `orc-session-${randomUUID()}`,
		sessionName: "Orc Deepagent",
		autoCompactionEnabled: false,
		pendingMessageCount: 0,
		messageCount: 0,
	};
}

function mapControlPlaneStateToAgentMessages(state: OrcControlPlaneState, model?: Model<any>): AgentMessage[] {
	return state.messages.map((message) => {
		if (message.role === "user") {
			return {
				role: "user",
				content: message.content,
				timestamp: Date.parse(message.createdAt) || Date.now(),
			};
		}
		return createAssistantTextMessage(message.content, model, message.createdAt);
	});
}

function createAssistantTextMessage(
	text: string,
	model?: Model<any>,
	createdAt?: string,
): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }] satisfies TextContent[],
		api: model?.api ?? "orc-runtime",
		provider: model?.provider ?? "orc",
		model: model?.id ?? "deepagent",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason: "stop",
		timestamp: createdAt ? (Date.parse(createdAt) || Date.now()) : Date.now(),
	};
}

function renderUserMessage(message: AgentMessage): string {
	if (message.role !== "user") {
		return "";
	}
	if (typeof message.content === "string") {
		return message.content;
	}
	return message.content.map((content) => content.type === "text" ? content.text : "[image]").join("\n");
}

function renderAssistantMessage(message: AssistantMessage): string {
	return message.content.map((content) => content.type === "text" ? content.text : content.type === "thinking" ? content.thinking : `[tool:${content.name}]`).join("\n");
}

function createWorkspaceProjectId(workspaceRoot: string): string {
	return path.basename(workspaceRoot).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

function readGitBranch(workspaceRoot: string): string | null {
	let dir = workspaceRoot;
	while (true) {
		const gitPath = path.join(dir, ".git");
		if (existsSync(gitPath)) {
			try {
				const stat = statSync(gitPath);
				const headPath = stat.isFile()
					? path.resolve(dir, readFileSync(gitPath, "utf8").trim().slice(8), "HEAD")
					: path.join(gitPath, "HEAD");
				if (existsSync(headPath)) {
					const head = readFileSync(headPath, "utf8").trim();
					return head.startsWith("ref: refs/heads/") ? head.slice("ref: refs/heads/".length) : "detached";
				}
			} catch {
				return null;
			}
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			return null;
		}
		dir = parent;
	}
}

function ensureParentDir(filePath: string): void {
	const dir = path.dirname(filePath);
	mkdirSync(dir, { recursive: true });
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
