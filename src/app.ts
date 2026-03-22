import { ProcessTerminal, type Component } from "@mariozechner/pi-tui";
import { getEnvApiKey, stream, streamSimple, supportsXhigh, type ProviderStreamOptions } from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import { join } from "node:path";
import { AppLifecycleController } from "./app/app-lifecycle-controller.js";
import { AppMessageSyncService } from "./app/app-message-sync-service.js";
import { AppSetupService, type SavedDefaultValidation, type StartupGateAssessment } from "./app/app-setup-service.js";
import { createAppDebugger, type PiMonoAppDebugger } from "./app-debugger.js";
import { AppConfig } from "./app-config.js";
import { DefaultAppStateStore, type AppStateStore } from "./app-state-store.js";
import type { AgentHost } from "./agent-host.js";
import { AnimationEngine, setGlobalAnimationEngine } from "./animation-engine.js";
import { DefaultCommandController } from "./command-controller.js";
import { createDefaultAgentHost } from "./debug-agent-host.js";
import { ArtifactCatalogService } from "./durable/artifacts/artifact-catalog-service.js";
import { LogCatalogService } from "./durable/logs/log-catalog-service.js";
import { MemoryStoreService } from "./durable/memory/memory-store-service.js";
import { WorkbenchInventoryService } from "./durable/workbench-inventory-service.js";
import { DefaultEditorController } from "./editor-controller.js";
import { DirectAgentHost } from "./direct-agent-host.js";
import { DefaultExtensionUiHost } from "./extension-ui-host.js";
import { DefaultInputController } from "./input-controller.js";
import { MouseEnabledTerminal } from "./mouse-enabled-terminal.js";
import { DefaultOverlayController } from "./overlay-controller.js";
import { LogoBlockSystem } from "./logo-block-system.js";
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
	SessionManager,
	type AgentSession,
} from "./local-coding-agent.js";
import { CompatAgentRuntime } from "./runtime/compat-agent-runtime.js";
import { CoordinatedAgentHost } from "./runtime/coordinated-agent-host.js";
import { RuntimeCoordinator } from "./runtime/runtime-coordinator.js";
import { getRuntimeSessionDir } from "./runtime/runtime-session-namespace.js";
import { getThemeNames, onThemeConfigChange, setActiveTheme, type ThemeName } from "./themes/index.js";
import type { VibeAgentAppOptions } from "./types.js";
import { type SetupRunRequest, WelcomeController } from "./welcome-controller.js";

const OPENAI_REASONING_APIS = new Set(["openai-responses", "azure-openai-responses", "openai-codex-responses"]);

function createOpenAIReasoningSummaryStreamFn(): StreamFn {
	return (model, context, options) => {
		if (!OPENAI_REASONING_APIS.has(model.api) || !model.reasoning || !options?.reasoning) {
			return streamSimple(model, context, options);
		}

		const reasoningEffort =
			options.reasoning === "xhigh" && !supportsXhigh(model)
				? "high"
				: options.reasoning;

		const providerOptions: ProviderStreamOptions = {
			...options,
			reasoning: undefined,
			reasoningEffort,
			reasoningSummary: "detailed",
		};
		return stream(model, context, providerOptions);
	};
}

export class VibeAgentApp {
	readonly debugger: PiMonoAppDebugger;
	readonly host: AgentHost;
	readonly stateStore: AppStateStore;
	readonly shellView: ShellView;
	readonly runtimeCoordinator: RuntimeCoordinator;
	readonly artifactCatalog: ArtifactCatalogService;
	readonly memoryStoreService: MemoryStoreService;
	readonly logCatalogService: LogCatalogService;
	readonly inventoryService: WorkbenchInventoryService;
	private readonly overlayController: DefaultOverlayController;
	private readonly editorController: DefaultEditorController;
	private readonly commandController: DefaultCommandController;
	private readonly extensionUiHost: DefaultExtensionUiHost;
	private readonly startupController: DefaultStartupController;
	private readonly inputController: DefaultInputController;
	private readonly logoBlockSystem: LogoBlockSystem;
	private readonly terminal: MouseEnabledTerminal;
	private readonly authStorage: AuthStorage;
	private readonly modelRegistry: ModelRegistry;
	private readonly configPath: string;
	private readonly animEngine: AnimationEngine;
	private readonly setupService: AppSetupService;
	private readonly messageSync: AppMessageSyncService;
	private readonly lifecycle: AppLifecycleController;
	private appConfig: AppConfig;
	private previousRenderState = { showThinking: true, toolOutputExpanded: false };
	private bootLogoDismissed = false;
	private hostInitialized = false;
	private setupFlowActive = false;

