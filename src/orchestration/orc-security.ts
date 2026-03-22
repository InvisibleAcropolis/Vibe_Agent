import type { AppConfig } from "../app-config.js";

export type OrcSessionSecurityKind = "main-app" | "ephemeral-worker";
export type OrcHumanEscalationReason = "filesystem-write" | "destructive-command" | "network-access" | "privileged-tool";
export type OrcSecurityEventKind = "approval-required" | "blocked-command";

/**
 * Text shown in the UI when the orchestration runtime needs to stop for review.
 * Keep these strings stable so Phase 2/3 UIs can bind to them before enforcement lands.
 */
export const ORC_SECURITY_STATUS_TEXT: Record<OrcSecurityEventKind, string> = {
	"approval-required": "Approval required",
	"blocked-command": "Blocked command",
};

/**
 * Placeholder event payload for the Orc I/O contract.
 * Future enforcement points should emit these events before any worker-side tool call proceeds.
 */
export interface OrcSecurityEvent {
	kind: OrcSecurityEventKind;
	statusText: string;
	detail: string;
	command?: string;
	workerId?: string;
	createdAt: string;
}

/**
 * Phase 1 configuration for future worker sandboxing.
 * Enforcement should happen before creating sub-agent tool contexts so workers never observe a broader sandbox.
 */
export interface OrcWorkerSandboxConfig {
	workspaceRoot: string;
	durableRoot: string;
	writeAllowedPaths: string[];
	blockedCommandPatterns: string[];
}

/**
 * Phase 1 policy bundle for orchestration security.
 * Later phases should enforce these values at runtime/session creation and before every tool invocation.
 */
export interface OrcSecurityPolicy {
	allowedWorkingDirectories: string[];
	blockedCommandPatterns: string[];
	humanEscalationThresholds: {
		requiresApprovalAfter: number;
		reasons: OrcHumanEscalationReason[];
	};
	maximumConcurrency: number;
	workerSandbox: OrcWorkerSandboxConfig;
	sessionKind: OrcSessionSecurityKind;
}

export interface OrcSecurityPolicyOverrides {
	allowedWorkingDirectories?: string[];
	blockedCommandPatterns?: string[];
	humanEscalationThresholds?: Partial<OrcSecurityPolicy["humanEscalationThresholds"]>;
	maximumConcurrency?: number;
	workerSandbox?: Partial<OrcWorkerSandboxConfig>;
	sessionKind?: OrcSessionSecurityKind;
}

export function createDefaultOrcSecurityPolicy(config?: Pick<AppConfig, "orchestration">): OrcSecurityPolicy {
	const orchestration = config?.orchestration;
	const sandbox = orchestration?.workerSandbox;
	return {
		allowedWorkingDirectories: orchestration?.allowedWorkingDirectories ?? [],
		blockedCommandPatterns: sandbox?.blockedCommandPatterns ?? [
			"rm -rf /",
			"sudo rm",
			"mkfs",
			"dd if=",
		],
		humanEscalationThresholds: {
			requiresApprovalAfter: orchestration?.humanEscalationThresholds?.requiresApprovalAfter ?? 1,
			reasons: orchestration?.humanEscalationThresholds?.reasons ?? ["destructive-command", "privileged-tool"],
		},
		maximumConcurrency: orchestration?.maximumConcurrency ?? 1,
		workerSandbox: {
			workspaceRoot: sandbox?.workspaceRoot ?? process.cwd(),
			durableRoot: sandbox?.durableRoot ?? process.cwd(),
			writeAllowedPaths: sandbox?.writeAllowedPaths ?? [process.cwd()],
			blockedCommandPatterns: sandbox?.blockedCommandPatterns ?? [
				"rm -rf /",
				"sudo rm",
				"mkfs",
				"dd if=",
			],
		},
		sessionKind: orchestration?.sessionKind ?? "main-app",
	};
}

export function mergeOrcSecurityPolicy(
	base: OrcSecurityPolicy,
	overrides: OrcSecurityPolicyOverrides = {},
): OrcSecurityPolicy {
	return {
		allowedWorkingDirectories: overrides.allowedWorkingDirectories ?? base.allowedWorkingDirectories,
		blockedCommandPatterns: overrides.blockedCommandPatterns ?? base.blockedCommandPatterns,
		humanEscalationThresholds: {
			requiresApprovalAfter:
				overrides.humanEscalationThresholds?.requiresApprovalAfter ?? base.humanEscalationThresholds.requiresApprovalAfter,
			reasons: overrides.humanEscalationThresholds?.reasons ?? base.humanEscalationThresholds.reasons,
		},
		maximumConcurrency: overrides.maximumConcurrency ?? base.maximumConcurrency,
		workerSandbox: {
			workspaceRoot: overrides.workerSandbox?.workspaceRoot ?? base.workerSandbox.workspaceRoot,
			durableRoot: overrides.workerSandbox?.durableRoot ?? base.workerSandbox.durableRoot,
			writeAllowedPaths: overrides.workerSandbox?.writeAllowedPaths ?? base.workerSandbox.writeAllowedPaths,
			blockedCommandPatterns: overrides.workerSandbox?.blockedCommandPatterns ?? base.workerSandbox.blockedCommandPatterns,
		},
		sessionKind: overrides.sessionKind ?? base.sessionKind,
	};
}
