import type { PiMonoAppDebugger } from "./app-debugger.js";
import type { AppStateStore } from "./app-state-store.js";
import type { AgentHost, HostCommand } from "./agent-host.js";
import type { EditorController } from "./editor-controller.js";
import type { OverlayController } from "./overlay-controller.js";
import { ArtifactViewer } from "./components/artifact-viewer.js";
import { HelpOverlay } from "./components/help-overlay.js";
import type { ShellMenuItem } from "./components/shell-menu-overlay.js";
import { SessionStatsOverlay } from "./components/session-stats-overlay.js";
import type { FooterDataProvider } from "./footer-data-provider.js";
import type { ShellView } from "./shell-view.js";
import { getThemeNames, setActiveTheme, getActiveTheme, type ThemeName } from "./themes/index.js";
import { AppConfig } from "./app-config.js";
import { join } from "node:path";
import { getAgentDir } from "./local-coding-agent.js";

interface SetupActions {
	openSetupHub(): Promise<void>;
	openProviderSetup(): Promise<void>;
	openModelSetup(): Promise<void>;
	openLogoutFlow(): Promise<void>;
	setDefaultModel(providerId: string, modelId: string): Promise<void>;
}

const BUILTIN_COMMAND_META: Record<string, { category: string; order: number; description: string }> = {
	setup: { category: "Setup", order: 0, description: "Open the full provider and model setup hub." },
	provider: { category: "Setup", order: 1, description: "Choose or reconnect an OAuth provider." },
	login: { category: "Setup", order: 2, description: "Connect an OAuth provider and continue into model setup." },
	logout: { category: "Setup", order: 3, description: "Disconnect a provider and clear invalid defaults." },
	model: { category: "Setup", order: 4, description: "Choose the default model for this app and session." },
	theme: { category: "Setup", order: 5, description: "Switch the visual theme (default/cyberpunk/matrix/synthwave/amber)." },
	settings: { category: "Session", order: 10, description: "Open app settings and session controls." },
	resume: { category: "Session", order: 11, description: "Resume or switch sessions." },
	fork: { category: "Session", order: 12, description: "Fork from a previous user message." },
	tree: { category: "Session", order: 13, description: "Navigate another branch point in this session." },
	stats: { category: "Session", order: 14, description: "Show session statistics and token usage." },
	artifacts: { category: "Session", order: 15, description: "Browse artifacts from the current session." },
	thinking: { category: "Session", order: 16, description: "Pick the reasoning budget for the active model." },
	compact: { category: "Session", order: 17, description: "Compact the current context window." },
	clear: { category: "Session", order: 18, description: "Clear the chat display." },
	help: { category: "Help", order: 30, description: "Show keybindings and setup guidance." },
	"debug-dump": { category: "Help", order: 31, description: "Write a debug snapshot bundle at the app root." },
};

function builtInCommands(commands: HostCommand[]): HostCommand[] {
	const commandMap = new Map<string, HostCommand>();
	for (const command of commands) {
		commandMap.set(command.name, command);
	}
	for (const [name, meta] of Object.entries(BUILTIN_COMMAND_META)) {
		commandMap.set(name, {
			name,
			description: meta.description,
			source: "builtin",
		});
	}
	commandMap.set("debug-dump", {
		name: "debug-dump",
		description: "Write a debug snapshot bundle at the app root.",
		source: "builtin",
	});
	return [...commandMap.values()].sort((a, b) => {
		const aMeta = BUILTIN_COMMAND_META[a.name];
		const bMeta = BUILTIN_COMMAND_META[b.name];
		const aOrder = aMeta?.order ?? 10_000;
		const bOrder = bMeta?.order ?? 10_000;
		if (aOrder !== bOrder) {
			return aOrder - bOrder;
		}
		return a.name.localeCompare(b.name);
	});
}

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
	openStatsOverlay(): void;
	openArtifactViewer(): void;
	openHelpOverlay(): void;
}