	constructor(options: VibeAgentAppOptions = {}) {
		this.debugger =
			options.debugger ??
			createAppDebugger({
				appName: "vibe-agent",
				appRoot: process.cwd(),
			});
		this.stateStore = new DefaultAppStateStore();
		this.configPath = options.configPath ?? join(getAgentDir(), "vibe-agent-config.json");
		this.appConfig = AppConfig.load(this.configPath);
		this.stateStore.setShowThinking(this.appConfig.showThinking ?? true);
		this.previousRenderState = this.stateStoreSnapshot();
		this.authStorage = options.authStorage ?? AuthStorage.create();
		this.modelRegistry = new ModelRegistry(this.authStorage);
		this.setupService = new AppSetupService(this.authStorage, this.modelRegistry, options.getEnvApiKey ?? getEnvApiKey);
		initTheme("dark", false);

		if (this.appConfig.selectedTheme) {
			const validNames = getThemeNames() as string[];
			if (validNames.includes(this.appConfig.selectedTheme)) {
				setActiveTheme(this.appConfig.selectedTheme as ThemeName);
			}
		}

		this.animEngine = new AnimationEngine();
		setGlobalAnimationEngine(this.animEngine);

		const innerHost =
			options.host ??
			createDefaultAgentHost(this.debugger, {
				createOptions: {
					authStorage: this.authStorage,
					modelRegistry: this.modelRegistry,
					streamFn: createOpenAIReasoningSummaryStreamFn(),
				},
				onSessionReady: async (session) => {
					await this.applyConfiguredModelToSession(session);
				},
			});
		const orcHost = new DirectAgentHost({
			createOptions: {
				authStorage: this.authStorage,
				modelRegistry: this.modelRegistry,
				streamFn: createOpenAIReasoningSummaryStreamFn(),
				sessionManager: SessionManager.create(process.cwd(), getRuntimeSessionDir("orc")),
			},
			onSessionReady: async (session) => {
				await this.applyConfiguredModelToSession(session);
			},
		});

		this.runtimeCoordinator =
			options.runtimeCoordinator ??
			new RuntimeCoordinator(
				options.runtimes ?? [
					new CompatAgentRuntime(
						{
							id: "coding",
							kind: "coding",
							displayName: "Coding Runtime",
							capabilities: ["interactive-prompt", "session-management", "model-selection", "artifact-source", "log-source"],
							primary: true,
						},
						innerHost,
					),
					new CompatAgentRuntime(
						{
							id: "orc",
							kind: "orchestration",
							displayName: "Orc",
							capabilities: ["interactive-prompt", "session-management", "planning", "checkpoint-visibility", "orchestration-status"],
						},
						orcHost,
					),
				],
				{
					onRuntimeError: (runtimeId, phase, error) => {
						this.debugger.logError(`runtime.${phase}.${runtimeId}`, error);
					},
				},
			);
		this.host = new CoordinatedAgentHost(this.runtimeCoordinator);
		this.artifactCatalog = options.artifactCatalog ?? new ArtifactCatalogService();
		this.memoryStoreService = options.memoryStoreService ?? new MemoryStoreService();
		this.logCatalogService = options.logCatalogService ?? new LogCatalogService();
		this.inventoryService =
			options.inventoryService
			?? new WorkbenchInventoryService(this.artifactCatalog, this.memoryStoreService, this.logCatalogService);

		this.terminal = new MouseEnabledTerminal(options.terminal ?? new ProcessTerminal());
		this.shellView = new DefaultShellView(
			this.terminal,
			this.stateStore,
			() => this.safeGetHostState(),
			() => this.safeGetMessages(),
			() => this.host,
			this.animEngine,
		);
		this.logoBlockSystem = new LogoBlockSystem(this.terminal.columns, (lines) => {
			this.shellView.setSplashFrame(lines);
		});
		this.terminal.setResizeHandler(() => {
			this.logoBlockSystem.resize(this.terminal.columns, this.terminal.rows);
		});
		this.stateStore.setOnStatusChange((msg) => this.animEngine.setTypewriterTarget(msg));
		const keybindings = InternalKeybindingsManager.create();

		this.messageSync = new AppMessageSyncService(
			this.host,
			this.shellView,
			this.stateStore,
			this.artifactCatalog,
			this.inventoryService,
			() => this.getRuntimeContext(),
		);

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
					this.setThinkingVisibility(!this.stateStore.getState().showThinking);
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
			this.inventoryService,
			{
				openSetupHub: () => this.openSetupFlow({ startStep: "intro", showCompletion: true, reason: "first-run" }),
				openProviderSetup: () => this.openSetupFlow({ startStep: "provider", showCompletion: true, reason: "provider-choice-needed" }),
				openModelSetup: () => this.openSetupFlow({ startStep: "model", showCompletion: false, reason: "model-choice-needed" }),
				openLogoutFlow: () => this.openLogoutFlow(),
				setDefaultModel: async (providerId, modelId) => {
					await this.host.setModel(providerId, modelId);
					this.persistConfig({
						...this.appConfig,
						setupComplete: true,
						selectedProvider: providerId,
						selectedModelId: modelId,
					});
					this.refreshCockpitContext();
				},
				setThinkingVisibility: (show) => this.setThinkingVisibility(show),
			},
			() => this.handleRuntimeActivated(),
		);
		this.commandController = commandController;
		this.syncRuntimeDisplayState();

