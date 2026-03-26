import { randomUUID } from "node:crypto";

export type UnifiedOrchestrationFailureKind =
	| "dead_psmux_session"
	| "crashed_subagent_process"
	| "malformed_jsonl_line"
	| "stalled_tool_watchdog"
	| "unknown_subagent_name"
	| "malformed_subagent_task_request"
	| "subagent_tool_policy_violation";

export type UnifiedRecoveryAction = "retry" | "restart" | "quarantine" | "abort";

export interface OrchestrationCorrelationContext {
	correlationId: string;
	runCorrelationId?: string;
	graphNodeId?: string;
	agentId?: string;
	paneId?: string;
	pid?: number;
}

export interface UnifiedOrchestrationErrorShape {
	kind: UnifiedOrchestrationFailureKind;
	message: string;
	recoveryAction: UnifiedRecoveryAction;
	context: OrchestrationCorrelationContext;
	detail?: Record<string, unknown>;
	cause?: unknown;
}

export class UnifiedOrchestrationError extends Error {
	readonly kind: UnifiedOrchestrationFailureKind;
	readonly recoveryAction: UnifiedRecoveryAction;
	readonly context: OrchestrationCorrelationContext;
	readonly detail?: Record<string, unknown>;
	readonly observedAt: string;
	readonly cause?: unknown;

	constructor(shape: UnifiedOrchestrationErrorShape) {
		super(shape.message);
		this.name = "UnifiedOrchestrationError";
		this.kind = shape.kind;
		this.recoveryAction = shape.recoveryAction;
		this.context = shape.context;
		this.detail = shape.detail;
		this.cause = shape.cause;
		this.observedAt = new Date().toISOString();
	}

	toStructuredLog(event: string): Record<string, unknown> {
		return {
			event,
			errorType: this.name,
			kind: this.kind,
			message: this.message,
			recoveryAction: this.recoveryAction,
			observedAt: this.observedAt,
			context: this.context,
			detail: this.detail,
		};
	}
}

export function createCorrelationContext(context: Omit<OrchestrationCorrelationContext, "correlationId"> & { correlationId?: string }): OrchestrationCorrelationContext {
	return {
		correlationId: context.correlationId ?? `orc-corr-${randomUUID()}`,
		runCorrelationId: context.runCorrelationId,
		graphNodeId: context.graphNodeId,
		agentId: context.agentId,
		paneId: context.paneId,
		pid: context.pid,
	};
}
