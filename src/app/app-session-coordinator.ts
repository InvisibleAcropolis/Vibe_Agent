import type { Component } from "@mariozechner/pi-tui";
import type { AgentHost, AgentHostState } from "../agent-host.js";
import type { AppConfig } from "../app-config.js";
import type { AppStateStore } from "../app-state-store.js";
import type { FooterDataProvider } from "../footer-data-provider.js";
import {
	OAuthSelectorComponent,
	type AgentSession,
	type AuthStorage,
	type ModelRegistry,
} from "../local-coding-agent.js";
import type { ShellView } from "../shell-view.js";
import { type SetupRunRequest, WelcomeController } from "../welcome-controller.js";
import { AppConfigRepository } from "./app-config-repository.js";
import { AppSetupService, type SavedDefaultValidation, type StartupGateAssessment } from "./app-setup-service.js";

export class AppSessionCoordinator {
	private setupFlowActive = false;

	constructor(
		private readonly dependencies: {
			shellView: ShellView;
			stateStore: AppStateStore;
			footerData: FooterDataProvider;
			host: AgentHost;
			authStorage: AuthStorage;
			modelRegistry: ModelRegistry;
			configRepository: AppConfigRepository;
			setupService: AppSetupService;
			getHostState: () => AgentHostState | undefined;
			getEditorComponent: () => Component;
			restoreEditor: () => void;
			isHostInitialized: () => boolean;
			onInteractiveFlowComplete: () => void;
		},
	) {}

	getConfig(): AppConfig {
		return this.dependencies.configRepository.get();
	}

	saveConfig(config: AppConfig): void {
		this.dependencies.configRepository.save(config);
	}

	isSetupFlowActive(): boolean {
		return this.setupFlowActive;
	}

	assessStartupGate(): StartupGateAssessment {
		return this.dependencies.setupService.assessStartupGate(this.getConfig());
	}

	validateSavedDefault(): SavedDefaultValidation {
		return this.dependencies.setupService.validateSavedDefault(this.getConfig());
	}

	getActiveHostSelection(hostState?: AgentHostState): { providerId: string; modelId: string } | undefined {
		return this.dependencies.setupService.getActiveHostSelection(hostState);
	}

	countAvailableProviders(): number {
		return this.dependencies.setupService.countAvailableProviders();
	}

	refreshProviderAvailability(): void {
		this.dependencies.footerData.setAvailableProviderCount(this.countAvailableProviders());
	}

	setThinkingVisibility(show: boolean): void {
		this.dependencies.stateStore.setShowThinking(show);
		this.saveConfig({
			...this.getConfig(),
			showThinking: show,
		});
		this.dependencies.stateStore.setStatusMessage(show ? "Thinking tray enabled." : "Thinking tray hidden.");
	}

	async openSetupFlow(request: SetupRunRequest): Promise<void> {
		this.setupFlowActive = true;
		const controller = new WelcomeController(
			this.dependencies.shellView,
			this.dependencies.authStorage,
			this.dependencies.modelRegistry,
			this.getConfig(),
			this.dependencies.configRepository.path,
			this.dependencies.shellView.tui,
			{
				onConfigChange: (config) => {
					this.saveConfig(config);
				},
				onStepChange: (_step, detail) => {
					this.dependencies.stateStore.setContextBanner(detail?.title, detail?.message, detail?.tone);
				},
				applyModelSelection: async (providerId, modelId) => {
					if (this.dependencies.isHostInitialized()) {
						await this.dependencies.host.setModel(providerId, modelId);
					}
				},
			},
		);

		try {
			const result = await controller.run(request);
			this.refreshProviderAvailability();
			if (result.completed && result.selectedProvider && result.selectedModelId) {
				this.dependencies.stateStore.setStatusMessage(`Default model set to ${result.selectedProvider}/${result.selectedModelId}.`);
			} else if (result.skipped) {
				this.dependencies.stateStore.setStatusMessage("Setup skipped.");
			}
		} finally {
			this.finishInteractiveFlow();
		}
	}

	async openLogoutFlow(): Promise<void> {
		this.setupFlowActive = true;
		this.dependencies.stateStore.setContextBanner("Disconnect provider", "Choose which provider to log out from.", "warning");

		await new Promise<void>((resolve) => {
			const selector = new OAuthSelectorComponent(
				"logout",
				this.dependencies.authStorage,
				(providerId) => {
					this.handleLogoutProvider(providerId);
					resolve();
				},
				() => {
					this.dependencies.stateStore.setStatusMessage("Logout cancelled.");
					resolve();
				},
			);

			this.dependencies.shellView.setTitle("Vibe Agent · Logout");
			this.dependencies.shellView.setEditor(selector);
			this.dependencies.shellView.tui.setFocus(selector as never);
			this.dependencies.shellView.tui.requestRender();
		});

		this.finishInteractiveFlow();
	}

	async applyConfiguredModelToSession(session: AgentSession): Promise<void> {
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

	normalizeConfigFromAssessment(hostState?: AgentHostState): void {
		const normalized = this.dependencies.setupService.normalizeConfig(this.getConfig(), hostState);
		if (normalized) {
			this.saveConfig(normalized);
		}
	}

	persistCurrentHostModelSelection(hostState?: AgentHostState): void {
		const providerId = hostState?.model?.provider;
		const modelId = hostState?.model?.id;
		if (!providerId || !modelId) {
			return;
		}
		this.saveConfig({
			...this.getConfig(),
			setupComplete: true,
			selectedProvider: providerId,
			selectedModelId: modelId,
		});
	}

	private handleLogoutProvider(providerId: string): void {
		this.dependencies.authStorage.logout(providerId);
		this.dependencies.modelRegistry.refresh();

		const currentConfig = this.getConfig();
		this.saveConfig({
			...currentConfig,
			selectedProvider: currentConfig.selectedProvider === providerId ? undefined : currentConfig.selectedProvider,
			selectedModelId: currentConfig.selectedProvider === providerId ? undefined : currentConfig.selectedModelId,
			setupComplete: false,
		});

		this.refreshProviderAvailability();
		this.dependencies.stateStore.setStatusMessage(`Logged out of ${providerId}.`);
	}

	private finishInteractiveFlow(): void {
		this.setupFlowActive = false;
		this.dependencies.shellView.setTitle("Vibe Agent");
		this.dependencies.restoreEditor();
		this.dependencies.onInteractiveFlowComplete();
	}
}
