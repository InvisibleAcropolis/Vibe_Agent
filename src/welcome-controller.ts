import type { Model, OAuthLoginCallbacks, OAuthProviderInterface } from "@mariozechner/pi-ai";
import { getOAuthProvider, getOAuthProviders } from "@mariozechner/pi-ai/oauth";
import { Container, Spacer, Text, TruncatedText, getEditorKeybindings, type Focusable, type TUI } from "@mariozechner/pi-tui";
import type { AppConfig } from "./app-config.js";
import { AppConfig as AppConfigModule } from "./app-config.js";
import { agentTheme } from "./theme.js";
import { type AuthStorage, LoginDialogComponent, ModelRegistry } from "./local-coding-agent.js";
import type { ShellView } from "./shell-view.js";

export const PREFERRED_PROVIDERS = ["google-antigravity", "openai-codex"];

export type SetupStep = "intro" | "provider" | "model" | "complete";

export interface SetupRunRequest {
	startStep?: SetupStep;
	allowSkip?: boolean;
	providerId?: string;
	reason?: string;
	showCompletion?: boolean;
}

export interface SetupFlowResult {
	completed: boolean;
	skipped: boolean;
	selectedProvider?: string;
	selectedModelId?: string;
}

interface SetupStepChange {
	title: string;
	message: string;
	tone: "accent" | "info" | "success" | "warning" | "dim";
}

interface WelcomeControllerOptions {
	onConfigChange?: (config: AppConfig) => void;
	onStepChange?: (step: SetupStep, detail: SetupStepChange | undefined) => void;
	applyModelSelection?: (providerId: string, modelId: string) => Promise<void>;
}

interface SetupListItem {
	id: string;
	label: string;
	description?: string;
	badge?: string;
	highlighted?: boolean;
}

class SetupIntroComponent extends Container implements Focusable {
	private _focused = false;

