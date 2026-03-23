import type { Model } from "@mariozechner/pi-ai";
import type { AppStateStore } from "../app-state-store.js";
import type { ShellMenuItem, ShellMenuDefinition } from "../components/shell-menu-overlay.js";
import type { ShellView } from "../shell-view.js";

export class CommandMenuBuilder {
	constructor(
		private readonly dependencies: {
			stateStore: AppStateStore;
			shellView: ShellView;
		},
	) {}

	buildSettingsMenu(options: {
		modelItems: ShellMenuItem[];
		themeItems: ShellMenuItem[];
		thinkingItems: ShellMenuItem[];
		onAction: (action: string) => void;
	}): ShellMenuDefinition {
		return {
			title: "[F1] Settings",
			subtitle: "Shell controls, defaults, and session operations.",
			anchor: this.dependencies.shellView.getMenuAnchor("F1"),
			width: 40,
			childWidth: 52,
			items: [
				{ kind: "action", id: "setup", label: "Setup Hub", description: "Provider and model recovery.", onSelect: () => options.onAction("setup") },
				{ kind: "action", id: "provider", label: "Provider Setup", description: "Reconnect or switch provider.", onSelect: () => options.onAction("provider") },
				{ kind: "submenu", id: "model", label: "Choose Model", description: "Select the default model.", items: options.modelItems },
				{ kind: "submenu", id: "theme", label: "Theme", description: "Switch the shell visual theme.", items: options.themeItems },
				{ kind: "submenu", id: "thinking", label: "Thinking Level", description: "Adjust reasoning budget.", items: options.thinkingItems },
				{
					kind: "action",
					id: "thinking-visibility",
					label: this.dependencies.stateStore.getState().showThinking ? "Hide Thinking Tray" : "Show Thinking Tray",
					description: this.dependencies.stateStore.getState().showThinking
						? "Hide live reasoning output below the footer."
						: "Show live reasoning output below the footer.",
					onSelect: () => options.onAction("thinking-visibility"),
				},
				{ kind: "action", id: "new", label: "New Session", description: "Start a fresh session.", onSelect: () => options.onAction("new") },
				{ kind: "action", id: "resume", label: "Resume Session", description: "Switch to another session.", onSelect: () => options.onAction("resume") },
				{ kind: "action", id: "stats", label: "Session Stats", description: "View token usage and metadata.", onSelect: () => options.onAction("stats") },
				{ kind: "action", id: "artifacts", label: "View Artifacts", description: "Browse generated files.", onSelect: () => options.onAction("artifacts") },
				{ kind: "action", id: "rename", label: "Rename Session", description: "Update the session display name.", onSelect: () => options.onAction("rename") },
				{ kind: "action", id: "export", label: "Export HTML", description: "Write an HTML export.", onSelect: () => options.onAction("export") },
				{ kind: "action", id: "logout", label: "Logout Provider", description: "Disconnect a saved provider.", onSelect: () => options.onAction("logout") },
				{ kind: "action", id: "help", label: "Help", description: "Show commands and keybindings.", onSelect: () => options.onAction("help") },
				{ kind: "action", id: "debug", label: "Write Debug Snapshot", description: "Capture the current shell state.", onSelect: () => options.onAction("debug") },
			],
		};
	}

	buildSessionsMenu(options: { onAction: (action: string) => void }): ShellMenuDefinition {
		return {
			title: "[F2] Sessions",
			subtitle: "Session navigation and tree controls.",
			anchor: this.dependencies.shellView.getMenuAnchor("F2"),
			width: 38,
			childWidth: 44,
			items: [
				{ kind: "action", id: "resume", label: "Resume Session", description: "Switch to another saved session.", onSelect: () => options.onAction("resume") },
				{ kind: "action", id: "fork", label: "Fork Session", description: "Fork from a previous user message.", onSelect: () => options.onAction("fork") },
				{ kind: "action", id: "tree", label: "Session Tree", description: "Navigate branch points.", onSelect: () => options.onAction("tree") },
				{ kind: "action", id: "stats", label: "Session Stats", description: "Show token usage and costs.", onSelect: () => options.onAction("stats") },
				{ kind: "action", id: "new", label: "New Session", description: "Clear chat and start fresh.", onSelect: () => options.onAction("new") },
			],
		};
	}

	buildOrchestrationMenu(options: { onAction: (action: string) => void }): ShellMenuDefinition {
		return {
			title: "[F3] Orc",
			subtitle: "Phase 1 orchestration surfaces and status hooks.",
			anchor: this.dependencies.shellView.getMenuAnchor("F3"),
			width: 34,
			childWidth: 46,
			items: [
				{ kind: "action", id: "summon-orc", label: "Summon Orc", description: "Initialize the orchestration assistant shell.", onSelect: () => options.onAction("summon-orc") },
				{ kind: "action", id: "dashboard", label: "Dashboard", description: "Open the friendly Orc telemetry dashboard.", onSelect: () => options.onAction("dashboard") },
				{ kind: "action", id: "coding-chat", label: "Coding Chat", description: "Return to the standard coding session transcript.", onSelect: () => options.onAction("coding-chat") },
				{ kind: "action", id: "orc-resume", label: "Resume Thread", description: "Placeholder controller action for resuming an Orc thread.", onSelect: () => options.onAction("orc-resume") },
				{ kind: "action", id: "orc-checkpoints", label: "Inspect Checkpoints", description: "Placeholder controller action for viewing Orc checkpoints.", onSelect: () => options.onAction("orc-checkpoints") },
				{ kind: "action", id: "orc-rewind", label: "Rewind Checkpoint", description: "Placeholder controller action for rewinding to a checkpoint.", onSelect: () => options.onAction("orc-rewind") },
				{ kind: "action", id: "tracker", label: "Tracker", description: "Browse tracker docs, summaries, and reserved LANGEXT exports.", onSelect: () => options.onAction("tracker") },
				{ kind: "action", id: "artifacts", label: "Artifacts", description: "Browse plans, roadmaps, research notes, and session documents.", onSelect: () => options.onAction("artifacts") },
				{ kind: "action", id: "logs", label: "Logs", description: "Review orchestration execution logs via generated summaries.", onSelect: () => options.onAction("logs") },
				{ kind: "action", id: "settings", label: "Settings", description: "Adjust orchestration defaults and preferences.", onSelect: () => options.onAction("settings") },
			],
		};
	}

	buildModelMenuItems(options: {
		models: Model<any>[];
		onSelectModel: (providerId: string, modelId: string) => Promise<void>;
		onError: (context: string, error: unknown, details?: Record<string, unknown>) => void;
		onNoModels: () => void;
	}): ShellMenuItem[] {
		if (options.models.length === 0) {
			return [{
				kind: "action",
				id: "no-models",
				label: "No models available",
				description: "Connect a provider or retry setup.",
				onSelect: () => options.onNoModels(),
			}];
		}
		return options.models.map((model) => ({
			kind: "action" as const,
			id: `${model.provider}/${model.id}`,
			label: `${model.provider}/${model.id}`,
			description: model.name,
			onSelect: async () => {
				try {
					await options.onSelectModel(model.provider, model.id);
				} catch (error) {
					options.onError("setDefaultModel", error, { provider: model.provider, modelId: model.id });
				}
			},
		}));
	}

	buildThinkingMenuItems(options: {
		levels: string[];
		onSelect: (level: string) => void;
	}): ShellMenuItem[] {
		return options.levels.map((level) => ({
			kind: "action" as const,
			id: `thinking:${level}`,
			label: level,
			description: "Set reasoning budget",
			onSelect: () => options.onSelect(level),
		}));
	}
}
