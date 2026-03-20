import type { PiMonoAppDebugger } from "./app-debugger.js";
import type { AppStateStore } from "./app-state-store.js";
import type { AgentHost } from "./agent-host.js";
import type { ExtensionUiHost } from "./extension-ui-host.js";
import type { AgentSessionEvent } from "./local-coding-agent.js";
import { renderAgentMessages } from "./message-renderer.js";
import type { ShellView } from "./shell-view.js";

function getEventDetails(event: AgentSessionEvent): Record<string, unknown> {
	const details: Record<string, unknown> = { type: event.type };
	if ("reason" in event) details.reason = event.reason;
	if ("attempt" in event) details.attempt = event.attempt;
	if ("maxAttempts" in event) details.maxAttempts = event.maxAttempts;
	if ("delayMs" in event) details.delayMs = event.delayMs;
	if ("success" in event) details.success = event.success;
	if ("errorMessage" in event) details.errorMessage = event.errorMessage;
	if ("finalError" in event) details.finalError = event.finalError;
	if ("aborted" in event) details.aborted = event.aborted;
	if ("willRetry" in event) details.willRetry = event.willRetry;
	return details;
}

export interface StartupController {
	initialize(): Promise<void>;
	dispose(): void;
}

export class DefaultStartupController implements StartupController {
	private unsubscribe?: () => void;

	constructor(
		private readonly host: AgentHost,
		private readonly extensionUiHost: ExtensionUiHost,
		private readonly shellView: ShellView,
		private readonly stateStore: AppStateStore,
		private readonly debuggerSink: PiMonoAppDebugger,
		private readonly writeDebugSnapshot: (reason: string) => string | undefined,
	) {}

	async initialize(): Promise<void> {
		this.stateStore.setLastStartupPhase("host.start");
		this.debuggerSink.log("app.phase.start", { phase: "host.start" });
		try {
			const result = await this.host.start(this.extensionUiHost.createContext());
			this.shellView.footerData.setAvailableProviderCount(result.availableProviderCount);
			this.stateStore.setHelpMessage(result.modelFallbackMessage);
			if (result.availableProviderCount === 0) {
				this.stateStore.setHelpMessage(
					"No provider configured — run /login to connect one.",
				);
			}
			this.stateStore.setStatusMessage("Agent ready.");

			const renderResult = renderAgentMessages(result.messages, {
				hideThinking: this.stateStore.getState().hideThinking,
				toolOutputExpanded: this.stateStore.getState().toolOutputExpanded,
				tui: this.shellView.tui,
			});
			this.shellView.setMessages(renderResult.components);
			for (const artifact of renderResult.artifacts) {
				this.stateStore.addArtifact(artifact);
			}
			this.shellView.refresh();
			this.debuggerSink.log("app.phase.end", { phase: "host.start", availableProviderCount: result.availableProviderCount });

			this.stateStore.setLastStartupPhase("host.subscribe");
			this.unsubscribe = this.host.subscribe((event) => {
				this.debuggerSink.log("host.event", getEventDetails(event));
				this.syncFromHost();
			});
			this.debuggerSink.log("app.phase.end", { phase: "host.subscribe" });
		} catch (error) {
			this.debuggerSink.logError("startup.initialize", error, { phase: this.stateStore.getState().lastStartupPhase });
			this.stateStore.setStatusMessage(`Startup failed: ${error instanceof Error ? error.message : String(error)}`);
			this.stateStore.setHelpMessage("Check the debug bundle or use Shift+Ctrl+D for a manual snapshot.");
			this.shellView.refresh();
			this.writeDebugSnapshot("startup-error");
			throw error;
		}
	}

	dispose(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
	}

	private syncFromHost(): void {
		const renderResult = renderAgentMessages(this.host.getMessages(), {
			hideThinking: this.stateStore.getState().hideThinking,
			toolOutputExpanded: this.stateStore.getState().toolOutputExpanded,
			tui: this.shellView.tui,
		});
		this.shellView.setMessages(renderResult.components);

		// Sync new artifacts into state store
		const existingIds = new Set(this.stateStore.getState().artifacts.map((a) => a.id));
		for (const artifact of renderResult.artifacts) {
			if (!existingIds.has(artifact.id)) {
				this.stateStore.addArtifact(artifact);
			}
		}

		this.shellView.refresh();
	}
}
