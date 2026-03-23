import type { PiMonoAppDebugger } from "./app-debugger.js";
import type { AppStateStore } from "./app-state-store.js";
import type { AgentHost, AgentHostState } from "./agent-host.js";
import type { EditorController } from "./editor-controller.js";
import type { FooterDataProvider } from "./footer-data-provider.js";
import type { OverlayController } from "./overlay-controller.js";
import type { ShellView } from "./shell-view.js";
import { WorkbenchInventoryService } from "./durable/workbench-inventory-service.js";
import { CommandMenuBuilder } from "./command/command-menu-builder.js";
import { CommandOverlayService } from "./command/command-overlay-service.js";
import { CommandSelectionService } from "./command/command-selection-service.js";
import { CommandThemePreferencesService } from "./command/command-theme-preferences-service.js";
import { SlashCommandRouter } from "./command/slash-command-router.js";
import type { CommandConfigStore, SetupActions } from "./command/command-types.js";

export interface CommandController {
	handleSlashCommand(text: string): Promise<boolean>;
	openCommandPalette(): void;
	openModelSelector(): Promise<void>;
	openThinkingSelector(): void;
	openSessionSelector(scope: "current" | "all"): void;
	openForkSelector(): Promise<void>;
	openTreeSelector(): Promise<void>;
	openSettingsOverlay(): void;
	openSessionsOverlay(): void;
	openOrchestrationOverlay(): void;
	openOrcDashboard(): void;
	summonOrc(): Promise<void>;
	resumeOrcThread(): void;
	inspectOrcCheckpoints(): void;
	rewindOrcCheckpoint(): void;
	returnToCodingChat(): Promise<void>;
	openStatsOverlay(): void;
	openArtifactViewer(): void;
	openHelpOverlay(): void;
}

export class DefaultCommandController implements CommandController {
	private readonly selectionService: CommandSelectionService;
	private readonly themePreferences: CommandThemePreferencesService;
	private readonly overlayService: CommandOverlayService;
	private readonly menuBuilder: CommandMenuBuilder;
	private readonly slashRouter: SlashCommandRouter;

	constructor(
		private readonly dependencies: {
			host: AgentHost;
			overlayController: OverlayController;
			editorController: EditorController;
			stateStore: AppStateStore;
			debuggerSink: PiMonoAppDebugger;
			writeDebugSnapshot: (reason: string) => string | undefined;
			footerData: FooterDataProvider;
			clearMessages: () => void;
			shellView: ShellView;
			inventory: WorkbenchInventoryService;
			setupActions: SetupActions;
			configStore: CommandConfigStore;
			onRuntimeActivated: () => void;
		},
	) {
		this.selectionService = new CommandSelectionService({
			host: this.dependencies.host,
			overlayController: this.dependencies.overlayController,
			editorController: this.dependencies.editorController,
			debuggerSink: this.dependencies.debuggerSink,
			onError: (context, error, details) => this.handleError(context, error, details),
		});
		this.themePreferences = new CommandThemePreferencesService({
			stateStore: this.dependencies.stateStore,
			configStore: this.dependencies.configStore,
		});
		this.overlayService = new CommandOverlayService({
			host: this.dependencies.host,
			overlayController: this.dependencies.overlayController,
			stateStore: this.dependencies.stateStore,
			footerData: this.dependencies.footerData,
			inventory: this.dependencies.inventory,
			getHostState: () => this.safeGetHostState(),
			onError: (context, error, details) => this.handleError(context, error, details),
		});
		this.menuBuilder = new CommandMenuBuilder({
			stateStore: this.dependencies.stateStore,
			shellView: this.dependencies.shellView,
		});
		this.slashRouter = new SlashCommandRouter({
			host: this.dependencies.host,
			editorController: this.dependencies.editorController,
			stateStore: this.dependencies.stateStore,
			debuggerSink: this.dependencies.debuggerSink,
			setupActions: this.dependencies.setupActions,
			clearMessages: this.dependencies.clearMessages,
			handleThemeCommand: (text) => this.themePreferences.handleThemeCommand(text),
			writeSnapshotAndStatus: (reason) => this.writeSnapshotAndStatus(reason),
			actions: {
				openSettingsOverlay: () => this.openSettingsOverlay(),
				openSessionSelector: (scope) => this.openSessionSelector(scope),
				openForkSelector: async () => await this.openForkSelector(),
				openTreeSelector: async () => await this.openTreeSelector(),
				openThinkingSelector: () => this.openThinkingSelector(),
				openStatsOverlay: () => this.openStatsOverlay(),
				openArtifactViewer: () => this.openArtifactViewer(),
				openHelpOverlay: () => this.openHelpOverlay(),
				summonOrc: async () => await this.summonOrc(),
				resumeOrcThread: () => this.resumeOrcThread(),
				inspectOrcCheckpoints: () => this.inspectOrcCheckpoints(),
				rewindOrcCheckpoint: () => this.rewindOrcCheckpoint(),
				onError: (context, error, details) => this.handleError(context, error, details),
			},
		});
	}

