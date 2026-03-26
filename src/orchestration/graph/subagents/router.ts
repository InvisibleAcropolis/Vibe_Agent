import { randomUUID } from "node:crypto";
import type { RpcProcessLauncher, RpcTelemetryEnvelope } from "../../bridge/rpc_launcher.js";
import type { TerminalPaneOrchestrator } from "../../terminal/pane_orchestrator.js";
import { createCorrelationContext } from "../../errors/unified-error.js";
import { ALCHEMIST_SUBAGENT_CONFIG } from "./alchemist.js";
import { INQUISITOR_SUBAGENT_CONFIG } from "./inquisitor.js";
import type { OrcTaskType, RoutedSubagentSession, TaskRoutingDecision } from "./types.js";

interface RouteTaskInput {
	taskId: string;
	taskType: OrcTaskType;
	graphNodeId?: string;
}

interface RouteTaskOptions {
	routerNow?: () => Date;
	paneOrchestrator: Pick<TerminalPaneOrchestrator, "splitVertical">;
	rpcLauncher: Pick<RpcProcessLauncher, "startAgent" | "getAgentState">;
	onDiagnostic?: (entry: Record<string, unknown>) => void;
}

interface BoundTelemetryFrame {
	session: RoutedSubagentSession;
	envelope: RpcTelemetryEnvelope;
}

const TASK_TYPE_TO_ROLE: Readonly<Record<OrcTaskType, TaskRoutingDecision["targetRole"]>> = {
	repo_index: "inquisitor",
	semantic_search: "inquisitor",
	read_analysis: "inquisitor",
	code_write: "alchemist",
	code_refactor: "alchemist",
	execution: "alchemist",
	general: "inquisitor",
};

const SUBAGENT_CONFIG_BY_ROLE = {
	inquisitor: INQUISITOR_SUBAGENT_CONFIG,
	alchemist: ALCHEMIST_SUBAGENT_CONFIG,
} as const;

export class OrcSubagentRouter {
	private readonly now: () => Date;
	private readonly paneOrchestrator: RouteTaskOptions["paneOrchestrator"];
	private readonly rpcLauncher: RouteTaskOptions["rpcLauncher"];
	private readonly onDiagnostic?: (entry: Record<string, unknown>) => void;
	private readonly sessionsByRole = new Map<string, RoutedSubagentSession>();
	private readonly sessionsByInstance = new Map<string, RoutedSubagentSession>();

	constructor(options: RouteTaskOptions) {
		this.now = options.routerNow ?? (() => new Date());
		this.paneOrchestrator = options.paneOrchestrator;
		this.rpcLauncher = options.rpcLauncher;
		this.onDiagnostic = options.onDiagnostic;
	}

	getRoutingDecision(taskType: OrcTaskType): TaskRoutingDecision {
		const targetRole = TASK_TYPE_TO_ROLE[taskType];
		const config = SUBAGENT_CONFIG_BY_ROLE[targetRole];
		return {
			taskType,
			targetRole,
			reason: `Task type '${taskType}' maps to ${config.displayName} (${config.toolset.join("/")}).`,
		};
	}

	async routeTask(input: RouteTaskInput): Promise<RoutedSubagentSession> {
		const decision = this.getRoutingDecision(input.taskType);
		const runtimeState = this.rpcLauncher.startAgent(decision.targetRole);
		const binding = {
			agentId: runtimeState.identity.agentId,
			boundAt: this.now(),
		};
		const pane = await this.paneOrchestrator.splitVertical("secondary", binding);
		const verifiedState = this.rpcLauncher.getAgentState(decision.targetRole);
		const correlation = createCorrelationContext({
			graphNodeId: input.graphNodeId,
			agentId: verifiedState.identity.agentId,
			paneId: pane.paneId,
			pid: verifiedState.identity.pid,
		});
		const session: RoutedSubagentSession = {
			sessionId: randomUUID(),
			correlationId: correlation.correlationId,
			taskId: input.taskId,
			graphNodeId: input.graphNodeId,
			taskType: input.taskType,
			subagentRole: decision.targetRole,
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
			taskId: input.taskId,
			taskType: input.taskType,
			subagentRole: decision.targetRole,
			subagentInstanceId: verifiedState.identity.instanceId,
		});
		this.sessionsByRole.set(session.subagentRole, session);
		this.sessionsByInstance.set(session.subagentInstanceId, session);
		return session;
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
