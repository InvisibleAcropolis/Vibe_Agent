import { resolve } from "node:path";
import {
	ORC_MEMORY_SCHEMA_VERSION,
	OrcMemoryStore,
	type OrcGlobalPlanState,
} from "../memory/index.js";

export type CuratorRpcEventType = "agent_start" | "turn_start" | "message_update" | "tool_execution_update" | "agent_end";

export interface CuratorEventBase {
	type: CuratorRpcEventType;
	agentId: string;
	paneId: string;
	timestamp?: string;
}

export interface CuratorAgentStartEvent extends CuratorEventBase {
	type: "agent_start";
	taskId?: string;
}

export interface CuratorTurnStartEvent extends CuratorEventBase {
	type: "turn_start";
	turnId?: string;
}

export interface CuratorMessageUpdateEvent extends CuratorEventBase {
	type: "message_update";
	messageId?: string;
	delta?: {
		text?: string;
		thinking?: string;
		toolCall?: {
			id: string;
			name?: string;
			argumentsDelta?: string;
		};
	};
}

export interface CuratorToolExecutionUpdateEvent extends CuratorEventBase {
	type: "tool_execution_update";
	toolCallId: string;
	toolName?: string;
	status?: "queued" | "running" | "completed" | "failed";
	partialOutput?: string;
	error?: string;
}

export interface CuratorAgentEndEvent extends CuratorEventBase {
	type: "agent_end";
	finishReason?: string;
	reason?: string;
	error?: string;
}

export type CuratorRpcEvent =
	| CuratorAgentStartEvent
	| CuratorTurnStartEvent
	| CuratorMessageUpdateEvent
	| CuratorToolExecutionUpdateEvent
	| CuratorAgentEndEvent;

interface CuratorToolCallState {
	id: string;
	name?: string;
	arguments: string;
}

interface CuratorToolExecutionState {
	toolCallId: string;
	toolName?: string;
	status: "queued" | "running" | "completed" | "failed";
	output: string;
	error?: string;
	updatedAt: string;
}

interface CuratorPaneState {
	agentId: string;
	paneId: string;
	status: "idle" | "running" | "ended" | "timed_out";
	taskId?: string;
	turnId?: string;
	messageId?: string;
	text: string;
	thinking: string;
	toolCalls: Map<string, CuratorToolCallState>;
	toolExecutions: Map<string, CuratorToolExecutionState>;
	startedAt?: number;
	endedAt?: number;
	turnStartedAt?: number;
	lastTurnDurationMs?: number;
	finishReason?: string;
	timedOut: boolean;
	lastEventAt?: number;
	watchdogTimeout?: NodeJS.Timeout;
	lastEventType?: CuratorRpcEventType;
}

export interface CuratorSnapshot {
	agentId: string;
	paneId: string;
	status: "idle" | "running" | "ended" | "timed_out";
	taskId?: string;
	turnId?: string;
	messageId?: string;
	finishReason?: string;
	lastEventType?: CuratorRpcEventType;
	lastEventAt?: string;
	timing: {
		taskStartedAt?: string;
		taskEndedAt?: string;
		taskDurationMs: number;
		currentTurnDurationMs: number;
		lastTurnDurationMs?: number;
		timedOut: boolean;
	};
	message: {
		text: string;
		thinking: string;
		toolCalls: Array<{ id: string; name?: string; arguments: string }>;
	};
	toolExecutions: Array<{
		toolCallId: string;
		toolName?: string;
		status: "queued" | "running" | "completed" | "failed";
		output: string;
		error?: string;
		updatedAt: string;
	}>;
	globalPlanState?: OrcGlobalPlanState;
}

export interface CuratorOptions {
	watchdogMs?: number;
	snapshotLimit?: number;
	now?: () => number;
	onSnapshot?: (snapshot: CuratorSnapshot) => void;
	memoryRootDir?: string;
}

const DEFAULT_WATCHDOG_MS = 45_000;
const DEFAULT_SNAPSHOT_LIMIT = 200;

export class RpcEventCurator {
	private readonly byAgentAndPane = new Map<string, Map<string, CuratorPaneState>>();
	private readonly snapshots: CuratorSnapshot[] = [];
	private readonly watchdogMs: number;
	private readonly snapshotLimit: number;
	private readonly now: () => number;
	private readonly onSnapshot?: (snapshot: CuratorSnapshot) => void;
	private readonly memoryStore: OrcMemoryStore;
	private readonly globalPlanByAgent = new Map<string, OrcGlobalPlanState>();

