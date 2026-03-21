import type { AppConfig } from "../app-config.js";
import type { AgentHostState } from "../agent-host.js";
import type { AuthStorage, ModelRegistry } from "../local-coding-agent.js";

export type StartupGateAssessment =
	| { kind: "continue" }
	| { kind: "needs-provider"; reason: "first-run" | "disconnected" };

export type SavedDefaultValidation =
	| { kind: "valid"; providerId: string; modelId: string }
	| { kind: "invalid-provider"; reason: "missing-provider" | "saved-provider-unavailable" }
	| { kind: "invalid-model"; providerId: string; reason: "missing-model" | "saved-model-unavailable" };

export class AppSetupService {
	constructor(
		private readonly authStorage: Pick<AuthStorage, "list">,
		private readonly modelRegistry: Pick<ModelRegistry, "getAvailable">,
		private readonly envApiKeyLookup: (providerId: string) => string | undefined,
	) {}

	assessStartupGate(config: AppConfig): StartupGateAssessment {
		if (this.hasCredentialSource()) {
			return { kind: "continue" };
		}
		return {
			kind: "needs-provider",
			reason: config.setupComplete ? "disconnected" : "first-run",
		};
	}

	validateSavedDefault(config: AppConfig): SavedDefaultValidation {
		const providerId = config.selectedProvider;
		if (!providerId) {
			return { kind: "invalid-provider", reason: "missing-provider" };
		}

		const modelId = config.selectedModelId;
		if (!modelId) {
			return { kind: "invalid-model", providerId, reason: "missing-model" };
		}

		const availableModels = this.modelRegistry.getAvailable();
		if (availableModels.length === 0) {
			return { kind: "valid", providerId, modelId };
		}

		const providerModels = availableModels.filter((model) => model.provider === providerId);
		if (providerModels.length === 0) {
			return { kind: "invalid-provider", reason: "saved-provider-unavailable" };
		}

		const savedModel = providerModels.find((model) => model.id === modelId);
		if (!savedModel) {
			return { kind: "invalid-model", providerId, reason: "saved-model-unavailable" };
		}

		return { kind: "valid", providerId, modelId: savedModel.id };
	}

	normalizeConfig(config: AppConfig, hostState?: AgentHostState): AppConfig | undefined {
		const hostSelection = this.getActiveHostSelection(hostState);
		if (hostSelection) {
			if (
				config.setupComplete
				&& config.selectedProvider === hostSelection.providerId
				&& config.selectedModelId === hostSelection.modelId
			) {
				return undefined;
			}
			return {
				...config,
				setupComplete: true,
				selectedProvider: hostSelection.providerId,
				selectedModelId: hostSelection.modelId,
			};
		}

		const validation = this.validateSavedDefault(config);
		if (validation.kind !== "valid") {
			return undefined;
		}

		if (
			config.setupComplete
			&& config.selectedProvider === validation.providerId
			&& config.selectedModelId === validation.modelId
		) {
			return undefined;
		}

		return {
			...config,
			setupComplete: true,
			selectedProvider: validation.providerId,
			selectedModelId: validation.modelId,
		};
	}

	countAvailableProviders(): number {
		return new Set(this.modelRegistry.getAvailable().map((model) => model.provider)).size;
	}

	getActiveHostSelection(hostState?: AgentHostState): { providerId: string; modelId: string } | undefined {
		const hostModel = hostState?.model;
		if (!hostModel?.provider || !hostModel.id) {
			return undefined;
		}
		return {
			providerId: hostModel.provider,
			modelId: hostModel.id,
		};
	}

	private hasCredentialSource(): boolean {
		return this.authStorage.list().length > 0 || this.anyEnvApiKeySet();
	}

	private anyEnvApiKeySet(): boolean {
		const providers = ["anthropic", "openai", "google-antigravity", "openai-codex", "github-copilot", "google-gemini-cli"];
		return providers.some((id) => !!this.envApiKeyLookup(id));
	}
}
