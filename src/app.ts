import { ProcessTerminal, type Component } from "@mariozechner/pi-tui";
import { getEnvApiKey } from "@mariozechner/pi-ai";
import { join } from "node:path";
import { createAppDebugger, type PiMonoAppDebugger } from "./app-debugger.js";
import { AppConfig } from "./app-config.js";
import { DefaultAppStateStore, type AppStateStore } from "./app-state-store.js";
import type { AgentHost } from "./agent-host.js";
import { AnimationEngine, setGlobalAnimationEngine } from "./animation-engine.js";
import { DefaultCommandController } from "./command-controller.js";
import { createDefaultAgentHost } from "./debug-agent-host.js";
import { DefaultEditorController } from "./editor-controller.js";
import { DefaultExtensionUiHost } from "./extension-ui-host.js";
import { DefaultInputController } from "./input-controller.js";
import { renderAgentMessages } from "./message-renderer.js";
import { MouseEnabledTerminal } from "./mouse-enabled-terminal.js";
import { DefaultOverlayController } from "./overlay-controller.js";
import { DefaultShellView, type ShellView } from "./shell-view.js";
import { DefaultStartupController } from "./startup-controller.js";
import {
	AuthStorage,
	getAgentDir,
	initTheme,
	KeybindingsManager as InternalKeybindingsManager,
	ModelRegistry,
	OAuthSelectorComponent,
	onThemeChange,
	type AgentSession,
} from "./local-coding-agent.js";
import { getThemeNames, onThemeConfigChange, setActiveTheme, type ThemeName } from "./themes/index.js";
import type { VibeAgentAppOptions } from "./types.js";
import { type SetupRunRequest, WelcomeController } from "./welcome-controller.js";

type StartupGateAssessment =
	| { kind: "continue" }
	| { kind: "needs-provider"; reason: "first-run" | "disconnected" };

type SavedDefaultValidation =
	| { kind: "valid"; providerId: string; modelId: string }
	| { kind: "invalid-provider"; reason: "missing-provider" | "saved-provider-unavailable" }
	| { kind: "invalid-model"; providerId: string; reason: "missing-model" | "saved-model-unavailable" };

/**
 * Vibe Agent: A professional Agentic CLI application that provides
 * full terminal-based parity with the coding-agent's WebUI.
 *
 * Architecture:
 * - Uses the TUI shell shape from pi-tui (header/footer/body/overlays)
 * - Wires directly to the coding-agent's AgentSession for all AI interactions
 * - Deprecates the WebUI in favor of this unified TUI experience
 * - Full feature parity: chat, tool execution, artifacts, sessions, extensions
 */
export class VibeAgentApp {
	readonly debugger: PiMonoAppDebugger;
	readonly host: AgentHost;
	readonly stateStore: AppStateStore;
	readonly shellView: ShellView;
	private readonly overlayController: DefaultOverlayController;
	private readonly editorController: DefaultEditorController;
	private readonly commandController: DefaultCommandController;
	private readonly extensionUiHost: DefaultExtensionUiHost;
	private readonly startupController: DefaultStartupController;
	private readonly inputController: DefaultInputController;
	private previousRenderState = { hideThinking: false, toolOutputExpanded: false };
	private running = false;
	private focusedComponent: Component | null = null;
	private readonly authStorage: AuthStorage;
	private readonly modelRegistry: ModelRegistry;
	private appConfig: AppConfig;
	private readonly configPath: string;
	private readonly envApiKeyLookup: (providerId: string) => string | undefined;
	private hostInitialized = false;
	private setupFlowActive = false;
	private readonly animEngine: AnimationEngine;

