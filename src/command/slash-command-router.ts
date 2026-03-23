import type { PiMonoAppDebugger } from "../app-debugger.js";
import type { AgentHost } from "../agent-host.js";
import type { AppStateStore } from "../app-state-store.js";
import type { EditorController } from "../editor-controller.js";
import type { SetupActions } from "./command-types.js";

export class SlashCommandRouter {
	constructor(
		private readonly dependencies: {
			host: AgentHost;
			editorController: EditorController;
			stateStore: AppStateStore;
			debuggerSink: PiMonoAppDebugger;
			setupActions: SetupActions;
			clearMessages: () => void;
			handleThemeCommand: (text: string) => void;
			writeSnapshotAndStatus: (reason: string) => void;
			actions: {
				openSettingsOverlay: () => void;
				openSessionSelector: (scope: "current" | "all") => void;
				openForkSelector: () => Promise<void>;
				openTreeSelector: () => Promise<void>;
				openThinkingSelector: () => void;
				openStatsOverlay: () => void;
				openArtifactViewer: () => void;
				openHelpOverlay: () => void;
				summonOrc: () => Promise<void>;
				resumeOrcThread: () => void;
				inspectOrcCheckpoints: () => void;
				rewindOrcCheckpoint: () => void;
				onError: (context: string, error: unknown, details?: Record<string, unknown>) => void;
			};
		},
	) {}

	async handle(text: string): Promise<boolean> {
		this.dependencies.debuggerSink.log("slash.command", { command: text.split(/\s+/)[0] });

		if (text === "/settings") {
			this.resetEditor();
			this.dependencies.actions.openSettingsOverlay();
			return true;
		}
		if (text === "/resume") {
			this.resetEditor();
			this.dependencies.actions.openSessionSelector("all");
			return true;
		}
		if (text === "/fork") {
			this.resetEditor();
			await this.dependencies.actions.openForkSelector();
			return true;
		}
		if (text === "/tree") {
			this.resetEditor();
			await this.dependencies.actions.openTreeSelector();
			return true;
		}
		if (text === "/model") {
			this.resetEditor();
			await this.dependencies.setupActions.openModelSetup();
			return true;
		}
		if (text === "/thinking") {
			this.resetEditor();
			this.dependencies.actions.openThinkingSelector();
			return true;
		}
		if (text === "/stats") {
			this.resetEditor();
			this.dependencies.actions.openStatsOverlay();
			return true;
		}
		if (text === "/artifacts") {
			this.resetEditor();
			this.dependencies.actions.openArtifactViewer();
			return true;
		}
		if (text === "/summon-orc") {
			this.resetEditor();
			await this.dependencies.actions.summonOrc();
			return true;
		}
		if (text === "/orc-resume") {
			this.resetEditor();
			this.dependencies.actions.resumeOrcThread();
			return true;
		}
		if (text === "/orc-checkpoints") {
			this.resetEditor();
			this.dependencies.actions.inspectOrcCheckpoints();
			return true;
		}
		if (text === "/orc-rewind") {
			this.resetEditor();
			this.dependencies.actions.rewindOrcCheckpoint();
			return true;
		}
		if (text === "/help") {
			this.resetEditor();
			this.dependencies.actions.openHelpOverlay();
			return true;
		}
		if (text === "/clear") {
			this.resetEditor();
			this.dependencies.clearMessages();
			this.dependencies.stateStore.setStatusMessage("Chat display cleared.");
			return true;
		}
		if (text === "/debug-dump") {
			this.resetEditor();
			this.dependencies.writeSnapshotAndStatus("slash-debug-dump");
			return true;
		}
		if (text.startsWith("/compact")) {
			this.resetEditor();
			const customInstructions = text.slice("/compact".length).trim() || undefined;
			void this.dependencies.host.compact(customInstructions).catch((error) => this.dependencies.actions.onError("compact", error));
			this.dependencies.stateStore.setStatusMessage("Compacting context...");
			return true;
		}
		if (text.startsWith("/name ")) {
			this.resetEditor();
			await this.dependencies.host.setSessionName(text.slice(6).trim());
			return true;
		}
		if (text.startsWith("/export")) {
			this.resetEditor();
			const outputPath = text.split(/\s+/)[1];
			try {
				const path = await this.dependencies.host.exportHtml(outputPath);
				this.dependencies.stateStore.setStatusMessage(`Exported to ${path}`);
			} catch (error) {
				this.dependencies.actions.onError("exportHtml", error);
			}
			return true;
		}
		if (text === "/login" || text === "/provider" || text === "/setup") {
			this.resetEditor();
			if (text === "/setup") {
				await this.dependencies.setupActions.openSetupHub();
			} else {
				await this.dependencies.setupActions.openProviderSetup();
			}
			return true;
		}
		if (text === "/theme" || text.startsWith("/theme ")) {
			this.resetEditor();
			this.dependencies.handleThemeCommand(text);
			return true;
		}
		if (text === "/logout") {
			this.resetEditor();
			await this.dependencies.setupActions.openLogoutFlow();
			return true;
		}

		return false;
	}

	private resetEditor(): void {
		this.dependencies.editorController.setText("");
	}
}