	constructor(options: CuratorOptions = {}) {
		this.watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS;
		this.snapshotLimit = options.snapshotLimit ?? DEFAULT_SNAPSHOT_LIMIT;
		this.now = options.now ?? (() => Date.now());
		this.onSnapshot = options.onSnapshot;
		this.memoryStore = new OrcMemoryStore(options.memoryRootDir ?? resolve(process.cwd(), ".vibe", "orchestration-memory"));
	}

	handleRpcEvent(event: CuratorRpcEvent): CuratorSnapshot {
		const timestampMs = parseEventTime(event.timestamp) ?? this.now();
		const pane = this.ensurePaneState(event.agentId, event.paneId);
		pane.lastEventAt = timestampMs;
		pane.lastEventType = event.type;

		switch (event.type) {
			case "agent_start":
				this.handleAgentStart(pane, event, timestampMs);
				break;
			case "turn_start":
				this.handleTurnStart(pane, event, timestampMs);
				break;
			case "message_update":
				this.handleMessageUpdate(pane, event);
				break;
			case "tool_execution_update":
				this.handleToolExecutionUpdate(pane, event, timestampMs);
				break;
			case "agent_end":
				this.handleAgentEnd(pane, event, timestampMs);
				break;
		}

		if (event.type !== "agent_end") {
			this.armWatchdog(pane);
		}

		return this.persistSnapshot(pane);
	}

	handleUnknownEvent(rawEvent: unknown): CuratorSnapshot | undefined {
		const parsed = parseCuratorRpcEvent(rawEvent);
		if (!parsed) {
			return undefined;
		}
		return this.handleRpcEvent(parsed);
	}

	getSnapshots(): CuratorSnapshot[] {
		return this.snapshots.map((snapshot) => ({
			...snapshot,
			timing: { ...snapshot.timing },
			message: {
				...snapshot.message,
				toolCalls: snapshot.message.toolCalls.map((toolCall) => ({ ...toolCall })),
			},
			toolExecutions: snapshot.toolExecutions.map((execution) => ({ ...execution })),
		}));
	}

	getPaneSnapshot(agentId: string, paneId: string): CuratorSnapshot | undefined {
		const pane = this.byAgentAndPane.get(agentId)?.get(paneId);
		if (!pane) {
			return undefined;
		}
		return this.buildSnapshot(pane);
	}

	dispose(): void {
		for (const byPane of this.byAgentAndPane.values()) {
			for (const pane of byPane.values()) {
				if (pane.watchdogTimeout) {
					clearTimeout(pane.watchdogTimeout);
					pane.watchdogTimeout = undefined;
				}
			}
		}
	}

	private ensurePaneState(agentId: string, paneId: string): CuratorPaneState {
		let byPane = this.byAgentAndPane.get(agentId);
		if (!byPane) {
			byPane = new Map<string, CuratorPaneState>();
			this.byAgentAndPane.set(agentId, byPane);
		}
		let pane = byPane.get(paneId);
		if (!pane) {
			pane = {
				agentId,
				paneId,
				status: "idle",
				text: "",
				thinking: "",
				toolCalls: new Map<string, CuratorToolCallState>(),
				toolExecutions: new Map<string, CuratorToolExecutionState>(),
				timedOut: false,
			};
			byPane.set(paneId, pane);
		}
		return pane;
	}

	private handleAgentStart(pane: CuratorPaneState, event: CuratorAgentStartEvent, timestampMs: number): void {
		pane.status = "running";
		pane.taskId = event.taskId ?? pane.taskId;
		pane.startedAt = timestampMs;
		pane.endedAt = undefined;
		pane.finishReason = undefined;
		pane.timedOut = false;
		pane.text = "";
		pane.thinking = "";
		pane.messageId = undefined;
		pane.turnId = undefined;
		pane.turnStartedAt = undefined;
		pane.lastTurnDurationMs = undefined;
		pane.toolCalls.clear();
		pane.toolExecutions.clear();
	}

	private handleTurnStart(pane: CuratorPaneState, event: CuratorTurnStartEvent, timestampMs: number): void {
		if (pane.turnStartedAt !== undefined) {
			pane.lastTurnDurationMs = Math.max(0, timestampMs - pane.turnStartedAt);
		}
		pane.turnId = event.turnId ?? pane.turnId;
		pane.turnStartedAt = timestampMs;
	}

