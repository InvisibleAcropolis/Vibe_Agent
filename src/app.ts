import { ProcessTerminal, type Component } from "@mariozechner/pi-tui";
import { getEnvApiKey } from "@mariozechner/pi-ai";
import { AppConfigRepository } from "./app/app-config-repository.js";
import { AppDebugSnapshotService } from "./app/app-debug-snapshot-service.js";
import { AppLifecycleController } from "./app/app-lifecycle-controller.js";
import { AppMessageSyncService } from "./app/app-message-sync-service.js";
import { AppRuntimeFactoryResult, createAppRuntimeFactory } from "./app/app-runtime-factory.js";
import { AppRuntimePresentation } from "./app/app-runtime-presentation.js";
import { AppSessionCoordinator } from "./app/app-session-coordinator.js";
import { AppSetupService } from "./app/app-setup-service.js";
import { AppSubmissionService } from "./app/app-submission-service.js";
import { createAppDebugger, type PiMonoAppDebugger } from "./app-debugger.js";
import { DefaultAppStateStore, type AppStateStore } from "./app-state-store.js";
import type { AgentHost } from "./agent-host.js";
import { AnimationEngine, setGlobalAnimationEngine } from "./animation-engine.js";
import { DefaultCommandController } from "./command-controller.js";
import { ArtifactCatalogService } from "./durable/artifacts/artifact-catalog-service.js";
import { ensureVibeDurableStorage, getVibeConfigPath, getVibeDurableRoot } from "./durable/durable-paths.js";
import { LogCatalogService } from "./durable/logs/log-catalog-service.js";
import { MemoryStoreService } from "./durable/memory/memory-store-service.js";
import { WorkbenchInventoryService } from "./durable/workbench-inventory-service.js";
import { DefaultEditorController } from "./editor-controller.js";
import { DefaultExtensionUiHost } from "./extension-ui-host.js";
import { DefaultInputController } from "./input-controller.js";
import {
	initTheme,
	KeybindingsManager as InternalKeybindingsManager,
	onThemeChange,
} from "./local-coding-agent.js";
import { MouseEnabledTerminal } from "./mouse-enabled-terminal.js";
import { DefaultOverlayController } from "./overlay-controller.js";
import { LogoBlockSystem } from "./logo-block-system.js";
import { DefaultShellView, type ShellView } from "./shell-view.js";
import { DefaultStartupController } from "./startup-controller.js";
import { getThemeNames, onThemeConfigChange, setActiveTheme, type ThemeName } from "./themes/index.js";
import type { VibeAgentAppOptions } from "./types.js";

export class VibeAgentApp {
	readonly debugger: PiMonoAppDebugger;
	readonly host: AgentHost;
	readonly stateStore: AppStateStore;
	readonly shellView: ShellView;
	readonly runtimeCoordinator: AppRuntimeFactoryResult["runtimeCoordinator"];
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
	private readonly animEngine: AnimationEngine;
	private readonly lifecycle: AppLifecycleController;
	private readonly messageSync: AppMessageSyncService;
	private readonly configRepository: AppConfigRepository;
	private readonly sessionCoordinator: AppSessionCoordinator;
	private readonly runtimePresentation: AppRuntimePresentation;
	private readonly debugSnapshotService: AppDebugSnapshotService;
	private readonly submissionService: AppSubmissionService;
	private previousRenderState = { showThinking: true, toolOutputExpanded: false };
	private hostInitialized = false;

