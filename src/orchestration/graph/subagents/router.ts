import { randomUUID } from "node:crypto";
import type { RpcProcessLauncher, RpcTelemetryEnvelope } from "../../bridge/rpc_launcher.js";
import type { TerminalPaneOrchestrator } from "../../terminal/pane_orchestrator.js";
import { createCorrelationContext } from "../../errors/unified-error.js";
import { ORC_GUILD_SUBAGENT_REGISTRY } from "./registry.js";
import {
	composeSubAgentMiddleware,
	createSubAgentRegistryGuardMiddleware,
	createSubAgentRequestValidationMiddleware,
	createSubAgentStructuredOutputMiddleware,
	type SubAgentDispatchHandler,
	type SubAgentMiddleware,
} from "./middleware.js";
import {
	type GuildSubagentRole,
	type OrcTaskType,
	type RoutedSubagentSession,
	type SpawnSubagentTaskRequest,
	type SpawnSubagentTaskResult,
	type TaskRoutingDecision,
} from "./types.js";

interface RouteTaskOptions {
	routerNow?: () => Date;
	paneOrchestrator: Pick<TerminalPaneOrchestrator, "splitVertical">;
	rpcLauncher: Pick<RpcProcessLauncher, "startAgent" | "getAgentState">;
	onDiagnostic?: (entry: Record<string, unknown>) => void;
	middleware?: ReadonlyArray<SubAgentMiddleware>;
}

interface BoundTelemetryFrame {
	session: RoutedSubagentSession;
	envelope: RpcTelemetryEnvelope;
}

const TASK_TYPE_TO_ROLE: Readonly<Record<OrcTaskType, GuildSubagentRole>> = {
	repo_index: "inquisitor",
	semantic_search: "inquisitor",
	read_analysis: "architect",
	code_write: "alchemist",
	code_refactor: "alchemist",
	execution: "mechanic",
	general: "scribe",
};

export class OrcSubagentRouter {
	private readonly now: () => Date;
	private readonly paneOrchestrator: RouteTaskOptions["paneOrchestrator"];
	private readonly rpcLauncher: RouteTaskOptions["rpcLauncher"];
	private readonly onDiagnostic?: (entry: Record<string, unknown>) => void;
	private readonly sessionsByRole = new Map<string, RoutedSubagentSession>();
	private readonly sessionsByInstance = new Map<string, RoutedSubagentSession>();
	private readonly dispatch: SubAgentDispatchHandler;
	private readonly middlewareOrder: ReadonlyArray<string>;

	constructor(options: RouteTaskOptions) {
		this.now = options.routerNow ?? (() => new Date());
		this.paneOrchestrator = options.paneOrchestrator;
		this.rpcLauncher = options.rpcLauncher;
		this.onDiagnostic = options.onDiagnostic;
		const middleware = [
			createSubAgentRequestValidationMiddleware(),
			createSubAgentRegistryGuardMiddleware(),
			...(options.middleware ?? []),
			createSubAgentStructuredOutputMiddleware(),
		];
		this.middlewareOrder = Object.freeze(middleware.map((layer) => layer.name));
		this.dispatch = composeSubAgentMiddleware(middleware, (context) => this.dispatchSpawnTask(context.request));
	}

	getRegisteredSubagents() {
		return Object.values(ORC_GUILD_SUBAGENT_REGISTRY);
	}

	getMiddlewareOrder(): ReadonlyArray<string> {
		return this.middlewareOrder;
	}

	getRoutingDecision(taskType: OrcTaskType): TaskRoutingDecision {
		const targetRole = TASK_TYPE_TO_ROLE[taskType];
		const config = ORC_GUILD_SUBAGENT_REGISTRY[targetRole];
		return {
			taskType,
			targetRole,
			reason: `Task type '${taskType}' maps to ${config.displayName} (${config.toolset.join("/")}).`,
		};
	}

	async routeTask(input: { taskId: string; taskType: OrcTaskType; graphNodeId?: string }): Promise<RoutedSubagentSession> {
		const decision = this.getRoutingDecision(input.taskType);
		const result = await this.invokeSpawnTask({
			taskId: input.taskId,
			taskType: input.taskType,
			subagentName: decision.targetRole,
			graphNodeId: input.graphNodeId,
		});
		return result.session;
	}

	async invokeSpawnTask(request: SpawnSubagentTaskRequest): Promise<SpawnSubagentTaskResult> {
		return this.dispatch({ request, registry: ORC_GUILD_SUBAGENT_REGISTRY });
	}

	private async dispatchSpawnTask(request: SpawnSubagentTaskRequest): Promise<SpawnSubagentTaskResult> {
		const runtimeState = this.rpcLauncher.startAgent(request.subagentName);
		const binding = {
			agentId: runtimeState.identity.agentId,
			boundAt: this.now(),
		};
		const pane = await this.paneOrchestrator.splitVertical("secondary", binding);
		const verifiedState = this.rpcLauncher.getAgentState(request.subagentName);
		const correlation = createCorrelationContext({
			graphNodeId: request.graphNodeId,
			agentId: verifiedState.identity.agentId,
			paneId: pane.paneId,
			pid: verifiedState.identity.pid,
		});
		const session: RoutedSubagentSession = {
			sessionId: randomUUID(),
			correlationId: correlation.correlationId,
			taskId: request.taskId,
			graphNodeId: request.graphNodeId,
			taskType: request.taskType,
			subagentRole: request.subagentName,
			subagentAgentId: verifiedState.identity.agentId,
			subagentInstanceId: verifiedState.identity.instanceId,
			processPid: verifiedState.identity.pid,
			paneId: pane.paneId,
			boundAt: this.now().toISOString(),
		};
		this.onDiagnostic?.({
			event: "subagent.session.bound",
			at: this.now().toISOString(),
			correlation,
			taskId: request.taskId,
			taskType: request.taskType,
			subagentRole: request.subagentName,
			subagentInstanceId: verifiedState.identity.instanceId,
		});
		this.sessionsByRole.set(session.subagentRole, session);
		this.sessionsByInstance.set(session.subagentInstanceId, session);
		return {
			session,
			structuredOutput: {
				kind: "subagent_dispatch_v1",
				taskId: request.taskId,
				taskType: request.taskType,
				targetRole: request.subagentName,
				sessionId: session.sessionId,
				correlationId: session.correlationId,
				paneId: session.paneId,
				subagentInstanceId: session.subagentInstanceId,
				boundAt: session.boundAt,
			},
		};
	}

	bindTelemetry(envelope: RpcTelemetryEnvelope): BoundTelemetryFrame | undefined {
		const byInstance = this.sessionsByInstance.get(envelope.source.instanceId);
		if (byInstance) {
			this.onDiagnostic?.({
				event: "subagent.telemetry.bound",
				at: this.now().toISOString(),
				correlation: createCorrelationContext({
					correlationId: byInstance.correlationId,
					graphNodeId: byInstance.graphNodeId,
					agentId: byInstance.subagentAgentId,
					paneId: byInstance.paneId,
					pid: byInstance.processPid,
				}),
				telemetryKind: envelope.telemetry.kind,
				eventId: envelope.eventId,
			});
			return { session: byInstance, envelope };
		}
		const byRole = this.sessionsByRole.get(envelope.source.agentRole);
		if (!byRole) {
			return undefined;
		}
		if (byRole.subagentAgentId !== envelope.source.agentId) {
			return undefined;
		}
		return { session: byRole, envelope };
	}
}