	private handleMessageUpdate(pane: CuratorPaneState, event: CuratorMessageUpdateEvent): void {
		pane.messageId = event.messageId ?? pane.messageId;
		if (!event.delta) {
			return;
		}
		if (typeof event.delta.text === "string" && event.delta.text.length > 0) {
			pane.text += event.delta.text;
		}
		if (typeof event.delta.thinking === "string" && event.delta.thinking.length > 0) {
			pane.thinking += event.delta.thinking;
		}
		if (event.delta.toolCall) {
			const existing = pane.toolCalls.get(event.delta.toolCall.id) ?? {
				id: event.delta.toolCall.id,
				name: event.delta.toolCall.name,
				arguments: "",
			};
			existing.name = event.delta.toolCall.name ?? existing.name;
			existing.arguments += event.delta.toolCall.argumentsDelta ?? "";
			pane.toolCalls.set(existing.id, existing);
		}
	}

	private handleToolExecutionUpdate(pane: CuratorPaneState, event: CuratorToolExecutionUpdateEvent, timestampMs: number): void {
		const updatedAt = new Date(timestampMs).toISOString();
		const existing = pane.toolExecutions.get(event.toolCallId) ?? {
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			status: event.status ?? "queued",
			output: "",
			error: undefined,
			updatedAt,
		};
		existing.toolName = event.toolName ?? existing.toolName;
		existing.status = event.status ?? existing.status;
		if (typeof event.partialOutput === "string") {
			existing.output = event.partialOutput;
		}
		existing.error = event.error ?? existing.error;
		existing.updatedAt = updatedAt;
		pane.toolExecutions.set(event.toolCallId, existing);
	}

	private handleAgentEnd(pane: CuratorPaneState, event: CuratorAgentEndEvent, timestampMs: number): void {
		if (pane.watchdogTimeout) {
			clearTimeout(pane.watchdogTimeout);
			pane.watchdogTimeout = undefined;
		}
		pane.status = "ended";
		pane.endedAt = timestampMs;
		if (pane.turnStartedAt !== undefined) {
			pane.lastTurnDurationMs = Math.max(0, timestampMs - pane.turnStartedAt);
			pane.turnStartedAt = undefined;
		}
		pane.finishReason = event.finishReason ?? event.reason ?? event.error ?? "unknown";
		this.captureMemoryArtifacts(pane, timestampMs);
	}

	private captureMemoryArtifacts(pane: CuratorPaneState, timestampMs: number): void {
		const updatedAt = new Date(timestampMs).toISOString();
		const threadId = pane.taskId ?? `thread-${pane.agentId}`;
		this.memoryStore.writeSubagentFindings({
			schemaVersion: ORC_MEMORY_SCHEMA_VERSION,
			kind: "subagent_findings",
			threadId,
			agentId: pane.agentId,
			paneId: pane.paneId,
			updatedAt,
			findings: [
				{
					id: pane.messageId ?? `${pane.agentId}-${pane.paneId}-finding`,
					summary: pane.thinking || pane.text || "No finding summary provided.",
					evidence: pane.toolExecutions.size > 0
						? [...pane.toolExecutions.values()].map((tool) => `${tool.toolName ?? tool.toolCallId}:${tool.status}`)
						: ["no_tool_execution"],
					confidence: pane.status === "ended" ? "high" : "medium",
				},
			],
		});
		this.memoryStore.writeIntermediateArtifacts({
			schemaVersion: ORC_MEMORY_SCHEMA_VERSION,
			kind: "intermediate_artifacts",
			threadId,
			agentId: pane.agentId,
			paneId: pane.paneId,
			updatedAt,
			artifacts: [...pane.toolExecutions.values()].map((execution) => ({
				id: execution.toolCallId,
				kind: "tool_output",
				label: execution.toolName ?? execution.toolCallId,
				content: execution.output,
				createdAt: execution.updatedAt,
			})),
		});
		const status = pane.status === "timed_out"
			? "timed_out"
			: pane.finishReason === "completed"
				? "completed"
				: pane.finishReason === "cancelled"
					? "cancelled"
					: pane.finishReason === "failed"
						? "failed"
						: "unknown";
		this.memoryStore.writeCompletionStatus({
			schemaVersion: ORC_MEMORY_SCHEMA_VERSION,
			kind: "completion_status",
			threadId,
			agentId: pane.agentId,
			paneId: pane.paneId,
			updatedAt,
			status,
			reason: pane.finishReason ?? "unknown",
			completedAt: updatedAt,
		});
		this.memoryStore.writeHandoffSummary({
			schemaVersion: ORC_MEMORY_SCHEMA_VERSION,
			kind: "handoff_summary",
			threadId,
			agentId: pane.agentId,
			paneId: pane.paneId,
			updatedAt,
			summary: pane.text || pane.thinking || "No handoff summary available.",
			nextActions: pane.finishReason === "completed" ? [] : ["review_agent_output"],
			planDelta: {
				completed: pane.finishReason === "completed" ? [pane.paneId] : [],
				pending: pane.finishReason === "completed" ? [] : [pane.paneId],
			},
		});

		const consumed = this.memoryStore.consumeAfterAgentEnd({ threadId, agentId: pane.agentId, paneId: pane.paneId });
		const existingPlanState = this.globalPlanByAgent.get(pane.agentId);
		const nextPlanState = this.memoryStore.updateGlobalPlanState(existingPlanState, consumed);
		if (nextPlanState) {
			this.globalPlanByAgent.set(pane.agentId, nextPlanState);
		}
	}