	async handleSlashCommand(text: string): Promise<boolean> {
		return await this.slashRouter.handle(text);
	}

	openCommandPalette(): void {
		this.selectionService.openCommandPalette();
	}

	async openModelSelector(): Promise<void> {
		await this.dependencies.setupActions.openModelSetup();
	}

	openThinkingSelector(): void {
		this.selectionService.openThinkingSelector();
	}

	openSessionSelector(scope: "current" | "all"): void {
		this.selectionService.openSessionSelector(scope);
	}

	async openForkSelector(): Promise<void> {
		await this.selectionService.openForkSelector();
	}

	async openTreeSelector(): Promise<void> {
		await this.selectionService.openTreeSelector();
	}

	openSettingsOverlay(): void {
		void this.dependencies.host
			.getAvailableModels()
			.then((models) => {
				const themeItems = this.themePreferences.createMenuItems();
				const modelItems = this.menuBuilder.buildModelMenuItems({
					models,
					onSelectModel: async (providerId, modelId) => {
						await this.dependencies.setupActions.setDefaultModel(providerId, modelId);
						this.dependencies.stateStore.setStatusMessage(`Default model set to ${providerId}/${modelId}.`);
					},
					onError: (context, error, details) => this.handleError(context, error, details),
					onNoModels: () => this.dependencies.stateStore.setStatusMessage("No models available."),
				});
				const thinkingItems = this.menuBuilder.buildThinkingMenuItems({
					levels: this.dependencies.host.getAvailableThinkingLevels(),
					onSelect: (level) => {
						void this.dependencies.host.setThinkingLevel(level as AgentHostState["thinkingLevel"]).catch((error) => this.handleError("setThinkingLevel", error));
					},
				});
				this.dependencies.overlayController.openMenuOverlay(
					"menu-settings",
					this.menuBuilder.buildSettingsMenu({
						modelItems,
						themeItems,
						thinkingItems,
						onAction: (action) => this.runSettingsAction(action),
					}),
				);
			})
			.catch((error) => this.handleError("openSettingsOverlay", error));
	}

	openSessionsOverlay(): void {
		this.dependencies.overlayController.openMenuOverlay(
			"menu-sessions",
			this.menuBuilder.buildSessionsMenu({
				onAction: (action) => {
					switch (action) {
						case "resume":
							this.openSessionSelector("all");
							break;
						case "fork":
							void this.openForkSelector().catch((error) => this.handleError("openForkSelector", error));
							break;
						case "tree":
							void this.openTreeSelector().catch((error) => this.handleError("openTreeSelector", error));
							break;
						case "stats":
							this.openStatsOverlay();
							break;
						case "new":
							this.runSettingsAction("new");
							break;
					}
				},
			}),
		);
	}

	openOrchestrationOverlay(): void {
		this.dependencies.overlayController.openMenuOverlay(
			"menu-orc",
			this.menuBuilder.buildOrchestrationMenu({
				onAction: (action) => {
					switch (action) {
						case "summon-orc":
							void this.summonOrc().catch((error) => this.handleError("summonOrc", error));
							break;
						case "dashboard":
							this.openOrcDashboard();
							break;
						case "coding-chat":
							void this.returnToCodingChat().catch((error) => this.handleError("returnToCodingChat", error));
							break;
						case "orc-resume":
							this.resumeOrcThread();
							break;
						case "orc-checkpoints":
							this.inspectOrcCheckpoints();
							break;
						case "orc-rewind":
							this.rewindOrcCheckpoint();
							break;
						case "tracker":
							this.overlayService.openOrchestrationDocumentViewer(["tracker", "artifact-summary", "manifest"]);
							break;
						case "artifacts":
							this.overlayService.openOrchestrationDocumentViewer(["plan", "roadmap", "research", "session", "manifest"]);
							break;
						case "logs":
							this.overlayService.openOrchestrationDocumentViewer(["artifact-summary"]);
							break;
						case "settings":
							this.overlayService.showPlaceholderStatus("Orc Settings is not implemented yet.");
							break;
					}
				},
			}),
		);
	}

