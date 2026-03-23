import type { AgentHost, AgentHostState } from "../agent-host.js";
import type { AppStateStore } from "../app-state-store.js";
import type { FooterDataProvider } from "../footer-data-provider.js";
import { RuntimeCoordinator } from "../runtime/runtime-coordinator.js";
import type { AppSessionCoordinator } from "./app-session-coordinator.js";

export class AppRuntimePresentation {
	constructor(
		private readonly dependencies: {
			stateStore: AppStateStore;
			footerData: FooterDataProvider;
			host: AgentHost;
			runtimeCoordinator: RuntimeCoordinator;
			sessionCoordinator: AppSessionCoordinator;
			getHostState: () => AgentHostState | undefined;
			syncMessages: () => void;
		},
	) {}

	refreshProviderAvailability(): void {
		this.dependencies.footerData.setAvailableProviderCount(this.dependencies.sessionCoordinator.countAvailableProviders());
	}

	refreshCockpitContext(): void {
		if (this.dependencies.sessionCoordinator.isSetupFlowActive()) {
			return;
		}

		const gate = this.dependencies.sessionCoordinator.assessStartupGate();
		const validation = this.dependencies.sessionCoordinator.validateSavedDefault();
		const hostState = this.dependencies.getHostState();
		const hostSelection = this.dependencies.sessionCoordinator.getActiveHostSelection(hostState);
		const hasMessages = (hostState?.messageCount ?? 0) > 0;

		if (gate.kind === "needs-provider") {
			this.dependencies.stateStore.setContextBanner(
				"Connect a provider",
				"Use /setup to connect Antigravity or OpenAI OAuth, then choose a default model.",
				"warning",
			);
			return;
		}

		if (!hostSelection && validation.kind === "invalid-provider") {
			this.dependencies.stateStore.setContextBanner(
				"Invalid Provider",
				validation.reason === "saved-provider-unavailable"
					? "The saved default provider is unavailable. Run /provider or /setup to select a valid provider."
					: "No default provider is saved. Run /provider or /setup to choose one.",
				"warning",
			);
			return;
		}

		if (!hostSelection && validation.kind === "invalid-model") {
			this.dependencies.stateStore.setContextBanner(
				"Invalid Model",
				validation.reason === "saved-model-unavailable"
					? `The saved model for ${validation.providerId} is unavailable. Run /model or /setup to select a replacement.`
					: `No default model is saved for ${validation.providerId}. Run /model or /setup to choose one.`,
				"warning",
			);
			return;
		}

		const helpMessage = this.dependencies.stateStore.getState().helpMessage;
		if (helpMessage && !hasMessages) {
			this.dependencies.stateStore.setContextBanner("Attention", helpMessage, "warning");
			return;
		}

		this.dependencies.stateStore.setContextBanner(undefined, undefined);
	}

	applyStartupValidationStatus(): void {
		if (this.dependencies.sessionCoordinator.getActiveHostSelection(this.dependencies.getHostState())) {
			return;
		}

		const validation = this.dependencies.sessionCoordinator.validateSavedDefault();
		if (validation.kind === "invalid-provider") {
			this.dependencies.stateStore.setStatusMessage("Invalid Provider");
			return;
		}
		if (validation.kind === "invalid-model") {
			this.dependencies.stateStore.setStatusMessage("Invalid Model");
		}
	}

	handleRuntimeActivated(): void {
		this.dependencies.stateStore.resetActiveThinking();
		this.syncRuntimeDisplayState();
		this.dependencies.syncMessages();
		this.refreshProviderAvailability();
		this.refreshCockpitContext();
	}

	syncRuntimeDisplayState(): void {
		try {
			const descriptor = this.dependencies.host.getActiveRuntimeDescriptor();
			const conversationLabel = descriptor.id === "orc" ? "Orc orchestration chat" : "Coding chat";
			this.dependencies.stateStore.setActiveRuntime({
				id: descriptor.id,
				name: descriptor.displayName,
				conversationLabel,
			});
			this.dependencies.footerData.setSessionMode(conversationLabel);
		} catch {
			this.dependencies.stateStore.setActiveRuntime({ id: "coding", name: "Coding Runtime", conversationLabel: "Coding chat" });
			this.dependencies.footerData.setSessionMode("Coding chat");
		}
	}

	getRuntimeContext(): { runtimeId: string; sessionId?: string } {
		try {
			return {
				runtimeId: this.dependencies.runtimeCoordinator.getActiveRuntime().descriptor.id,
				sessionId: this.dependencies.getHostState()?.sessionId,
			};
		} catch {
			return {
				runtimeId: "coding",
				sessionId: this.dependencies.getHostState()?.sessionId,
			};
		}
	}
}
