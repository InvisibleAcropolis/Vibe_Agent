import type { AppConfig } from "../app-config.js";

export interface SetupActions {
	openSetupHub(): Promise<void>;
	openProviderSetup(): Promise<void>;
	openModelSetup(): Promise<void>;
	openLogoutFlow(): Promise<void>;
	setDefaultModel(providerId: string, modelId: string): Promise<void>;
	setThinkingVisibility(show: boolean): void;
}

export interface CommandConfigStore {
	getConfig(): AppConfig;
	saveConfig(config: AppConfig): void;
}