		this.shellView.setEditor(this.editorController.getComponent());
		this.inputController = new DefaultInputController(
			this.shellView.tui,
			this.stateStore,
			this.overlayController,
			this.commandController,
			this.shellView,
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
			this.messageSync,
		);

		this.lifecycle = new AppLifecycleController(
			this.shellView,
			this.stateStore,
			this.debugger,
			this.animEngine,
			this.logoBlockSystem,
			this.startupController,
			this.overlayController,
			this.host,
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
				state.showThinking !== this.previousRenderState.showThinking ||
				state.toolOutputExpanded !== this.previousRenderState.toolOutputExpanded
			) {
				this.syncMessages();
			}
			this.previousRenderState = {
				showThinking: state.showThinking,
				toolOutputExpanded: state.toolOutputExpanded,
			};
		});
		this.inputController.attach();
		this.refreshProviderAvailability();
		this.refreshCockpitContext();
		this.setFocus(this.editorController.getComponent(), "editor");
	}

	start(): void {
		this.bootLogoDismissed = false;
		this.lifecycle.start(async () => await this.runStartupSequence());
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

	stop(): void {
		this.lifecycle.stop();
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
				focusedComponent: this.lifecycle.getFocusedComponent(),
				editorText: this.editorController.getText(),
				editorCursor: this.editorController.getCursor(),
			});
			if (bundleDir) {
				this.logCatalogService.registerLog({
					ownerRuntimeId: this.getRuntimeContext().runtimeId,
					sessionId: this.safeGetHostState()?.sessionId,
					sourcePath: bundleDir,
					logType: "debug-snapshot",
					label: "Debug Snapshot",
					reason,
				});
			}
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
		if (!this.bootLogoDismissed) {
			this.bootLogoDismissed = true;
			this.logoBlockSystem.dismiss();
		}
		await this.host.prompt(text, this.safeGetHostState()?.isStreaming ? { streamingBehavior } : undefined);
	}

	private syncMessages(): void {
		try {
			this.messageSync.sync();
		} catch (error) {
			this.handleRuntimeError("syncMessages", error);
		}
	}

	private setFocus(component: Component | null, label: string): void {
		this.lifecycle.setFocus(component, label);
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
		this.lifecycle.handleRuntimeError(context, error);
	}

	private stateStoreSnapshot(): { showThinking: boolean; toolOutputExpanded: boolean } {
		const state = this.stateStore.getState();
		return {
			showThinking: state.showThinking,
			toolOutputExpanded: state.toolOutputExpanded,
		};
	}

	private setThinkingVisibility(show: boolean): void {
		this.stateStore.setShowThinking(show);
		this.persistConfig({
			...this.appConfig,
			showThinking: show,
		});
		this.stateStore.setStatusMessage(show ? "Thinking tray enabled." : "Thinking tray hidden.");
	}

	private assessStartupGate(): StartupGateAssessment {
		return this.setupService.assessStartupGate(this.appConfig);
	}

	private validateSavedDefault(): SavedDefaultValidation {
		return this.setupService.validateSavedDefault(this.appConfig);
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
			this.syncRuntimeDisplayState();
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
		this.syncRuntimeDisplayState();
		this.refreshCockpitContext();
	}

	private handleLogoutProvider(providerId: string): void {
		this.authStorage.logout(providerId);
		this.modelRegistry.refresh();

		this.persistConfig({
			...this.appConfig,
			selectedProvider: this.appConfig.selectedProvider === providerId ? undefined : this.appConfig.selectedProvider,
			selectedModelId: this.appConfig.selectedProvider === providerId ? undefined : this.appConfig.selectedModelId,
			setupComplete: false,
		});

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
		const normalized = this.setupService.normalizeConfig(this.appConfig, this.safeGetHostState());
		if (normalized) {
			this.persistConfig(normalized);
		}
	}

	private refreshProviderAvailability(): void {
		this.shellView.footerData.setAvailableProviderCount(this.setupService.countAvailableProviders());
	}

	private refreshCockpitContext(): void {
		if (this.setupFlowActive) {
			return;
		}
		const gate = this.assessStartupGate();
		const validation = this.validateSavedDefault();
		const hostState = this.safeGetHostState();
		const hostSelection = this.setupService.getActiveHostSelection(hostState);
		const hasMessages = (hostState?.messageCount ?? 0) > 0;

		if (gate.kind === "needs-provider") {
			this.stateStore.setContextBanner(
				"Connect a provider",
				"Use /setup to connect Antigravity or OpenAI OAuth, then choose a default model.",
				"warning",
			);
			return;
		}
		if (!hostSelection && validation.kind === "invalid-provider") {
			this.stateStore.setContextBanner(
				"Invalid Provider",
				validation.reason === "saved-provider-unavailable"
					? "The saved default provider is unavailable. Run /provider or /setup to select a valid provider."
					: "No default provider is saved. Run /provider or /setup to choose one.",
				"warning",
			);
			return;
		}
		if (!hostSelection && validation.kind === "invalid-model") {
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

		this.stateStore.setContextBanner(undefined, undefined);
	}

	private applyStartupValidationStatus(): void {
		if (this.setupService.getActiveHostSelection(this.safeGetHostState())) {
			return;
		}
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
		this.persistConfig({
			...this.appConfig,
			setupComplete: true,
			selectedProvider: providerId,
			selectedModelId: modelId,
		});
		this.refreshCockpitContext();
	}

	private persistConfig(config: AppConfig): void {
		this.appConfig = config;
		AppConfig.save(config, this.configPath);
	}

	private handleRuntimeActivated(): void {
		this.stateStore.resetActiveThinking();
		this.syncRuntimeDisplayState();
		this.syncMessages();
		this.refreshProviderAvailability();
		this.refreshCockpitContext();
	}

	private syncRuntimeDisplayState(): void {
		try {
			const descriptor = this.host.getActiveRuntimeDescriptor();
			const conversationLabel = descriptor.id === "orc" ? "Orc orchestration chat" : "Coding chat";
			this.stateStore.setActiveRuntime({
				id: descriptor.id,
				name: descriptor.displayName,
				conversationLabel,
			});
			this.shellView.footerData.setSessionMode(conversationLabel);
		} catch {
			this.stateStore.setActiveRuntime({ id: "coding", name: "Coding Runtime", conversationLabel: "Coding chat" });
			this.shellView.footerData.setSessionMode("Coding chat");
		}
	}

	private getRuntimeContext(): { runtimeId: string; sessionId?: string } {
		try {
			return {
				runtimeId: this.runtimeCoordinator.getActiveRuntime().descriptor.id,
				sessionId: this.safeGetHostState()?.sessionId,
			};
		} catch {
			return {
				runtimeId: "coding",
				sessionId: this.safeGetHostState()?.sessionId,
			};
		}
	}
}