	constructor(options: VibeAgentAppOptions = {}) {
		this.debugger =
			options.debugger ??
			createAppDebugger({
				appName: "vibe-agent",
				appRoot: process.cwd(),
			});
		this.stateStore = new DefaultAppStateStore();
		this.previousRenderState = this.stateStoreSnapshot();
		this.configPath = options.configPath ?? join(getAgentDir(), "vibe-agent-config.json");
		this.appConfig = AppConfig.load(this.configPath);
		this.authStorage = options.authStorage ?? AuthStorage.create();
		this.modelRegistry = new ModelRegistry(this.authStorage);
		this.envApiKeyLookup = options.getEnvApiKey ?? getEnvApiKey;
		initTheme("dark", false);

		// Apply persisted theme before creating UI
		if (this.appConfig.selectedTheme) {
			const validNames = getThemeNames() as string[];
			if (validNames.includes(this.appConfig.selectedTheme)) {
				setActiveTheme(this.appConfig.selectedTheme as ThemeName);
			}
		}

		this.animEngine = new AnimationEngine();
		setGlobalAnimationEngine(this.animEngine);

		this.host = options.host ?? createDefaultAgentHost(this.debugger, {
			createOptions: {
				authStorage: this.authStorage,
				modelRegistry: this.modelRegistry,
			},
			onSessionReady: async (session) => {
				await this.applyConfiguredModelToSession(session);
			},
		});
		const terminal = new MouseEnabledTerminal(options.terminal ?? new ProcessTerminal());
		this.shellView = new DefaultShellView(terminal, this.stateStore, () => this.safeGetHostState(), () => this.safeGetMessages(), () => this.host, this.animEngine);
		this.stateStore.setOnStatusChange((msg) => this.animEngine.setTypewriterTarget(msg));
		const keybindings = InternalKeybindingsManager.create();

		this.overlayController = new DefaultOverlayController(
			this.shellView.tui,
			this.stateStore,
			this.debugger,
			keybindings,
			() => this.editorController.getComponent(),
			(component, label) => this.setFocus(component, label),
		);

		let commandController!: DefaultCommandController;

		this.editorController = new DefaultEditorController(
			this.shellView.tui,
			keybindings,
			this.stateStore,
			this.debugger,
			{
				onOpenCommandPalette: () => commandController.openCommandPalette(),
				onAbort: () => {
					void this.host.abort().catch((error) => this.handleRuntimeError("abort", error));
				},
				onStop: () => this.stop(),
				isStreaming: () => this.safeGetHostState()?.isStreaming ?? false,
				onCycleThinkingLevel: () => {
					void this.host.cycleThinkingLevel().catch((error) => this.handleRuntimeError("cycleThinkingLevel", error));
				},
				onCycleModelForward: () => {
					void this.host
						.cycleModel("forward")
						.then(() => this.persistCurrentHostModelSelection())
						.catch((error) => this.handleRuntimeError("cycleModel.forward", error));
				},
				onCycleModelBackward: () => {
					void this.host
						.cycleModel("backward")
						.then(() => this.persistCurrentHostModelSelection())
						.catch((error) => this.handleRuntimeError("cycleModel.backward", error));
				},
				onSelectModel: () => {
					void this.openSetupFlow({ startStep: "model", showCompletion: false, reason: "model-choice-needed" });
				},
				onExpandTools: () => {
					this.stateStore.setToolOutputExpanded(!this.stateStore.getState().toolOutputExpanded);
					this.syncMessages();
				},
				onToggleThinking: () => {
					this.stateStore.setHideThinking(!this.stateStore.getState().hideThinking);
					this.syncMessages();
				},
				onSubmit: async (text, streamingBehavior) => {
					await this.submitEditor(text, streamingBehavior);
				},
			},
			(component) => {
				this.shellView.setEditor(component);
				this.setFocus(component, "editor");
			},
		);

		commandController = new DefaultCommandController(
			this.host,
			this.overlayController,
			this.editorController,
			this.stateStore,
			this.debugger,
			(reason) => this.writeDebugSnapshot(reason),
			this.shellView.footerData,
			() => this.shellView.clearMessages(),
			this.shellView,
			{
				openSetupHub: () => this.openSetupFlow({ startStep: "intro", showCompletion: true, reason: "first-run" }),
				openProviderSetup: () => this.openSetupFlow({ startStep: "provider", showCompletion: true, reason: "provider-choice-needed" }),
				openModelSetup: () => this.openSetupFlow({ startStep: "model", showCompletion: false, reason: "model-choice-needed" }),
				openLogoutFlow: () => this.openLogoutFlow(),
				setDefaultModel: async (providerId, modelId) => {
					await this.host.setModel(providerId, modelId);
					this.appConfig = {
						...this.appConfig,
						setupComplete: true,
						selectedProvider: providerId,
						selectedModelId: modelId,
					};
					AppConfig.save(this.appConfig, this.configPath);
					this.refreshCockpitContext();
				},
			},
		);
		this.commandController = commandController;

		this.shellView.setEditor(this.editorController.getComponent());
		this.setFocus(this.editorController.getComponent(), "editor");

		this.inputController = new DefaultInputController(
			this.shellView.tui,
			this.stateStore,
			this.overlayController,
			this.commandController,
			this.debugger,
			() => this.stop(),
			() => this.shellView.toggleSessionsPanel(),
		);

		this.extensionUiHost = new DefaultExtensionUiHost(
			this.shellView,
			this.stateStore,
			this.editorController,
			this.overlayController,
			this.commandController,
			this.debugger,
			keybindings,
			(handler) => this.inputController.registerTerminalInputHandler(handler),
			(component, label) => this.setFocus(component, label),
		);

		this.startupController = new DefaultStartupController(
			this.host,
			this.extensionUiHost,
			this.shellView,
			this.stateStore,
			this.debugger,
			(reason) => this.writeDebugSnapshot(reason),
		);

		this.shellView.tui.onDebug = () => {
			const bundleDir = this.writeDebugSnapshot("manual-hotkey");
			this.stateStore.setStatusMessage(bundleDir ? `Debug snapshot written to ${bundleDir}` : "Debug snapshot written.");
		};
		onThemeChange(() => this.shellView.tui.requestRender());
		onThemeConfigChange(() => {
			this.shellView.refresh();
			this.shellView.tui.requestRender();
		});
		this.stateStore.subscribe((state) => {
			if (
				state.hideThinking !== this.previousRenderState.hideThinking ||
				state.toolOutputExpanded !== this.previousRenderState.toolOutputExpanded
			) {
				this.syncMessages();
			}
			this.previousRenderState = {
				hideThinking: state.hideThinking,
				toolOutputExpanded: state.toolOutputExpanded,
			};
		});
		this.inputController.attach();
		this.refreshProviderAvailability();
		this.refreshCockpitContext();
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.debugger.log("app.start", { cwd: process.cwd() });
		this.shellView.setTitle("Vibe Agent");
		this.animEngine.start();
		this.shellView.start();
		void this.runStartupSequence().catch((error) => {
			this.debugger.logError("startup.sequence.error", error);
		});
	}

