import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "./local-coding-agent.js";

export type AppConfig = {
	setupComplete: boolean;
	selectedProvider?: string;
	selectedModelId?: string;
	selectedTheme?: string;
};

const DEFAULT_CONFIG: AppConfig = {
	setupComplete: false,
};

function normalizeConfig(config: Partial<AppConfig>): AppConfig {
	return {
		setupComplete: config.setupComplete === true,
		selectedProvider: typeof config.selectedProvider === "string" ? config.selectedProvider : undefined,
		selectedModelId: typeof config.selectedModelId === "string" ? config.selectedModelId : undefined,
		selectedTheme: typeof config.selectedTheme === "string" ? config.selectedTheme : undefined,
	};
}

function defaultConfigPath(): string {
	return join(getAgentDir(), "future-ide-agent-config.json");
}

export const AppConfig = {
	load(configPath: string = defaultConfigPath()): AppConfig {
		if (!existsSync(configPath)) {
			return { ...DEFAULT_CONFIG };
		}
		try {
			const raw = readFileSync(configPath, "utf-8");
			return normalizeConfig(JSON.parse(raw) as Partial<AppConfig>);
		} catch {
			return { ...DEFAULT_CONFIG };
		}
	},

	save(config: AppConfig, configPath: string = defaultConfigPath()): void {
		const dir = dirname(configPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
		const nextConfig = normalizeConfig(config);
		const tempPath = `${configPath}.tmp`;
		writeFileSync(tempPath, JSON.stringify(nextConfig, null, 2), "utf-8");
		renameSync(tempPath, configPath);
	},
};
