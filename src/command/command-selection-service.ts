import { basename } from "node:path";
import type { PiMonoAppDebugger } from "../app-debugger.js";
import type { AgentHost } from "../agent-host.js";
import { SessionsPanel } from "../components/sessions-panel.js";
import type { EditorController } from "../editor-controller.js";
import type { OverlayController } from "../overlay-controller.js";
import { BUILTIN_COMMAND_META, getBuiltInCommands } from "./command-registry.js";

export class CommandSelectionService {
	constructor(
		private readonly dependencies: {
			host: AgentHost;
			overlayController: OverlayController;
			editorController: EditorController;
			debuggerSink: PiMonoAppDebugger;
			onError: (context: string, error: unknown, details?: Record<string, unknown>) => void;
		},
	) {}

	openCommandPalette(): void {
		void this.dependencies.host
			.getCommands()
			.then((commands) => {
				this.dependencies.overlayController.openSelectOverlay(
					"command-palette",
					"Command Palette",
					"Select a setup flow, slash command, skill, or built-in control.",
					getBuiltInCommands(commands).map((command) => ({
						value: command,
						label: `${BUILTIN_COMMAND_META[command.name]?.category ?? command.source} · /${command.name}`,
						description: command.description ?? command.source,
					})),
					(command) => this.dependencies.editorController.setText(`/${command.name}`),
				);
			})
			.catch((error) => this.dependencies.onError("openCommandPalette", error));
	}

	openThinkingSelector(): void {
		const levels = this.dependencies.host.getAvailableThinkingLevels();
		this.dependencies.overlayController.openSelectOverlay(
			"thinking-selector",
			"Thinking Selector",
			"Choose the reasoning budget for the current model.",
			levels.map((level) => ({ value: level, label: level })),
			(level) => {
				void this.dependencies.host.setThinkingLevel(level).catch((error) => this.dependencies.onError("setThinkingLevel", error));
			},
		);
	}

	openSessionSelector(scope: "current" | "all"): void {
		void this.dependencies.host
			.listSessions(scope)
			.then((sessions) => {
				this.dependencies.overlayController.openSelectOverlay(
					"session-selector",
					"Session Selector",
					`Switch to a ${scope} session.`,
					sessions.map((session) => ({
						value: session,
						label: session.name ?? basename(session.path) ?? session.id,
						description: session.path,
					})),
					(session) => {
						void this.dependencies.host.switchSession(session.path).catch((error) => this.dependencies.onError("switchSession", error));
					},
				);
			})
			.catch((error) => this.dependencies.onError("openSessionSelector", error, { scope }));
	}

	openSessionsBrowserSurface(): void {
		const panel = new SessionsPanel({
			getSessions: async () => await this.dependencies.host.listSessions("all"),
			getCurrentSessionFile: () => this.dependencies.host.getState().sessionFile,
			onSwitch: async (sessionPath) => {
				await this.dependencies.host.switchSession(sessionPath);
			},
			onClose: () => this.dependencies.overlayController.closeOverlay("sessions-browser"),
		});
		this.dependencies.overlayController.showCustomOverlay("sessions-browser", panel, {
			width: "56%",
			maxHeight: "75%",
			anchor: "center",
			margin: 1,
			minWidth: 48,
			minHeight: 16,
			floatingTitle: "Sessions Browser",
		});
	}

	async openForkSelector(): Promise<void> {
		try {
			const messages = await this.dependencies.host.getForkMessages();
			this.dependencies.overlayController.openSelectOverlay(
				"fork-selector",
				"Fork Selector",
				"Select a user message to fork from.",
				messages.map((message) => ({
					value: message,
					label: message.text.slice(0, 80),
					description: message.entryId,
				})),
				(message) => {
					void this.dependencies.host
						.fork(message.entryId)
						.then((result) => {
							if (!result.cancelled && result.text) {
								this.dependencies.editorController.setText(result.text);
							}
						})
						.catch((error) => this.dependencies.onError("fork", error, { entryId: message.entryId }));
				},
			);
		} catch (error) {
			this.dependencies.onError("openForkSelector", error);
		}
	}

	async openTreeSelector(): Promise<void> {
		try {
			const targets = await this.dependencies.host.getTreeTargets();
			this.dependencies.overlayController.openSelectOverlay(
				"tree-selector",
				"Tree Selector",
				"Navigate the current session tree.",
				targets.map((target) => ({
					value: target,
					label: target.text.slice(0, 80),
					description: target.entryId,
				})),
				(target) => {
					void this.dependencies.host
						.navigateTree(target.entryId)
						.then((result) => {
							if (!result.cancelled && result.editorText) {
								this.dependencies.editorController.setText(result.editorText);
							}
						})
						.catch((error) => this.dependencies.onError("navigateTree", error, { entryId: target.entryId }));
				},
			);
		} catch (error) {
			this.dependencies.onError("openTreeSelector", error);
		}
	}
}