	constructor(options: VibeAgentAppOptions = {}) {
		this.debugger =
			options.debugger ??
			createAppDebugger({
				appName: "vibe-agent",
				appRoot: process.cwd(),
			});

		this.stateStore = new DefaultAppStateStore();
		const durableRootPath = options.durableRootPath ?? getVibeDurableRoot();
		ensureVibeDurableStorage({ durableRoot: durableRootPath });

		this.configRepository = new AppConfigRepository(
			options.configPath ?? getVibeConfigPath("vibe-agent-config.json", { durableRoot: durableRootPath }),
		);
		this.stateStore.setShowThinking(this.configRepository.get().showThinking ?? true);
		this.previousRenderState = this.stateStoreSnapshot();

		let sessionCoordinator!: AppSessionCoordinator;
		const runtimeFactory = createAppRuntimeFactory({
			host: options.host,
			runtimes: options.runtimes,
			runtimeCoordinator: options.runtimeCoordinator,
			authStorage: options.authStorage,
			getEnvApiKey: options.getEnvApiKey,
			debuggerSink: this.debugger,
			durableRootPath,
			onSessionReady: async (session) => {
				await sessionCoordinator.applyConfiguredModelToSession(session);
			},
		});

		this.runtimeCoordinator = runtimeFactory.runtimeCoordinator;
		this.host = runtimeFactory.host;

		const setupService = new AppSetupService(
			runtimeFactory.authStorage,
			runtimeFactory.modelRegistry,
			options.getEnvApiKey ?? getEnvApiKey,
		);

		initTheme("dark", false);
		if (this.configRepository.get().selectedTheme) {
			const validNames = getThemeNames() as string[];
			if (validNames.includes(this.configRepository.get().selectedTheme as string)) {
				setActiveTheme(this.configRepository.get().selectedTheme as ThemeName);
			}
		}

		this.animEngine = new AnimationEngine();
		setGlobalAnimationEngine(this.animEngine);

		this.artifactCatalog = options.artifactCatalog ?? new ArtifactCatalogService({ durableRoot: durableRootPath });
		this.memoryStoreService = options.memoryStoreService ?? new MemoryStoreService({ durableRoot: durableRootPath });
		this.logCatalogService = options.logCatalogService ?? new LogCatalogService({ durableRoot: durableRootPath });
		this.inventoryService =
			options.inventoryService
			?? new WorkbenchInventoryService(this.artifactCatalog, this.memoryStoreService, this.logCatalogService, { durableRoot: durableRootPath });

		this.terminal = new MouseEnabledTerminal(options.terminal ?? new ProcessTerminal());
		this.shellView = new DefaultShellView(
			this.terminal,
			this.stateStore,
			() => this.safeGetHostState(),
			() => this.safeGetMessages(),
			() => this.host,
			this.animEngine,
		);
		const psmuxRuntimeLabel = this.shellView.footerData.getPsmuxRuntimeLabel();
		this.shellView.setTitle(psmuxRuntimeLabel ? `Vibe Agent - ${psmuxRuntimeLabel}` : "Vibe Agent");
		this.logoBlockSystem = new LogoBlockSystem(this.terminal.columns, (lines) => {
			this.shellView.setSplashFrame(lines);
		});
		this.terminal.setResizeHandler(() => {
			this.logoBlockSystem.resize(this.terminal.columns, this.terminal.rows);
		});
		this.stateStore.setOnStatusChange((message) => this.animEngine.setTypewriterTarget(message));

		let runtimePresentation!: AppRuntimePresentation;
		this.messageSync = new AppMessageSyncService(
			this.host,
			this.shellView,
			this.stateStore,
			this.artifactCatalog,
			this.inventoryService,
			() => runtimePresentation.getRuntimeContext(),
		);

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
						.then(() => {
							sessionCoordinator.persistCurrentHostModelSelection(this.safeGetHostState());
							runtimePresentation.refreshCockpitContext();
						})
						.catch((error) => this.handleRuntimeError("cycleModel.forward", error));
				},
				onCycleModelBackward: () => {
					void this.host
						.cycleModel("backward")
						.then(() => {
							sessionCoordinator.persistCurrentHostModelSelection(this.safeGetHostState());
							runtimePresentation.refreshCockpitContext();
						})
						.catch((error) => this.handleRuntimeError("cycleModel.backward", error));
				},
				onSelectModel: () => {
					void sessionCoordinator.openSetupFlow({ startStep: "model", showCompletion: false, reason: "model-choice-needed" });
				},
				onExpandTools: () => {
					this.stateStore.setToolOutputExpanded(!this.stateStore.getState().toolOutputExpanded);
					this.syncMessages();
				},
				onToggleThinking: () => {
					sessionCoordinator.setThinkingVisibility(!this.stateStore.getState().showThinking);
				},
				onSubmit: async (text, streamingBehavior) => {
					await this.submissionService.submitEditor(text, streamingBehavior);
				},
			},
			(component) => {
				this.shellView.setEditor(component);
				this.setFocus(component, "editor");
			},
		);

		sessionCoordinator = new AppSessionCoordinator({
			shellView: this.shellView,
			stateStore: this.stateStore,
			footerData: this.shellView.footerData,
			host: this.host,
			authStorage: runtimeFactory.authStorage,
			modelRegistry: runtimeFactory.modelRegistry,
			configRepository: this.configRepository,
			setupService,
			getHostState: () => this.safeGetHostState(),
			getEditorComponent: () => this.editorController.getComponent(),
			restoreEditor: () => {
				this.shellView.setEditor(this.editorController.getComponent());
				this.setFocus(this.editorController.getComponent(), "editor");
			},
			isHostInitialized: () => this.hostInitialized,
			onInteractiveFlowComplete: () => {
				runtimePresentation.syncRuntimeDisplayState();
				runtimePresentation.refreshCockpitContext();
			},
		});
		this.sessionCoordinator = sessionCoordinator;

		runtimePresentation = new AppRuntimePresentation({
			stateStore: this.stateStore,
			footerData: this.shellView.footerData,
			host: this.host,
			runtimeCoordinator: this.runtimeCoordinator,
			sessionCoordinator: this.sessionCoordinator,
			getHostState: () => this.safeGetHostState(),
			syncMessages: () => this.syncMessages(),
		});
		this.runtimePresentation = runtimePresentation;

		commandController = new DefaultCommandController({
			host: this.host,
			overlayController: this.overlayController,
			editorController: this.editorController,
			stateStore: this.stateStore,
			debuggerSink: this.debugger,
			writeDebugSnapshot: (reason) => this.writeDebugSnapshot(reason),
			footerData: this.shellView.footerData,
			clearMessages: () => this.shellView.clearMessages(),
			shellView: this.shellView,
			inventory: this.inventoryService,
			setupActions: {
				openSetupHub: () => this.sessionCoordinator.openSetupFlow({ startStep: "intro", showCompletion: true, reason: "first-run" }),
				openProviderSetup: () => this.sessionCoordinator.openSetupFlow({ startStep: "provider", showCompletion: true, reason: "provider-choice-needed" }),
				openModelSetup: () => this.sessionCoordinator.openSetupFlow({ startStep: "model", showCompletion: false, reason: "model-choice-needed" }),
				openLogoutFlow: () => this.sessionCoordinator.openLogoutFlow(),
				setDefaultModel: async (providerId, modelId) => {
					await this.host.setModel(providerId, modelId);
					this.sessionCoordinator.saveConfig({
						...this.sessionCoordinator.getConfig(),
						setupComplete: true,
						selectedProvider: providerId,
						selectedModelId: modelId,
					});
					this.runtimePresentation.refreshCockpitContext();
				},
				setThinkingVisibility: (show) => this.sessionCoordinator.setThinkingVisibility(show),
			},
			configStore: {
				getConfig: () => this.sessionCoordinator.getConfig(),
				saveConfig: (config) => this.sessionCoordinator.saveConfig(config),
			},
			onRuntimeActivated: () => this.runtimePresentation.handleRuntimeActivated(),
		});
		this.commandController = commandController;

		let lifecycle!: AppLifecycleController;
		this.debugSnapshotService = new AppDebugSnapshotService({
			debuggerSink: this.debugger,
			shellView: this.shellView,
			stateStore: this.stateStore,
			editorController: this.editorController,
			logCatalogService: this.logCatalogService,
			getMessages: () => this.safeGetMessages(),
			getHostState: () => this.safeGetHostState(),
			getFocusedComponent: () => lifecycle.getFocusedComponent(),
			getRuntimeContext: () => this.runtimePresentation.getRuntimeContext(),
		});

		this.submissionService = new AppSubmissionService({
			debuggerSink: this.debugger,
			host: this.host,
			editorController: this.editorController,
			logoBlockSystem: this.logoBlockSystem,
			handleSlashCommand: async (text) => await this.commandController.handleSlashCommand(text),
			getHostState: () => this.safeGetHostState(),
		});

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

		lifecycle = new AppLifecycleController(
			this.shellView,
			this.stateStore,
			this.debugger,
			this.animEngine,
			this.logoBlockSystem,
			this.startupController,
			this.overlayController,
			this.host,
		);
		this.lifecycle = lifecycle;

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
		this.runtimePresentation.syncRuntimeDisplayState();
		this.sessionCoordinator.refreshProviderAvailability();
		this.runtimePresentation.refreshCockpitContext();
		this.setFocus(this.editorController.getComponent(), "editor");
	}

	start(): void {
		this.submissionService.resetForStart();
		this.lifecycle.start(async () => await this.runStartupSequence());
	}

	stop(): void {
		this.lifecycle.stop();
	}

	writeDebugSnapshot(reason: string): string | undefined {
		return this.debugSnapshotService.write(reason);
	}

	private async runStartupSequence(): Promise<void> {
		const gate = this.sessionCoordinator.assessStartupGate();
		if (gate.kind === "needs-provider") {
			await this.sessionCoordinator.openSetupFlow({
				startStep: gate.reason === "first-run" ? "intro" : "provider",
				showCompletion: true,
				reason: gate.reason,
			});
		}

		try {
			await this.startupController.initialize();
			this.hostInitialized = true;
			this.sessionCoordinator.normalizeConfigFromAssessment(this.safeGetHostState());
			this.sessionCoordinator.refreshProviderAvailability();
			this.runtimePresentation.refreshCockpitContext();
			this.runtimePresentation.applyStartupValidationStatus();
		} catch {
			// startup controller handles its own error display
		}
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
}