	private async runStartupSequence(): Promise<void> {
		const gate = this.assessStartupGate();
		if (gate.kind === "needs-provider") {
			await this.openSetupFlow({
				startStep: gate.reason === "first-run" ? "intro" : "provider",
				showCompletion: true,
				reason: gate.reason,
			});
		}

		try {
			await this.startupController.initialize();
			this.hostInitialized = true;
			this.normalizeConfigFromAssessment();
			this.refreshProviderAvailability();
			this.refreshCockpitContext();
			this.applyStartupValidationStatus();
		} catch {
			// startup controller handles its own error display
		}
	}

	private anyEnvApiKeySet(): boolean {
		const providers = ["anthropic", "openai", "google-antigravity", "openai-codex", "github-copilot", "google-gemini-cli"];
		return providers.some((id) => !!this.envApiKeyLookup(id));
	}

	private hasCredentialSource(): boolean {
		return this.authStorage.list().length > 0 || this.anyEnvApiKeySet();
	}

	stop(): void {
		if (!this.running) {
			return;
		}
		this.running = false;
		this.debugger.log("app.stop.start");
		this.animEngine.stop();
		this.startupController.dispose();
		this.overlayController.closeAllOverlays();
		void this.host
			.stop()
			.catch((error) => this.debugger.logError("app.stop.host", error))
			.finally(() => {
				this.shellView.stop();
				this.debugger.log("app.stop.end");
			});
	}

