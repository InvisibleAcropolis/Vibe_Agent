import type { AppConfig } from "../app-config.js";

export type OrcSessionSecurityKind = "main-app" | "ephemeral-worker";
export type OrcHumanEscalationReason = "filesystem-write" | "destructive-command" | "network-access" | "privileged-tool";
export type OrcSecurityEventKind = "informational-notice" | "approval-required" | "blocked-command";
export type OrcSecurityTelemetryDisposition = "informational" | "approval-required" | "blocked";
export type OrcSecurityEventSource = "runtime-policy" | "command-interceptor" | "tool-runtime" | "future-enforcement";

/**
 * Text shown in the UI when the orchestration runtime needs to stop for review.
 * Keep these strings stable so Phase 2/3 UIs can bind to them before enforcement lands.
 */
export const ORC_SECURITY_STATUS_TEXT: Record<OrcSecurityEventKind, string> = {
	"informational-notice": "Security notice",
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
	telemetryDisposition?: OrcSecurityTelemetryDisposition;
	requiresOperatorAction?: boolean;
	blocksExecution?: boolean;
	source?: OrcSecurityEventSource;
	ruleId?: string;
	reason?: string;
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


export interface OrcCommandInterceptorResult {
	decision: "allow_with_notice" | "require_approval" | "block";
	message: string;
	command?: string;
	workerId?: string;
	createdAt: string;
	source?: OrcSecurityEventSource;
	ruleId?: string;
	reason?: string;
}

export function isBlockingOrcSecurityEvent(event: OrcSecurityEvent): boolean {
	if (event.blocksExecution !== undefined) {
		return event.blocksExecution;
	}
	return event.kind === "approval-required" || event.kind === "blocked-command";
}

export function getOrcSecurityTelemetryDisposition(event: OrcSecurityEvent): OrcSecurityTelemetryDisposition {
	if (event.telemetryDisposition) {
		return event.telemetryDisposition;
	}
	if (event.kind === "blocked-command") {
		return "blocked";
	}
	if (event.kind === "approval-required") {
		return "approval-required";
	}
	return "informational";
}

export function mapCommandInterceptorResultToOrcSecurityEvent(result: OrcCommandInterceptorResult): OrcSecurityEvent {
	if (result.decision === "block") {
		return {
			kind: "blocked-command",
			statusText: ORC_SECURITY_STATUS_TEXT["blocked-command"],
			detail: result.message,
			command: result.command,
			workerId: result.workerId,
			createdAt: result.createdAt,
			telemetryDisposition: "blocked",
			requiresOperatorAction: true,
			blocksExecution: true,
			source: result.source ?? "command-interceptor",
			ruleId: result.ruleId,
			reason: result.reason,
		};
	}
	if (result.decision === "require_approval") {
		return {
			kind: "approval-required",
			statusText: ORC_SECURITY_STATUS_TEXT["approval-required"],
			detail: result.message,
			command: result.command,
			workerId: result.workerId,
			createdAt: result.createdAt,
			telemetryDisposition: "approval-required",
			requiresOperatorAction: true,
			blocksExecution: true,
			source: result.source ?? "command-interceptor",
			ruleId: result.ruleId,
			reason: result.reason,
		};
	}
	return {
		kind: "informational-notice",
		statusText: ORC_SECURITY_STATUS_TEXT["informational-notice"],
		detail: result.message,
		command: result.command,
		workerId: result.workerId,
		createdAt: result.createdAt,
		telemetryDisposition: "informational",
		requiresOperatorAction: false,
		blocksExecution: false,
		source: result.source ?? "command-interceptor",
		ruleId: result.ruleId,
		reason: result.reason,
	};
}
