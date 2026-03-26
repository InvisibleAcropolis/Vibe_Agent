import type { GuildSubagentRole, SpawnSubagentTaskRequest, SpawnSubagentTaskResult, SubagentConfig } from "./types.js";
import { OrcMalformedSubagentTaskRequestError, OrcUnknownSubagentError } from "./errors.js";

export interface SubAgentDispatchContext {
	request: SpawnSubagentTaskRequest;
	registry: Readonly<Record<GuildSubagentRole, SubagentConfig>>;
}

export type SubAgentDispatchHandler = (context: SubAgentDispatchContext) => Promise<SpawnSubagentTaskResult>;

export interface SubAgentMiddleware {
	name: string;
	handle(context: SubAgentDispatchContext, next: SubAgentDispatchHandler): Promise<SpawnSubagentTaskResult>;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function createSubAgentRequestValidationMiddleware(): SubAgentMiddleware {
	return {
		name: "request_validation",
		async handle(context, next) {
			const { request } = context;
			if (!isObjectLike(request)) {
				throw new OrcMalformedSubagentTaskRequestError("Malformed subagent task request: request payload must be an object.");
			}
			if (!isNonEmptyString(request.taskId)) {
				throw new OrcMalformedSubagentTaskRequestError("Malformed subagent task request: `taskId` must be a non-empty string.", { request });
			}
			if (!isNonEmptyString(request.taskType)) {
				throw new OrcMalformedSubagentTaskRequestError("Malformed subagent task request: `taskType` must be a non-empty string.", { request });
			}
			if (!isNonEmptyString(request.subagentName)) {
				throw new OrcMalformedSubagentTaskRequestError("Malformed subagent task request: `subagentName` must be a non-empty string.", { request });
			}
			if (request.graphNodeId !== undefined && !isNonEmptyString(request.graphNodeId)) {
				throw new OrcMalformedSubagentTaskRequestError("Malformed subagent task request: `graphNodeId` must be omitted or a non-empty string.", { request });
			}
			return next(context);
		},
	};
}

export function createSubAgentRegistryGuardMiddleware(): SubAgentMiddleware {
	return {
		name: "registry_guard",
		async handle(context, next) {
			if (!context.registry[context.request.subagentName]) {
				throw new OrcUnknownSubagentError(context.request.subagentName, { request: context.request });
			}
			return next(context);
		},
	};
}

export function createSubAgentStructuredOutputMiddleware(): SubAgentMiddleware {
	return {
		name: "structured_output",
		async handle(context, next) {
			const result = await next(context);
			if (!isObjectLike(result) || !isObjectLike(result.structuredOutput)) {
				throw new OrcMalformedSubagentTaskRequestError("Subagent dispatch returned malformed structured output.", { request: context.request });
			}
			if (result.structuredOutput.kind !== "subagent_dispatch_v1") {
				throw new OrcMalformedSubagentTaskRequestError("Subagent dispatch returned an unknown structured output kind.", {
					request: context.request,
					structuredOutput: result.structuredOutput,
				});
			}
			return result;
		},
	};
}

/**
 * Deterministic middleware layering helper inspired by DeepAgents graph assembly:
 * middleware are applied left-to-right, wrapping dispatch execution in registration order.
 */
export function composeSubAgentMiddleware(middleware: ReadonlyArray<SubAgentMiddleware>, terminal: SubAgentDispatchHandler): SubAgentDispatchHandler {
	return middleware.reduceRight<SubAgentDispatchHandler>((next, mw) => {
		return async (context) => mw.handle(context, next);
	}, terminal);
}