	writeDebugSnapshot(reason: string): string | undefined {
		try {
			const bundleDir = this.debugger.writeSnapshot({
				reason,
				tui: this.shellView.tui,
				messages: this.safeGetMessages(),
				hostState: this.safeGetHostState(),
				statusMessage: this.stateStore.getState().statusMessage,
				workingMessage: this.stateStore.getState().workingMessage,
				helpMessage: this.stateStore.getState().helpMessage,
				focusedComponent: this.focusedComponent,
				editorText: this.editorController.getText(),
				editorCursor: this.editorController.getCursor(),
			});
			this.debugger.log("app.snapshot.complete", { reason, bundleDir });
			return bundleDir;
		} catch (error) {
			this.debugger.logError("app.snapshot", error, { reason });
			return undefined;
		}
	}

	private async submitEditor(submittedText: string, streamingBehavior: "steer" | "followUp"): Promise<void> {
		const rawText = submittedText;
		const text = rawText.trim();
		this.debugger.log("editor.submit.attempt", {
			streamingBehavior,
			length: rawText.length,
			redacted: true,
		});
		if (!text) {
			return;
		}

		if (await this.commandController.handleSlashCommand(text)) {
			return;
		}

		this.editorController.addToHistory(text);
		this.editorController.setText("");
		await this.host.prompt(text, this.safeGetHostState()?.isStreaming ? { streamingBehavior } : undefined);
	}

	private syncMessages(): void {
		try {
			const renderResult = renderAgentMessages(this.host.getMessages(), {
				hideThinking: this.stateStore.getState().hideThinking,
				toolOutputExpanded: this.stateStore.getState().toolOutputExpanded,
				tui: this.shellView.tui,
			});
			this.shellView.setMessages(renderResult.components);

			// Sync artifacts
			const existingIds = new Set(this.stateStore.getState().artifacts.map((a) => a.id));
			for (const artifact of renderResult.artifacts) {
				if (!existingIds.has(artifact.id)) {
					this.stateStore.addArtifact(artifact);
				}
			}
		} catch (error) {
			this.handleRuntimeError("syncMessages", error);
		}
	}

	private setFocus(component: Component | null, label: string): void {
		this.focusedComponent = component;
		this.stateStore.setFocusLabel(label);
		this.shellView.setFocus(component);
	}

	private safeGetMessages() {
		try {
			return this.host.getMessages();
		} catch {
			return [];
		}
	}

	private safeGetHostState() {
		try {
			return this.host.getState();
		} catch {
			return undefined;
		}
	}

	private handleRuntimeError(context: string, error: unknown): void {
		this.debugger.logError(`runtime.${context}`, error);
		this.stateStore.setStatusMessage(`${context}: ${error instanceof Error ? error.message : String(error)}`);
	}

	private stateStoreSnapshot(): { hideThinking: boolean; toolOutputExpanded: boolean } {
		const state = this.stateStore.getState();
		return {
			hideThinking: state.hideThinking,
			toolOutputExpanded: state.toolOutputExpanded,
		};
	}

	private assessStartupGate(): StartupGateAssessment {
		if (this.hasCredentialSource()) {
			return { kind: "continue" };
		}
		return {
			kind: "needs-provider",
			reason: this.appConfig.setupComplete ? "disconnected" : "first-run",
		};
	}