export class DefaultCommandController implements CommandController {
	constructor(
		private readonly host: AgentHost,
		private readonly overlayController: OverlayController,
		private readonly editorController: EditorController,
		private readonly stateStore: AppStateStore,
		private readonly debuggerSink: PiMonoAppDebugger,
		private readonly writeDebugSnapshot: (reason: string) => string | undefined,
		private readonly footerData: FooterDataProvider,
		private readonly clearMessages: () => void,
		private readonly shellView: ShellView,
		private readonly setupActions: SetupActions,
	) {}

	async handleSlashCommand(text: string): Promise<boolean> {
		this.debuggerSink.log("slash.command", { command: text.split(/\s+/)[0] });
		if (text === "/settings") {
			this.editorController.setText("");
			this.openSettingsOverlay();
			return true;
		}
		if (text === "/resume") {
			this.editorController.setText("");
			this.openSessionSelector("all");
			return true;
		}
		if (text === "/fork") {
			this.editorController.setText("");
			await this.openForkSelector();
			return true;
		}
		if (text === "/tree") {
			this.editorController.setText("");
			await this.openTreeSelector();
			return true;
		}
		if (text === "/model") {
			this.editorController.setText("");
			await this.setupActions.openModelSetup();
			return true;
		}
		if (text === "/thinking") {
			this.editorController.setText("");
			this.openThinkingSelector();
			return true;
		}
		if (text === "/stats") {
			this.editorController.setText("");
			this.openStatsOverlay();
			return true;
		}
		if (text === "/artifacts") {
			this.editorController.setText("");
			this.openArtifactViewer();
			return true;
		}
		if (text === "/help") {
			this.editorController.setText("");
			this.openHelpOverlay();
			return true;
		}
		if (text === "/clear") {
			this.editorController.setText("");
			this.clearMessages();
			this.stateStore.setStatusMessage("Chat display cleared.");
			return true;
		}
		if (text === "/debug-dump") {
			this.editorController.setText("");
			this.writeSnapshotAndStatus("slash-debug-dump");
			return true;
		}
		if (text.startsWith("/compact")) {
			this.editorController.setText("");
			const customInstructions = text.slice("/compact".length).trim() || undefined;
			void this.host.compact(customInstructions).catch((error) => this.handleError("compact", error));
			this.stateStore.setStatusMessage("Compacting context...");
			return true;
		}
		if (text.startsWith("/name ")) {
			this.editorController.setText("");
			await this.host.setSessionName(text.slice(6).trim());
			return true;
		}
		if (text.startsWith("/export")) {
			this.editorController.setText("");
			const outputPath = text.split(/\s+/)[1];
			try {
				const path = await this.host.exportHtml(outputPath);
				this.stateStore.setStatusMessage(`Exported to ${path}`);
			} catch (error) {
				this.handleError("exportHtml", error);
			}
			return true;
		}
		if (text === "/login" || text === "/provider" || text === "/setup") {
			this.editorController.setText("");
			if (text === "/setup") {
				await this.setupActions.openSetupHub();
			} else {
				await this.setupActions.openProviderSetup();
			}
			return true;
		}
		if (text === "/theme" || text.startsWith("/theme ")) {
			this.editorController.setText("");
			this.handleThemeCommand(text);
			return true;
		}
		if (text === "/logout") {
			this.editorController.setText("");
			await this.setupActions.openLogoutFlow();
			return true;
		}
		return false;
	}

	openCommandPalette(): void {
		void this.host
			.getCommands()
			.then((commands) => {
				this.overlayController.openSelectOverlay(
					"command-palette",
					"Command Palette",
					"Select a setup flow, slash command, skill, or built-in control.",
					builtInCommands(commands).map((command) => ({
						value: command,
						label: `${BUILTIN_COMMAND_META[command.name]?.category ?? command.source} · /${command.name}`,
						description: command.description ?? command.source,
					})),
					(command) => this.editorController.setText(`/${command.name}`),
				);
			})
			.catch((error) => this.handleError("openCommandPalette", error));
	}

	async openModelSelector(): Promise<void> {
		await this.setupActions.openModelSetup();
	}

