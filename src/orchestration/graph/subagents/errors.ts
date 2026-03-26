import { UnifiedOrchestrationError, createCorrelationContext } from "../../errors/unified-error.js";

export class OrcUnknownSubagentError extends UnifiedOrchestrationError {
	constructor(subagentName: string, detail?: Record<string, unknown>) {
		super({
			kind: "unknown_subagent_name",
			message: `Unknown subagent '${subagentName}'.`,
			recoveryAction: "abort",
			context: createCorrelationContext({}),
			detail: { subagentName, ...detail },
		});
	}
}

export class OrcMalformedSubagentTaskRequestError extends UnifiedOrchestrationError {
	constructor(message: string, detail?: Record<string, unknown>) {
		super({
			kind: "malformed_subagent_task_request",
			message,
			recoveryAction: "abort",
			context: createCorrelationContext({}),
			detail,
		});
	}
}
