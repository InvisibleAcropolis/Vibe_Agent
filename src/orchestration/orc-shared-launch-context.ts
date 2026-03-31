import type { Model } from "@mariozechner/pi-ai";
import type { AppConfigRepository } from "../app/app-config-repository.js";
import { AuthStorage, ModelRegistry } from "../local-coding-agent.js";

export interface OrcResolvedProviderMapping {
	providerId: string;
	modelId: string;
	modelSpec: string;
	apiKeyEnvVar: string;
	requiredPythonModules: string[];
}

export interface OrcResolvedLaunchContext extends OrcResolvedProviderMapping {
	apiKey: string;
	model: Model<any>;
	credentialType: "api_key" | "oauth" | "environment";
}

export class OrcSharedLaunchContextResolver {
	constructor(
		private readonly configRepository: AppConfigRepository,
		private readonly authStorage: AuthStorage,
		private readonly modelRegistry: ModelRegistry,
	) {}

	async resolveSavedSelection(): Promise<OrcResolvedLaunchContext> {
		const config = this.configRepository.get();
		if (!config.selectedProvider) {
			throw new Error("No default provider is saved. Choose a provider in the main Vibe session before summoning Orc.");
		}
		if (!config.selectedModelId) {
			throw new Error(`No default model is saved for provider '${config.selectedProvider}'. Choose a model in the main Vibe session before summoning Orc.`);
		}
		return await this.resolveExplicitSelection(config.selectedProvider, config.selectedModelId);
	}

	async resolveExplicitSelection(providerId: string, modelId: string): Promise<OrcResolvedLaunchContext> {
		const model = this.modelRegistry.find(providerId, modelId);
		if (!model) {
			throw new Error(`The saved Orc model '${providerId}/${modelId}' is unavailable in the current model registry.`);
		}
		const mapping = mapProviderToDeepagentModel(providerId, modelId);
		const apiKey = await this.authStorage.getApiKey(providerId);
		if (!apiKey) {
			throw new Error(`No credential is available for provider '${providerId}'. Refresh auth in the main Vibe session before summoning Orc.`);
		}
		const credential = this.authStorage.get(providerId);
		return {
			...mapping,
			apiKey,
			model,
			credentialType: credential?.type ?? "environment",
		};
	}
}

export function mapProviderToDeepagentModel(providerId: string, modelId: string): OrcResolvedProviderMapping {
	switch (providerId) {
		case "anthropic":
			return {
				providerId,
				modelId,
				modelSpec: `anthropic:${modelId}`,
				apiKeyEnvVar: "ANTHROPIC_API_KEY",
				requiredPythonModules: ["langchain", "langchain_anthropic", "deepagents", "langgraph"],
			};
		case "openai":
		case "openai-codex":
			return {
				providerId,
				modelId,
				modelSpec: `openai:${modelId}`,
				apiKeyEnvVar: "OPENAI_API_KEY",
				requiredPythonModules: ["langchain", "langchain_openai", "langchain_anthropic", "deepagents", "langgraph"],
			};
		case "google":
		case "google-antigravity":
		case "google-gemini-cli":
		case "google-vertex":
			throw new Error(`Provider '${providerId}' is not mapped for Orc deepagent yet. Google-backed Orc sessions stay blocked until the matching Python provider stack is installed and mapped explicitly.`);
		default:
			throw new Error(`Provider '${providerId}' is not supported by the Orc deepagent bridge.`);
	}
}