	openThinkingSelector(): void {
		const levels = this.host.getAvailableThinkingLevels();
		this.overlayController.openSelectOverlay(
			"thinking-selector",
			"Thinking Selector",
			"Choose the reasoning budget for the current model.",
			levels.map((level) => ({ value: level, label: level })),
			(level) => {
				void this.host.setThinkingLevel(level).catch((error) => this.handleError("setThinkingLevel", error));
			},
		);
	}

	openSessionSelector(scope: "current" | "all"): void {
		void this.host
			.listSessions(scope)
			.then((sessions) => {
				this.overlayController.openSelectOverlay(
					"session-selector",
					"Session Selector",
					`Switch to a ${scope} session.`,
					sessions.map((session) => ({
						value: session,
						label: session.name ? `${session.name} · ${session.id}` : session.id,
						description: session.path,
					})),
					(session) => {
						void this.host.switchSession(session.path).catch((error) => this.handleError("switchSession", error));
					},
				);
			})
			.catch((error) => this.handleError("openSessionSelector", error, { scope }));
	}

	async openForkSelector(): Promise<void> {
		try {
			const messages = await this.host.getForkMessages();
			this.overlayController.openSelectOverlay(
				"fork-selector",
				"Fork Selector",
				"Select a user message to fork from.",
				messages.map((message) => ({
					value: message,
					label: message.text.slice(0, 80),
					description: message.entryId,
				})),
				(message) => {
					void this.host
						.fork(message.entryId)
						.then((result) => {
							if (!result.cancelled && result.text) {
								this.editorController.setText(result.text);
							}
						})
						.catch((error) => this.handleError("fork", error, { entryId: message.entryId }));
				},
			);
		} catch (error) {
			this.handleError("openForkSelector", error);
		}
	}

	async openTreeSelector(): Promise<void> {
		try {
			const targets = await this.host.getTreeTargets();
			this.overlayController.openSelectOverlay(
				"tree-selector",
				"Tree Selector",
				"Navigate the current session tree.",
				targets.map((target) => ({
					value: target,
					label: target.text.slice(0, 80),
					description: target.entryId,
				})),
				(target) => {
					void this.host
						.navigateTree(target.entryId)
						.then((result) => {
							if (!result.cancelled && result.editorText) {
								this.editorController.setText(result.editorText);
							}
						})
						.catch((error) => this.handleError("navigateTree", error, { entryId: target.entryId }));
				},
			);
		} catch (error) {
			this.handleError("openTreeSelector", error);
		}
	}

	openSettingsOverlay(): void {
		void this.host
			.getAvailableModels()
			.then((models) => {
				const themeItems = this.buildThemeMenuItems();
				const modelItems = this.buildModelMenuItems(models);
				const thinkingItems = this.buildThinkingMenuItems();
				const anchor = this.shellView.getMenuAnchor("F1");
				this.overlayController.openMenuOverlay("menu-settings", {
					title: "[F1] Settings",
					subtitle: "Shell controls, defaults, and session operations.",
					anchor,
					width: 40,
					childWidth: 52,
					items: [
						{ kind: "action", id: "setup", label: "Setup Hub", description: "Provider and model recovery.", onSelect: () => this.runSettingsAction("setup") },
						{ kind: "action", id: "provider", label: "Provider Setup", description: "Reconnect or switch provider.", onSelect: () => this.runSettingsAction("provider") },
						{ kind: "submenu", id: "model", label: "Choose Model", description: "Select the default model.", items: modelItems },
						{ kind: "submenu", id: "theme", label: "Theme", description: "Switch the shell visual theme.", items: themeItems },
						{ kind: "submenu", id: "thinking", label: "Thinking Level", description: "Adjust reasoning budget.", items: thinkingItems },
						{ kind: "action", id: "new", label: "New Session", description: "Start a fresh session.", onSelect: () => this.runSettingsAction("new") },
						{ kind: "action", id: "resume", label: "Resume Session", description: "Switch to another session.", onSelect: () => this.runSettingsAction("resume") },
						{ kind: "action", id: "stats", label: "Session Stats", description: "View token usage and metadata.", onSelect: () => this.runSettingsAction("stats") },
						{ kind: "action", id: "artifacts", label: "View Artifacts", description: "Browse generated files.", onSelect: () => this.runSettingsAction("artifacts") },
						{ kind: "action", id: "rename", label: "Rename Session", description: "Update the session display name.", onSelect: () => this.runSettingsAction("rename") },
						{ kind: "action", id: "export", label: "Export HTML", description: "Write an HTML export.", onSelect: () => this.runSettingsAction("export") },
						{ kind: "action", id: "logout", label: "Logout Provider", description: "Disconnect a saved provider.", onSelect: () => this.runSettingsAction("logout") },
						{ kind: "action", id: "help", label: "Help", description: "Show commands and keybindings.", onSelect: () => this.runSettingsAction("help") },
						{ kind: "action", id: "debug", label: "Write Debug Snapshot", description: "Capture the current shell state.", onSelect: () => this.runSettingsAction("debug") },
					],
				});
			})
			.catch((error) => this.handleError("openSettingsOverlay", error));
	}

