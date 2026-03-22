import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getVibeConfigPath } from "./durable/durable-paths.js";
import type { OrcHumanEscalationReason, OrcSessionSecurityKind } from "./orchestration/orc-security.js";

export type AppConfig = {
	setupComplete: boolean;
	selectedProvider?: string;
	selectedModelId?: string;
	selectedTheme?: string;
	showThinking?: boolean;
	orchestration?: {
		sessionKind?: OrcSessionSecurityKind;
		allowedWorkingDirectories?: string[];
		maximumConcurrency?: number;
		humanEscalationThresholds?: {
			requiresApprovalAfter?: number;
			reasons?: OrcHumanEscalationReason[];
		};
		workerSandbox?: {
			workspaceRoot?: string;
			durableRoot?: string;
			writeAllowedPaths?: string[];
			blockedCommandPatterns?: string[];
		};
	};
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
		showThinking: typeof config.showThinking === "boolean" ? config.showThinking : true,
		orchestration: normalizeOrchestrationConfig(config.orchestration),
	};
}

function normalizeStringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const items = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
	return items.length > 0 ? items : [];
}

function normalizeOrchestrationConfig(config: AppConfig["orchestration"] | undefined): AppConfig["orchestration"] {
	if (!config) {
		return undefined;
	}
	return {
		sessionKind:
			config.sessionKind === "main-app" || config.sessionKind === "ephemeral-worker" ? config.sessionKind : undefined,
		allowedWorkingDirectories: normalizeStringList(config.allowedWorkingDirectories),
		maximumConcurrency:
			typeof config.maximumConcurrency === "number" && Number.isFinite(config.maximumConcurrency) ? config.maximumConcurrency : undefined,
		humanEscalationThresholds: config.humanEscalationThresholds
			? {
					requiresApprovalAfter:
						typeof config.humanEscalationThresholds.requiresApprovalAfter === "number"
						&& Number.isFinite(config.humanEscalationThresholds.requiresApprovalAfter)
							? config.humanEscalationThresholds.requiresApprovalAfter
							: undefined,
					reasons: Array.isArray(config.humanEscalationThresholds.reasons)
						? config.humanEscalationThresholds.reasons.filter(
								(reason): reason is OrcHumanEscalationReason =>
									reason === "filesystem-write"
									|| reason === "destructive-command"
									|| reason === "network-access"
									|| reason === "privileged-tool",
							)
						: undefined,
				}
			: undefined,
		workerSandbox: config.workerSandbox
			? {
					workspaceRoot: typeof config.workerSandbox.workspaceRoot === "string" ? config.workerSandbox.workspaceRoot : undefined,
					durableRoot: typeof config.workerSandbox.durableRoot === "string" ? config.workerSandbox.durableRoot : undefined,
					writeAllowedPaths: normalizeStringList(config.workerSandbox.writeAllowedPaths),
					blockedCommandPatterns: normalizeStringList(config.workerSandbox.blockedCommandPatterns),
				}
			: undefined,
	};
}

function defaultConfigPath(): string {
	return getVibeConfigPath();
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