	openOrcDashboard(): void {
		this.overlayService.openOrcDashboard();
	}

	async summonOrc(): Promise<void> {
		await this.dependencies.host.switchRuntime("orc");
		this.dependencies.onRuntimeActivated();
		this.dependencies.stateStore.setStatusMessage("Orc orchestration chat active. Phase 1 backend is running in its dedicated session namespace.");
	}

	resumeOrcThread(): void {
		this.overlayService.showPlaceholderStatus("Resume Orc thread is a Phase 1 placeholder until checkpoint-backed thread activation is wired.");
	}

	inspectOrcCheckpoints(): void {
		this.overlayService.showPlaceholderStatus("Inspect checkpoints is a Phase 1 placeholder until checkpoint manifests are surfaced in the UI.");
	}

	rewindOrcCheckpoint(): void {
		this.overlayService.showPlaceholderStatus("Rewind to checkpoint is a Phase 1 placeholder until checkpoint restoration is wired.");
	}

	async returnToCodingChat(): Promise<void> {
		await this.dependencies.host.switchRuntime("coding");
		this.dependencies.onRuntimeActivated();
		this.dependencies.stateStore.setStatusMessage("Standard coding chat active.");
	}

	openStatsOverlay(): void {
		this.overlayService.openStatsOverlay();
	}

	openArtifactViewer(): void {
		this.overlayService.openArtifactViewer();
	}

	openHelpOverlay(): void {
		this.overlayService.openHelpOverlay();
	}

	private runSettingsAction(action: string): void {
		switch (action) {
			case "new":
				void this.dependencies.host.newSession().catch((error) => this.handleError("newSession", error));
				break;
			case "setup":
				void this.dependencies.setupActions.openSetupHub().catch((error) => this.handleError("openSetupHub", error));
				break;
			case "provider":
				void this.dependencies.setupActions.openProviderSetup().catch((error) => this.handleError("openProviderSetup", error));
				break;
			case "resume":
				this.openSessionSelector("all");
				break;
			case "thinking-visibility":
				this.dependencies.setupActions.setThinkingVisibility(!this.dependencies.stateStore.getState().showThinking);
				break;
			case "stats":
				this.openStatsOverlay();
				break;
			case "artifacts":
				this.openArtifactViewer();
				break;
			case "rename":
				this.dependencies.overlayController.openTextPrompt(
					"Rename Session",
					"Enter the new session name.",
					this.safeGetHostState()?.sessionName ?? "",
					(value) => {
						void this.dependencies.host.setSessionName(value).catch((error) => this.handleError("setSessionName", error));
					},
				);
				break;
			case "export":
				this.dependencies.overlayController.openTextPrompt(
					"Export HTML",
					"Optional output path. Leave empty to use the default export location.",
					"",
					(value) => {
						void this.dependencies.host.exportHtml(value || undefined).catch((error) => this.handleError("exportHtml", error));
					},
				);
				break;
			case "help":
				this.openHelpOverlay();
				break;
			case "debug":
				this.writeSnapshotAndStatus("settings-overlay");
				break;
			case "logout":
				void this.dependencies.setupActions.openLogoutFlow().catch((error) => this.handleError("openLogoutFlow", error));
				break;
		}
	}

	private writeSnapshotAndStatus(reason: string): void {
		const bundleDir = this.dependencies.writeDebugSnapshot(reason);
		this.dependencies.stateStore.setStatusMessage(bundleDir ? `Debug snapshot written to ${bundleDir}` : "Debug snapshot written.");
	}

	private safeGetHostState(): AgentHostState | undefined {
		try {
			return this.dependencies.host.getState();
		} catch {
			return undefined;
		}
	}

	private handleError(context: string, error: unknown, details: Record<string, unknown> = {}): void {
		this.dependencies.debuggerSink.logError(`command.${context}`, error, details);
		this.dependencies.stateStore.setStatusMessage(`${context}: ${error instanceof Error ? error.message : String(error)}`);
	}
}