	private validateSavedDefault(): SavedDefaultValidation {
		const providerId = this.appConfig.selectedProvider;
		if (!providerId) {
			return {
				kind: "invalid-provider",
				reason: "missing-provider",
			};
		}

		const modelId = this.appConfig.selectedModelId;
		if (!modelId) {
			return {
				kind: "invalid-model",
				providerId,
				reason: "missing-model",
			};
		}

		const availableModels = this.modelRegistry.getAvailable();
		if (availableModels.length === 0) {
			return {
				kind: "valid",
				providerId,
				modelId,
			};
		}

		const providerModels = availableModels.filter((model) => model.provider === providerId);
		if (providerModels.length === 0) {
			return {
				kind: "invalid-provider",
				reason: "saved-provider-unavailable",
			};
		}

		const savedModel = providerModels.find((model) => model.id === modelId);
		if (!savedModel) {
			return {
				kind: "invalid-model",
				providerId,
				reason: "saved-model-unavailable",
			};
		}

		return {
			kind: "valid",
			providerId,
			modelId: savedModel.id,
		};
	}

	private async openSetupFlow(request: SetupRunRequest): Promise<void> {
		this.setupFlowActive = true;
		const controller = new WelcomeController(
			this.shellView,
			this.authStorage,
			this.modelRegistry,
			this.appConfig,
			this.configPath,
			this.shellView.tui,
			{
				onConfigChange: (config) => {
					this.appConfig = config;
				},
				onStepChange: (_step, detail) => {
					this.stateStore.setContextBanner(detail?.title, detail?.message, detail?.tone);
				},
				applyModelSelection: async (providerId, modelId) => {
					if (this.hostInitialized) {
						await this.host.setModel(providerId, modelId);
					}
				},
			},
		);

		try {
			const result = await controller.run(request);
			this.refreshProviderAvailability();
			if (result.completed && result.selectedProvider && result.selectedModelId) {
				this.stateStore.setStatusMessage(`Default model set to ${result.selectedProvider}/${result.selectedModelId}.`);
			} else if (result.skipped) {
				this.stateStore.setStatusMessage("Setup skipped.");
			}
		} finally {
			this.setupFlowActive = false;
			this.shellView.setTitle("Vibe Agent");
			this.shellView.setEditor(this.editorController.getComponent());
			this.setFocus(this.editorController.getComponent(), "editor");
			this.refreshCockpitContext();
		}
	}

	private async openLogoutFlow(): Promise<void> {
		this.setupFlowActive = true;
		this.stateStore.setContextBanner("Disconnect provider", "Choose which provider to log out from.", "warning");

		await new Promise<void>((resolve) => {
			const selector = new OAuthSelectorComponent(
				"logout",
				this.authStorage,
				(providerId) => {
					this.handleLogoutProvider(providerId);
					resolve();
				},
				() => {
					this.stateStore.setStatusMessage("Logout cancelled.");
					resolve();
				},
			);

			this.shellView.setTitle("Vibe Agent · Logout");
			this.shellView.setEditor(selector);
			this.shellView.tui.setFocus(selector as any);
			this.shellView.tui.requestRender();
		});

		this.setupFlowActive = false;
		this.shellView.setTitle("Vibe Agent");
		this.shellView.setEditor(this.editorController.getComponent());
		this.setFocus(this.editorController.getComponent(), "editor");
		this.refreshCockpitContext();
	}

	private handleLogoutProvider(providerId: string): void {
		this.authStorage.logout(providerId);
		this.modelRegistry.refresh();

		const nextConfig: AppConfig = {
			...this.appConfig,
			selectedProvider: this.appConfig.selectedProvider === providerId ? undefined : this.appConfig.selectedProvider,
			selectedModelId: this.appConfig.selectedProvider === providerId ? undefined : this.appConfig.selectedModelId,
			setupComplete: false,
		};
		this.appConfig = nextConfig;
		AppConfig.save(nextConfig, this.configPath);

		this.refreshProviderAvailability();
		this.refreshCockpitContext();
		this.stateStore.setStatusMessage(`Logged out of ${providerId}.`);
	}

