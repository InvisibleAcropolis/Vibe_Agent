import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { AppMessageSyncService } from "./app/app-message-sync-service.js";
import type { PiMonoAppDebugger } from "./app-debugger.js";
import type { ActiveThinkingState, AppStateStore } from "./app-state-store.js";
import type { AgentHost } from "./agent-host.js";
import type { ExtensionUiHost } from "./extension-ui-host.js";
import type { AgentSessionEvent } from "./local-coding-agent.js";
import { extractThinkingTextFromAssistantMessage } from "./message-renderer.js";
import type { ShellView } from "./shell-view.js";

const OPENAI_REASONING_APIS = new Set(["openai-responses", "azure-openai-responses", "openai-codex-responses"]);
const THINKING_ERROR_TEXT = "* e r r o r *";

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
	if ("assistantMessageEvent" in event) details.assistantMessageEventType = event.assistantMessageEvent.type;
	return details;
}

function getThinkingMeta(message: AgentMessage): Pick<ActiveThinkingState, "provider" | "modelId" | "api"> {
	if (message.role !== "assistant") {
		return {};
	}
	const assistant = message as AssistantMessage;
	return {
		provider: assistant.provider,
		modelId: assistant.model,
		api: assistant.api,
	};
}

function createThinkingState(
	text: string,
	options: {
		hasTurnState: boolean;
		hasThinkingEvents: boolean;
		turnActive: boolean;
		message?: AgentMessage;
	},
): ActiveThinkingState {
	return {
		text,
		hasTurnState: options.hasTurnState,
		hasThinkingEvents: options.hasThinkingEvents,
		turnActive: options.turnActive,
		...getThinkingMeta(options.message as AgentMessage),
	};
}

function isOpenAiReasoningApi(api: string | undefined): boolean {
	return !!api && OPENAI_REASONING_APIS.has(api);
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
		private readonly messageSync: AppMessageSyncService,
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
			this.messageSync.sync({ messages: result.messages, hostState: result.state });
			this.debuggerSink.log("app.phase.end", { phase: "host.start", availableProviderCount: result.availableProviderCount });

			this.stateStore.setLastStartupPhase("host.subscribe");
			this.unsubscribe = this.host.subscribe((event) => {
				this.debuggerSink.log("host.event", getEventDetails(event));
				this.syncThinkingFromEvent(event);
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
		this.messageSync.sync();
	}

	private syncThinkingFromEvent(event: AgentSessionEvent): void {
		if (event.type === "message_start" && event.message?.role === "assistant") {
			this.stateStore.setActiveThinking(
				createThinkingState("", {
					hasTurnState: true,
					hasThinkingEvents: false,
					turnActive: true,
					message: event.message,
				}),
			);
			return;
		}

		if (event.type === "message_update" && event.message?.role === "assistant") {
			const assistant = event.message as AssistantMessage;
			const current = this.stateStore.getState().activeThinking;
			const thinkingText = extractThinkingTextFromAssistantMessage(assistant) ?? current.text;
			const assistantEvent = event.assistantMessageEvent;
			if (assistantEvent.type === "thinking_start") {
				this.stateStore.setActiveThinking(
					createThinkingState("", {
						hasTurnState: true,
						hasThinkingEvents: true,
						turnActive: true,
						message: event.message,
					}),
				);
				return;
			}
			if (assistantEvent.type === "thinking_delta" || assistantEvent.type === "thinking_end") {
				this.stateStore.setActiveThinking(
					createThinkingState(thinkingText, {
						hasTurnState: true,
						hasThinkingEvents: true,
						turnActive: true,
						message: event.message,
					}),
				);
			}
			return;
		}

		if (event.type === "message_end" && event.message?.role === "assistant") {
			const assistant = event.message as AssistantMessage;
			const current = this.stateStore.getState().activeThinking;
			const finalThinkingText = extractThinkingTextFromAssistantMessage(assistant);
			const hostState = this.host.getState();
			const reasoningExpected = hostState.thinkingLevel !== "off" && isOpenAiReasoningApi(assistant.api);
			if (finalThinkingText) {
				this.stateStore.setActiveThinking(
					createThinkingState(finalThinkingText, {
						hasTurnState: true,
						hasThinkingEvents: true,
						turnActive: false,
						message: event.message,
					}),
				);
				return;
			}

			if (reasoningExpected) {
				this.stateStore.setActiveThinking(
					createThinkingState(THINKING_ERROR_TEXT, {
						hasTurnState: true,
						hasThinkingEvents: current.hasThinkingEvents,
						turnActive: false,
						message: event.message,
					}),
				);
				this.debuggerSink.log("thinking.absent", {
					provider: assistant.provider,
					modelId: assistant.model,
					api: assistant.api,
					reasoningExpected,
					hasThinkingEvents: current.hasThinkingEvents,
					thinkingLevel: hostState.thinkingLevel,
					contentTypes: assistant.content.map((content) => content.type),
					thinkingSignaturesPresent: assistant.content.filter((content) => content.type === "thinking").map((content) => {
						const block = content as Extract<AssistantMessage["content"][number], { type: "thinking" }>;
						return typeof block.thinkingSignature === "string" && block.thinkingSignature.length > 0;
					}),
				});
				return;
			}

			if (current.hasTurnState) {
				const nextState = createThinkingState("", {
					hasTurnState: true,
					hasThinkingEvents: current.hasThinkingEvents,
					turnActive: false,
					message: event.message,
				});
				this.stateStore.setActiveThinking(nextState);
				if (isOpenAiReasoningApi(assistant.api) && !current.hasThinkingEvents) {
					this.debuggerSink.log("thinking.absent", {
						provider: assistant.provider,
						modelId: assistant.model,
						api: assistant.api,
						reasoningExpected: false,
						hasThinkingEvents: current.hasThinkingEvents,
					});
				}
			}
		}
	}
}