	openSessionsOverlay(): void {
		const anchor = this.shellView.getMenuAnchor("F2");
		this.overlayController.openMenuOverlay("menu-sessions", {
			title: "[F2] Sessions",
			subtitle: "Session navigation and tree controls.",
			anchor,
			width: 38,
			childWidth: 44,
			items: [
				{ kind: "action", id: "resume", label: "Resume Session", description: "Switch to another saved session.", onSelect: () => this.openSessionSelector("all") },
				{ kind: "action", id: "fork", label: "Fork Session", description: "Fork from a previous user message.", onSelect: () => void this.openForkSelector().catch((error) => this.handleError("openForkSelector", error)) },
				{ kind: "action", id: "tree", label: "Session Tree", description: "Navigate branch points.", onSelect: () => void this.openTreeSelector().catch((error) => this.handleError("openTreeSelector", error)) },
				{ kind: "action", id: "stats", label: "Session Stats", description: "Show token usage and costs.", onSelect: () => this.openStatsOverlay() },
				{ kind: "action", id: "new", label: "New Session", description: "Clear chat and start fresh.", onSelect: () => this.runSettingsAction("new") },
			],
		});
	}

	openStatsOverlay(): void {
		try {
			const stats = this.host.getSessionStats();
			const hostState = this.safeGetHostState();
			const gitBranch = this.footerData.getGitBranch();
			this.overlayController.showCustomOverlay(
				"session-stats",
				new SessionStatsOverlay(stats, hostState, gitBranch, () => this.overlayController.closeOverlay("session-stats")),
				{ width: 72, maxHeight: "80%", anchor: "center", margin: 1 },
			);
		} catch (error) {
			this.handleError("openStatsOverlay", error);
		}
	}

	openArtifactViewer(): void {
		const artifacts = this.stateStore.getState().artifacts;
		this.overlayController.showCustomOverlay(
			"artifact-viewer",
			new ArtifactViewer(artifacts, () => this.overlayController.closeOverlay("artifact-viewer")),
			{ width: "85%", maxHeight: "80%", anchor: "center", margin: 1 },
		);
	}

	openHelpOverlay(): void {
		this.overlayController.showCustomOverlay(
			"help",
			new HelpOverlay(() => this.overlayController.closeOverlay("help")),
			{ width: "80%", maxHeight: "80%", anchor: "center", margin: 1 },
		);
	}