	constructor(
		private readonly onContinue: () => void,
		private readonly onSkip: () => void,
	) {
		super();
		this.addChild(new Spacer(1));
		this.addChild(new Text(agentTheme.accentStrong("  Vibe Agent setup"), 1, 0));
		this.addChild(new Text(agentTheme.bannerBody("  Connect a provider, choose a default model, and launch into chat with a clean cockpit."), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(agentTheme.bannerAccent("  ★ Recommended providers"), 1, 0));
		this.addChild(new TruncatedText(agentTheme.bannerBody("    Google Antigravity OAuth"), 0, 0));
		this.addChild(new TruncatedText(agentTheme.bannerBody("    OpenAI Codex OAuth"), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(agentTheme.bannerInfo("  What setup will persist locally"), 1, 0));
		this.addChild(new TruncatedText(agentTheme.bannerBody("    auth.json credentials via Pi-mono AuthStorage"), 0, 0));
		this.addChild(new TruncatedText(agentTheme.bannerBody("    vibe-agent-config.json default provider/model"), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(agentTheme.bannerDim("  Enter continue  |  Esc skip for now"), 1, 0));
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}

	handleInput(data: string): void {
		const kb = getEditorKeybindings();
		if (kb.matches(data, "selectConfirm")) {
			this.onContinue();
			return;
		}
		if (kb.matches(data, "selectCancel")) {
			this.onSkip();
		}
	}
}

/**
 * Standalone OAuth provider selector component for the setup flow.
 * Preferred providers are shown first with a ★ prefix.
 */
export class WelcomeOAuthSelectorComponent extends Container implements Focusable {
	private readonly listContainer = new Container();
	private readonly orderedProviders: OAuthProviderInterface[];
	private readonly lines: string[] = [];
	private selectedIndex = 0;
	private _focused = false;

	constructor(
		private readonly authStorage: Pick<AuthStorage, "get">,
		private readonly onSelect: (providerId: string) => void,
		private readonly onCancel: () => void,
		private readonly subtitle = "Select a provider to get started.",
	) {
		super();
		this.orderedProviders = sortProviders(getOAuthProviders());
		this.addChild(new Spacer(1));
		this.addChild(new Text(agentTheme.accentStrong("  Connect a provider"), 1, 0));
		this.addChild(new Text(agentTheme.bannerBody(`  ${subtitle}`), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));
		this.addChild(new Text(agentTheme.bannerDim("  ↑↓ navigate  |  Enter select  |  Esc back"), 1, 0));
		this.renderList();
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}

	getLines(): string[] {
		return [...this.lines];
	}

	handleInput(keyData: string): void {
		const kb = getEditorKeybindings();
		if (kb.matches(keyData, "selectUp")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.renderList();
			return;
		}
		if (kb.matches(keyData, "selectDown")) {
			this.selectedIndex = Math.min(this.orderedProviders.length - 1, this.selectedIndex + 1);
			this.renderList();
			return;
		}
		if (kb.matches(keyData, "selectConfirm")) {
			const provider = this.orderedProviders[this.selectedIndex];
			if (provider) {
				this.onSelect(provider.id);
			}
			return;
		}
		if (kb.matches(keyData, "selectCancel")) {
			this.onCancel();
		}
	}

	private renderList(): void {
		this.listContainer.clear();
		this.lines.length = 0;

		for (let index = 0; index < this.orderedProviders.length; index++) {
			const provider = this.orderedProviders[index];
			if (!provider) continue;
			const isPreferred = PREFERRED_PROVIDERS.includes(provider.id);
			const isSelected = index === this.selectedIndex;
			const credentials = this.authStorage.get(provider.id);
			const isLoggedIn = credentials?.type === "oauth";
			const prefix = isSelected ? "→ " : "  ";
			const starPrefix = isPreferred ? "★ " : "  ";
			const statusBadge = isLoggedIn ? agentTheme.success("  logged in") : isPreferred ? agentTheme.bannerAccent("  recommended") : "";
			const lineText = `${prefix}${starPrefix}${provider.name}`;
			const line = isSelected ? agentTheme.accent(lineText) + statusBadge : agentTheme.bannerBody(lineText) + statusBadge;

			this.listContainer.addChild(new TruncatedText(line, 0, 0));
			this.lines.push(`  ${starPrefix}${provider.name}${isLoggedIn ? " ✓" : ""}`);
		}

		if (this.orderedProviders.length === 0) {
			this.listContainer.addChild(new TruncatedText(agentTheme.bannerWarning("  No OAuth providers available."), 0, 0));
			this.lines.push("  No OAuth providers available");
		}
	}
}

class SetupModelSelectorComponent extends Container implements Focusable {
	private readonly listContainer = new Container();
	private selectedIndex = 0;
	private _focused = false;

	constructor(
		private readonly providerId: string,
		private readonly items: SetupListItem[],
		private readonly onSelect: (modelId: string) => void,
		private readonly onCancel: () => void,
		private readonly subtitle: string,
	) {
		super();
		this.addChild(new Spacer(1));
		this.addChild(new Text(agentTheme.accentStrong("  Choose a default model"), 1, 0));
		this.addChild(new Text(agentTheme.bannerBody(`  ${subtitle}`), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));
		this.addChild(new Text(agentTheme.bannerDim("  ↑↓ navigate  |  Enter select  |  Esc back"), 1, 0));
		this.renderList();
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}

	handleInput(keyData: string): void {
		const kb = getEditorKeybindings();
		if (kb.matches(keyData, "selectUp")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.renderList();
			return;
		}
		if (kb.matches(keyData, "selectDown")) {
			this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
			this.renderList();
			return;
		}
		if (kb.matches(keyData, "selectConfirm")) {
			const selected = this.items[this.selectedIndex];
			if (selected) {
				this.onSelect(selected.id);
			}
			return;
		}
		if (kb.matches(keyData, "selectCancel")) {
			this.onCancel();
		}
	}

	private renderList(): void {
		this.listContainer.clear();
		if (this.items.length === 0) {
			this.listContainer.addChild(new TruncatedText(agentTheme.bannerWarning(`  No models available for ${this.providerId}.`), 0, 0));
			return;
		}

		for (let index = 0; index < this.items.length; index++) {
			const item = this.items[index];
			if (!item) continue;
			const isSelected = index === this.selectedIndex;
			const prefix = isSelected ? "→ " : "  ";
			const badge = item.badge ? agentTheme.bannerAccent(`  ${item.badge}`) : "";
			const description = item.description ? agentTheme.bannerDim(`  ${item.description}`) : "";
			const label = `${prefix}${item.highlighted ? "★ " : "  "}${item.label}`;
			const line = isSelected ? agentTheme.accent(label) + badge : agentTheme.bannerBody(label) + badge;

			this.listContainer.addChild(new TruncatedText(line, 0, 0));
			if (item.description) {
				this.listContainer.addChild(new TruncatedText(`    ${description}`, 0, 0));
			}
		}
	}
}

class SetupCompletionComponent extends Container implements Focusable {
	private _focused = false;

	constructor(
		providerId: string,
		modelId: string,
		private readonly onContinue: () => void,
	) {
		super();
		this.addChild(new Spacer(1));
		this.addChild(new Text(agentTheme.bannerSuccess("  Setup complete"), 1, 0));
		this.addChild(new Text(agentTheme.bannerBody("  Vibe Agent is ready to launch with your default connection."), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new TruncatedText(agentTheme.bannerBody(`    Provider  ${providerId}`), 0, 0));
		this.addChild(new TruncatedText(agentTheme.bannerBody(`    Model     ${modelId}`), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(agentTheme.bannerDim("  Enter start chatting"), 1, 0));
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}

	handleInput(data: string): void {
		const kb = getEditorKeybindings();
		if (kb.matches(data, "selectConfirm") || kb.matches(data, "selectCancel")) {
			this.onContinue();
		}
	}
}

function sortProviders(providers: OAuthProviderInterface[]): OAuthProviderInterface[] {
	const preferred = providers.filter((provider) => PREFERRED_PROVIDERS.includes(provider.id));
	const rest = providers.filter((provider) => !PREFERRED_PROVIDERS.includes(provider.id));
	preferred.sort((a, b) => PREFERRED_PROVIDERS.indexOf(a.id) - PREFERRED_PROVIDERS.indexOf(b.id));
	rest.sort((a, b) => a.name.localeCompare(b.name));
	return [...preferred, ...rest];
}

function buildModelItems(models: Model<any>[], selectedModelId: string | undefined): SetupListItem[] {
	return models.map((model, index) => ({
		id: model.id,
		label: `${model.provider}/${model.id}`,
		description: model.name,
		badge: selectedModelId === model.id ? "saved default" : index === 0 ? "recommended" : undefined,
		highlighted: selectedModelId === model.id || index === 0,
	}));
}

/**
 * Controller that drives first-run setup, provider recovery, and post-start setup flows.
 */
export class WelcomeController {
	private resolveRun?: (result: SetupFlowResult) => void;
	private currentRequest: SetupRunRequest = {};
	private activeProviderId: string | undefined;
	private currentConfig: AppConfig;

	constructor(
		private readonly shellView: Pick<ShellView, "setEditor" | "setTitle">,
		private readonly authStorage: AuthStorage,
		private readonly modelRegistry: ModelRegistry,
		config: AppConfig,
		private readonly configPath: string,
		private readonly tui: Pick<TUI, "requestRender" | "setFocus">,
		private readonly options: WelcomeControllerOptions = {},
	) {
		this.currentConfig = config;
	}

	async run(request: SetupRunRequest = {}): Promise<SetupFlowResult> {
		this.currentRequest = {
			startStep: request.startStep ?? "intro",
			allowSkip: request.allowSkip ?? true,
			providerId: request.providerId,
			reason: request.reason,
			showCompletion: request.showCompletion ?? true,
		};
		this.activeProviderId = request.providerId ?? this.currentConfig.selectedProvider;
		this.shellView.setTitle("Vibe Agent · Setup");

		return new Promise<SetupFlowResult>((resolve) => {
			this.resolveRun = resolve;
			switch (this.currentRequest.startStep) {
				case "provider":
					this.showProviderSelector();
					break;
				case "model":
					this.showModelSelector(this.activeProviderId);
					break;
				case "complete":
					if (this.activeProviderId && this.currentConfig.selectedModelId) {
						this.showCompletion(this.activeProviderId, this.currentConfig.selectedModelId);
					} else {
						this.showIntro();
					}
					break;
				case "intro":
				default:
					this.showIntro();
					break;
			}
		});
	}

	skip(): void {
		this.finish({ completed: false, skipped: true });
	}

	private showIntro(): void {
		this.emitStepChange("intro", {
			title: "Setup",
			message: "Connect a provider and pick a default model before chat starts.",
			tone: "accent",
		});
		this.mountComponent(new SetupIntroComponent(
			() => this.showProviderSelector(),
			() => this.skip(),
		));
	}

	private showProviderSelector(subtitle?: string): void {
		this.emitStepChange("provider", {
			title: "Provider setup",
			message: subtitle ?? "OAuth-first setup with Antigravity and OpenAI prioritized.",
			tone: "info",
		});
		this.mountComponent(
			new WelcomeOAuthSelectorComponent(
				this.authStorage,
				(providerId) => void this.handleProviderSelected(providerId),
				() => {
					if (this.currentRequest.startStep === "intro") {
						this.showIntro();
						return;
					}
					this.skip();
				},
				subtitle,
			),
		);
	}

	private showModelSelector(providerId: string | undefined): void {
		if (!providerId) {
			this.showProviderSelector("Choose a provider first, then pick a default model.");
			return;
		}

		const models = this.modelRegistry.getAvailable().filter((model) => model.provider === providerId);
		this.activeProviderId = providerId;
		this.emitStepChange("model", {
			title: "Model selection",
			message: models.length > 0
				? `Choose the default ${providerId} model for new sessions.`
				: `No available models were found for ${providerId}. Connect a different provider or try again later.`,
			tone: models.length > 0 ? "info" : "warning",
		});
		this.mountComponent(
			new SetupModelSelectorComponent(
				providerId,
				buildModelItems(models, this.currentConfig.selectedModelId),
				(modelId) => void this.handleModelSelected(providerId, modelId),
				() => this.showProviderSelector("Pick a provider or reconnect to continue setup."),
				models.length > 0
					? "This becomes the default model whenever Vibe Agent starts."
					: "Go back to choose a different provider.",
			),
		);
	}

	private showCompletion(providerId: string, modelId: string): void {
		this.emitStepChange("complete", {
			title: "Ready",
			message: `${providerId}/${modelId} is saved as the default startup path.`,
			tone: "success",
		});
		this.mountComponent(new SetupCompletionComponent(providerId, modelId, () => {
			this.finish({
				completed: true,
				skipped: false,
				selectedProvider: providerId,
				selectedModelId: modelId,
			});
		}));
	}

	private async handleProviderSelected(providerId: string): Promise<void> {
		this.activeProviderId = providerId;
		this.emitStepChange("provider", {
			title: "Authorizing",
			message: `Signing in to ${providerId}. Continue in the browser and return here when prompted.`,
			tone: "info",
		});

		const loginDialog = new LoginDialogComponent(
			this.tui as any,
			providerId,
			(success, message) => {
				if (!success) {
					this.showProviderSelector(message ?? `Login to ${providerId} was cancelled.`);
				}
			},
		);
		this.mountComponent(loginDialog);
		loginDialog.focused = true;
		this.tui.setFocus(loginDialog as any);
		this.tui.requestRender();

		const callbacks: OAuthLoginCallbacks = {
			onAuth: (info) => loginDialog.showAuth(info.url, info.instructions),
			onPrompt: (prompt) => loginDialog.showPrompt(prompt.message, prompt.placeholder),
			onProgress: (message) => loginDialog.showProgress(message),
			onManualCodeInput: getOAuthProvider(providerId)?.usesCallbackServer
				? () => loginDialog.showManualInput("Paste the redirect URL:")
				: undefined,
			signal: loginDialog.signal,
		};

		try {
			await this.authStorage.login(providerId as Parameters<AuthStorage["login"]>[0], callbacks);
		} catch (error) {
			if (!loginDialog.signal.aborted) {
				this.showProviderSelector(error instanceof Error ? error.message : `Login to ${providerId} failed.`);
			}
			return;
		}

		if (loginDialog.signal.aborted) {
			return;
		}

		this.modelRegistry.refresh();
		this.persistConfig({
			setupComplete: false,
			selectedProvider: providerId,
			selectedModelId: undefined,
		});
		this.showModelSelector(providerId);
	}

	private async handleModelSelected(providerId: string, modelId: string): Promise<void> {
		try {
			await this.options.applyModelSelection?.(providerId, modelId);
		} catch (error) {
			this.showModelSelector(providerId);
			return;
		}

		const nextConfig: AppConfig = {
			...this.currentConfig,
			setupComplete: true,
			selectedProvider: providerId,
			selectedModelId: modelId,
		};
		this.persistConfig(nextConfig);

		if (this.currentRequest.showCompletion === false) {
			this.finish({
				completed: true,
				skipped: false,
				selectedProvider: providerId,
				selectedModelId: modelId,
			});
			return;
		}

		this.showCompletion(providerId, modelId);
	}

	private persistConfig(config: AppConfig): void {
		this.currentConfig = config;
		AppConfigModule.save(config, this.configPath);
		this.options.onConfigChange?.(config);
	}

	private mountComponent(component: Focusable & { focused?: boolean }): void {
		this.shellView.setEditor(component as unknown as Container);
		component.focused = true;
		this.tui.setFocus(component as any);
		this.tui.requestRender();
	}

	private emitStepChange(step: SetupStep, detail: SetupStepChange | undefined): void {
		this.options.onStepChange?.(step, detail);
	}

	private finish(result: SetupFlowResult): void {
		this.options.onStepChange?.("complete", undefined);
		if (!this.resolveRun) {
			return;
		}
		const resolve = this.resolveRun;
		this.resolveRun = undefined;
		resolve(result);
	}
}