	private armWatchdog(pane: CuratorPaneState): void {
		if (pane.watchdogTimeout) {
			clearTimeout(pane.watchdogTimeout);
		}
		pane.watchdogTimeout = setTimeout(() => {
			pane.watchdogTimeout = undefined;
			if (pane.status !== "running") {
				return;
			}
			pane.status = "timed_out";
			pane.timedOut = true;
			pane.finishReason = "timeout";
			const now = this.now();
			pane.endedAt = now;
			if (pane.turnStartedAt !== undefined) {
				pane.lastTurnDurationMs = Math.max(0, now - pane.turnStartedAt);
				pane.turnStartedAt = undefined;
			}
			this.persistSnapshot(pane);
		}, this.watchdogMs);
	}

	private persistSnapshot(pane: CuratorPaneState): CuratorSnapshot {
		const snapshot = this.buildSnapshot(pane);
		this.snapshots.push(snapshot);
		if (this.snapshots.length > this.snapshotLimit) {
			this.snapshots.splice(0, this.snapshots.length - this.snapshotLimit);
		}
		this.onSnapshot?.(snapshot);
		return snapshot;
	}

	private buildSnapshot(pane: CuratorPaneState): CuratorSnapshot {
		const now = this.now();
		const taskDurationMs = pane.startedAt === undefined ? 0 : Math.max(0, (pane.endedAt ?? now) - pane.startedAt);
		const currentTurnDurationMs = pane.turnStartedAt === undefined ? 0 : Math.max(0, (pane.endedAt ?? now) - pane.turnStartedAt);
		return {
			agentId: pane.agentId,
			paneId: pane.paneId,
			status: pane.status,
			taskId: pane.taskId,
			turnId: pane.turnId,
			messageId: pane.messageId,
			finishReason: pane.finishReason,
			lastEventType: pane.lastEventType,
			lastEventAt: pane.lastEventAt ? new Date(pane.lastEventAt).toISOString() : undefined,
			timing: {
				taskStartedAt: pane.startedAt ? new Date(pane.startedAt).toISOString() : undefined,
				taskEndedAt: pane.endedAt ? new Date(pane.endedAt).toISOString() : undefined,
				taskDurationMs,
				currentTurnDurationMs,
				lastTurnDurationMs: pane.lastTurnDurationMs,
				timedOut: pane.timedOut,
			},
			message: {
				text: pane.text,
				thinking: pane.thinking,
				toolCalls: [...pane.toolCalls.values()].map((toolCall) => ({ ...toolCall })),
			},
			toolExecutions: [...pane.toolExecutions.values()].map((execution) => ({ ...execution })),
			globalPlanState: this.globalPlanByAgent.get(pane.agentId),
		};
	}
}

export function parseCuratorRpcEvent(value: unknown): CuratorRpcEvent | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const candidate = value as Partial<CuratorRpcEvent>;
	if (typeof candidate.type !== "string") {
		return undefined;
	}
	if (typeof candidate.agentId !== "string" || candidate.agentId.length === 0) {
		return undefined;
	}
	if (typeof candidate.paneId !== "string" || candidate.paneId.length === 0) {
		return undefined;
	}
	if (!isCuratorEventType(candidate.type)) {
		return undefined;
	}
	return candidate as CuratorRpcEvent;
}

function isCuratorEventType(type: string): type is CuratorRpcEventType {
	return type === "agent_start"
		|| type === "turn_start"
		|| type === "message_update"
		|| type === "tool_execution_update"
		|| type === "agent_end";
}

function parseEventTime(timestamp: string | undefined): number | undefined {
	if (!timestamp) {
		return undefined;
	}
	const parsed = Date.parse(timestamp);
	return Number.isFinite(parsed) ? parsed : undefined;
}
