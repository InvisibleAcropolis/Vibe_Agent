import { AppConfig, type AppConfig as AppConfigShape } from "../app-config.js";

export class AppConfigRepository {
	private currentConfig: AppConfigShape;

	constructor(private readonly configPath: string) {
		this.currentConfig = AppConfig.load(configPath);
	}

	get path(): string {
		return this.configPath;
	}

	get(): AppConfigShape {
		return this.currentConfig;
	}

	save(config: AppConfigShape): void {
		this.currentConfig = config;
		AppConfig.save(config, this.configPath);
	}
}