	private async applyConfiguredModelToSession(session: AgentSession): Promise<void> {
		const validation = this.validateSavedDefault();
		if (validation.kind !== "valid") {
			return;
		}
		const model = session.modelRegistry.find(validation.providerId, validation.modelId);
		if (!model) {
			return;
		}
		if (session.model?.provider === model.provider && session.model.id === model.id) {
			return;
		}
		await session.setModel(model);
	}

	private normalizeConfigFromAssessment(): void {
		const validation = this.validateSavedDefault();
		if (validation.kind !== "valid") {
			return;
		}
		if (
			this.appConfig.setupComplete
			&& this.appConfig.selectedProvider === validation.providerId
			&& this.appConfig.selectedModelId === validation.modelId
		) {
			return;
		}
		this.appConfig = {
			setupComplete: true,
			selectedProvider: validation.providerId,
			selectedModelId: validation.modelId,
		};
		AppConfig.save(this.appConfig, this.configPath);
	}

	private refreshProviderAvailability(): void {
		const providerCount = new Set(this.modelRegistry.getAvailable().map((model) => model.provider)).size;
		this.shellView.footerData.setAvailableProviderCount(providerCount);
	}

	private refreshCockpitContext(): void {
		if (this.setupFlowActive) {
			return;
		}
		const gate = this.assessStartupGate();
		const validation = this.validateSavedDefault();
		const hostState = this.safeGetHostState();
		const hasMessages = (hostState?.messageCount ?? 0) > 0;

		if (gate.kind === "needs-provider") {
			this.stateStore.setContextBanner(
				"Connect a provider",
				"Use /setup to connect Antigravity or OpenAI OAuth, then choose a default model.",
				"warning",
			);
			return;
		}
		if (validation.kind === "invalid-provider") {
			this.stateStore.setContextBanner(
				"Invalid Provider",
				validation.reason === "saved-provider-unavailable"
					? "The saved default provider is unavailable. Run /provider or /setup to select a valid provider."
					: "No default provider is saved. Run /provider or /setup to choose one.",
				"warning",
			);
			return;
		}
		if (validation.kind === "invalid-model") {
			this.stateStore.setContextBanner(
				"Invalid Model",
				validation.reason === "saved-model-unavailable"
					? `The saved model for ${validation.providerId} is unavailable. Run /model or /setup to select a replacement.`
					: `No default model is saved for ${validation.providerId}. Run /model or /setup to choose one.`,
				"warning",
			);
			return;
		}

		const helpMessage = this.stateStore.getState().helpMessage;
		if (helpMessage && !hasMessages) {
			this.stateStore.setContextBanner("Attention", helpMessage, "warning");
			return;
		}

		// No default help banner — status is shown in the logo info bar
		this.stateStore.setContextBanner(undefined, undefined);
	}

	private applyStartupValidationStatus(): void {
		const validation = this.validateSavedDefault();
		if (validation.kind === "invalid-provider") {
			this.stateStore.setStatusMessage("Invalid Provider");
			return;
		}
		if (validation.kind === "invalid-model") {
			this.stateStore.setStatusMessage("Invalid Model");
		}
	}

	private persistCurrentHostModelSelection(): void {
		const hostState = this.safeGetHostState();
		const providerId = hostState?.model?.provider;
		const modelId = hostState?.model?.id;
		if (!providerId || !modelId) {
			return;
		}
		this.appConfig = {
			...this.appConfig,
			setupComplete: true,
			selectedProvider: providerId,
			selectedModelId: modelId,
		};
		AppConfig.save(this.appConfig, this.configPath);
		this.refreshCockpitContext();
	}
}