	private runSettingsAction(action: string): void {
		switch (action) {
			case "new":
				void this.host.newSession().catch((error) => this.handleError("newSession", error));
				break;
			case "setup":
				void this.setupActions.openSetupHub().catch((error) => this.handleError("openSetupHub", error));
				break;
			case "provider":
				void this.setupActions.openProviderSetup().catch((error) => this.handleError("openProviderSetup", error));
				break;
			case "model":
				void this.setupActions.openModelSetup().catch((error) => this.handleError("openModelSetup", error));
				break;
			case "resume":
				this.openSessionSelector("all");
				break;
			case "thinking":
				this.openThinkingSelector();
				break;
			case "compact":
				void this.host.compact().catch((error) => this.handleError("compact", error));
				break;
			case "stats":
				this.openStatsOverlay();
				break;
			case "artifacts":
				this.openArtifactViewer();
				break;
			case "rename":
				this.overlayController.openTextPrompt(
					"Rename Session",
					"Enter the new session name.",
					this.safeGetHostState()?.sessionName ?? "",
					(value) => {
						void this.host.setSessionName(value).catch((error) => this.handleError("setSessionName", error));
					},
				);
				break;
			case "export":
				this.overlayController.openTextPrompt(
					"Export HTML",
					"Optional output path. Leave empty to use the default export location.",
					"",
					(value) => {
						void this.host.exportHtml(value || undefined).catch((error) => this.handleError("exportHtml", error));
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
				void this.setupActions.openLogoutFlow().catch((error) => this.handleError("openLogoutFlow", error));
				break;
		}
	}

	private buildModelMenuItems(models: Awaited<ReturnType<AgentHost["getAvailableModels"]>>): ShellMenuItem[] {
		if (models.length === 0) {
			return [{
				kind: "action",
				id: "no-models",
				label: "No models available",
				description: "Connect a provider or retry setup.",
				onSelect: () => this.stateStore.setStatusMessage("No models available."),
			}];
		}
		return models.map((model) => ({
			kind: "action" as const,
			id: `${model.provider}/${model.id}`,
			label: `${model.provider}/${model.id}`,
			description: model.name,
			onSelect: async () => {
				try {
					await this.setupActions.setDefaultModel(model.provider, model.id);
					this.stateStore.setStatusMessage(`Default model set to ${model.provider}/${model.id}.`);
				} catch (error) {
					this.handleError("setDefaultModel", error, { provider: model.provider, modelId: model.id });
				}
			},
		}));
	}

	private buildThemeMenuItems(): ShellMenuItem[] {
		const active = getActiveTheme().name;
		return getThemeNames().map((themeName) => ({
			kind: "action" as const,
			id: `theme:${themeName}`,
			label: themeName === active ? `* ${themeName}` : themeName,
			description: themeName === active ? "Current theme" : "Apply theme",
			onSelect: () => this.handleThemeCommand(`/theme ${themeName}`),
		}));
	}

	private buildThinkingMenuItems(): ShellMenuItem[] {
		return this.host.getAvailableThinkingLevels().map((level) => ({
			kind: "action" as const,
			id: `thinking:${level}`,
			label: level,
			description: "Set reasoning budget",
			onSelect: () => {
				void this.host.setThinkingLevel(level).catch((error) => this.handleError("setThinkingLevel", error));
			},
		}));
	}

	private handleThemeCommand(text: string): void {
		const arg = text.slice("/theme".length).trim();
		const themeNames = getThemeNames();
		if (!arg) {
			const active = getActiveTheme().name;
			const list = themeNames.map((n) => (n === active ? `> ${n}` : `  ${n}`)).join("  ");
			this.stateStore.setStatusMessage(`Themes: ${list}`);
			return;
		}
		if (!themeNames.includes(arg as ThemeName)) {
			this.stateStore.setStatusMessage(`Unknown theme "${arg}". Available: ${themeNames.join(", ")}`);
			return;
		}
		setActiveTheme(arg as ThemeName);
		// Persist to config
		try {
			const configPath = join(getAgentDir(), "vibe-agent-config.json");
			const config = AppConfig.load(configPath);
			AppConfig.save({ ...config, selectedTheme: arg }, configPath);
		} catch {
			// ignore persistence errors
		}
		this.stateStore.setStatusMessage(`Theme set to "${arg}".`);
	}

	private writeSnapshotAndStatus(reason: string): void {
		const bundleDir = this.writeDebugSnapshot(reason);
		this.stateStore.setStatusMessage(bundleDir ? `Debug snapshot written to ${bundleDir}` : "Debug snapshot written.");
	}

	private safeGetHostState() {
		try {
			return this.host.getState();
		} catch {
			return undefined;
		}
	}

	private handleError(context: string, error: unknown, details: Record<string, unknown> = {}): void {
		this.debuggerSink.logError(`command.${context}`, error, details);
		this.stateStore.setStatusMessage(`${context}: ${error instanceof Error ? error.message : String(error)}`);
	}
}
