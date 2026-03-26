import { resolve } from "node:path";
import { UnifiedOrchestrationError, createCorrelationContext } from "../errors/unified-error.js";
import {
	ORC_MEMORY_SCHEMA_VERSION,
	OrcMemoryStore,
	type OrcGlobalPlanState,
} from "../memory/index.js";

export type CuratorRpcEventType =
	| "agent_start"
	| "turn_start"
	| "message_update"
	| "tool_execution_update"
	| "agent_end"
	| "auto_retry_start"
	| "auto_retry_end"
	| "extension_error";

export interface CuratorEventBase {
	type: CuratorRpcEventType;
	agentId: string;
	paneId: string;
	graphNodeId?: string;
	processPid?: number;
	correlationId?: string;
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

export interface CuratorAutoRetryStartEvent extends CuratorEventBase {
	type: "auto_retry_start";
	attempt?: number;
	maxAttempts?: number;
	delayMs?: number;
	errorMessage?: string;
}

export interface CuratorAutoRetryEndEvent extends CuratorEventBase {
	type: "auto_retry_end";
	success?: boolean;
	attempt?: number;
	finalError?: string;
}

export interface CuratorExtensionErrorEvent extends CuratorEventBase {
	type: "extension_error";
	event?: string;
	error?: string;
	extensionPath?: string;
}

export type CuratorRpcEvent =
	| CuratorAgentStartEvent
	| CuratorTurnStartEvent
	| CuratorMessageUpdateEvent
	| CuratorToolExecutionUpdateEvent
	| CuratorAgentEndEvent
	| CuratorAutoRetryStartEvent
	| CuratorAutoRetryEndEvent
	| CuratorExtensionErrorEvent;

export type CuratorTelemetrySignalElement = "water" | "fire";
export type CuratorTelemetrySignalStage =
	| "idle"
	| "active"
	| "retrying"
	| "recovering"
	| "completed"
	| "cancelled"
	| "failed"
	| "fault"
	| "timed_out";

export interface CuratorTelemetrySignal {
	version: "curator.signal.v1";
	key: `${CuratorTelemetrySignalElement}:${CuratorTelemetrySignalStage}`;
	element: CuratorTelemetrySignalElement;
	stage: CuratorTelemetrySignalStage;
	retryActive: boolean;
	retryAttempt: number;
	retryMaxAttempts?: number;
	failureActive: boolean;
	recoveryActive: boolean;
	detail?: string;
}

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
	graphNodeId?: string;
	processPid?: number;
	correlationId?: string;
	retryActive: boolean;
	retryAttempt: number;
	retryMaxAttempts?: number;
	failureActive: boolean;
	recoveryActive: boolean;
	lastError?: string;
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
	graphNodeId?: string;
	processPid?: number;
	correlationId?: string;
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
	signal: CuratorTelemetrySignal;
}

export interface CuratorOptions {
	watchdogMs?: number;
	snapshotLimit?: number;
	now?: () => number;
	onSnapshot?: (snapshot: CuratorSnapshot) => void;
	memoryRootDir?: string;
	onDiagnostic?: (entry: Record<string, unknown>) => void;
	onQueueDrainError?: (error: Error) => void;
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
	private readonly onDiagnostic?: (entry: Record<string, unknown>) => void;
	private readonly onQueueDrainError?: (error: Error) => void;
	private readonly memoryStore: OrcMemoryStore;
	private readonly globalPlanByAgent = new Map<string, OrcGlobalPlanState>();
	private readonly queuedEvents: CuratorRpcEvent[] = [];
	private drainScheduled = false;

	constructor(options: CuratorOptions = {}) {
		this.watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS;
		this.snapshotLimit = options.snapshotLimit ?? DEFAULT_SNAPSHOT_LIMIT;
		this.now = options.now ?? (() => Date.now());
		this.onSnapshot = options.onSnapshot;
		this.onDiagnostic = options.onDiagnostic;
		this.onQueueDrainError = options.onQueueDrainError;
		this.memoryStore = new OrcMemoryStore(options.memoryRootDir ?? resolve(process.cwd(), ".vibe", "orchestration-memory"));
	}

	/**
	 * Non-blocking ingestion path for streamed events.
	 * Events are drained on the next microtask tick in FIFO order.
	 */
	enqueueRpcEvent(event: CuratorRpcEvent): void {
		this.queuedEvents.push(event);
		if (this.drainScheduled) {
			return;
		}
		this.drainScheduled = true;
		queueMicrotask(() => {
			this.drainScheduled = false;
			try {
				while (this.queuedEvents.length > 0) {
					const next = this.queuedEvents.shift();
					if (next) {
						this.handleRpcEvent(next);
					}
				}
			} catch (error) {
				this.onQueueDrainError?.(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	handleRpcEvent(event: CuratorRpcEvent): CuratorSnapshot {
		const timestampMs = parseEventTime(event.timestamp) ?? this.now();
		const pane = this.ensurePaneState(event.agentId, event.paneId);
		pane.graphNodeId = event.graphNodeId ?? pane.graphNodeId;
		pane.processPid = event.processPid ?? pane.processPid;
		pane.correlationId = event.correlationId ?? pane.correlationId;
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
			case "auto_retry_start":
				this.handleAutoRetryStart(pane, event);
				break;
			case "auto_retry_end":
				this.handleAutoRetryEnd(pane, event);
				break;
			case "extension_error":
				this.handleExtensionError(pane, event);
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
				retryActive: false,
				retryAttempt: 0,
				failureActive: false,
				recoveryActive: false,
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
		pane.retryActive = false;
		pane.retryAttempt = 0;
		pane.retryMaxAttempts = undefined;
		pane.failureActive = false;
		pane.recoveryActive = false;
		pane.lastError = undefined;
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
		if (existing.status === "failed") {
			pane.failureActive = true;
			pane.lastError = existing.error ?? pane.lastError;
		}
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
		pane.lastError = event.error ?? pane.lastError;
		this.captureMemoryArtifacts(pane, timestampMs);
	}

	private handleAutoRetryStart(pane: CuratorPaneState, event: CuratorAutoRetryStartEvent): void {
		pane.retryActive = true;
		pane.retryAttempt = event.attempt ?? pane.retryAttempt;
		pane.retryMaxAttempts = event.maxAttempts ?? pane.retryMaxAttempts;
		pane.failureActive = true;
		pane.recoveryActive = false;
		pane.lastError = event.errorMessage ?? pane.lastError;
	}

	private handleAutoRetryEnd(pane: CuratorPaneState, event: CuratorAutoRetryEndEvent): void {
		pane.retryActive = false;
		pane.retryAttempt = event.attempt ?? pane.retryAttempt;
		if (event.success === true) {
			pane.failureActive = false;
			pane.recoveryActive = true;
			return;
		}
		if (event.success === false) {
			pane.failureActive = true;
			pane.recoveryActive = false;
			pane.lastError = event.finalError ?? pane.lastError;
		}
	}

	private handleExtensionError(pane: CuratorPaneState, event: CuratorExtensionErrorEvent): void {
		pane.failureActive = true;
		pane.lastError = event.error ?? pane.lastError;
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
			const watchdogError = new UnifiedOrchestrationError({
				kind: "stalled_tool_watchdog",
				message: `Tool execution watchdog expired for agent ${pane.agentId} pane ${pane.paneId}.`,
				recoveryAction: "abort",
				context: createCorrelationContext({
					correlationId: pane.correlationId,
					graphNodeId: pane.graphNodeId,
					agentId: pane.agentId,
					paneId: pane.paneId,
					pid: pane.processPid,
				}),
				detail: {
					lastEventType: pane.lastEventType,
					lastEventAt: pane.lastEventAt ? new Date(pane.lastEventAt).toISOString() : undefined,
					watchdogMs: this.watchdogMs,
				},
			});
			this.onDiagnostic?.(watchdogError.toStructuredLog("curator.watchdog.expired"));
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
			graphNodeId: pane.graphNodeId,
			processPid: pane.processPid,
			correlationId: pane.correlationId,
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
			signal: mapPaneToSignal(pane),
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
	if (candidate.graphNodeId !== undefined && typeof candidate.graphNodeId !== "string") {
		return undefined;
	}
	if (candidate.correlationId !== undefined && typeof candidate.correlationId !== "string") {
		return undefined;
	}
	if (candidate.processPid !== undefined && typeof candidate.processPid !== "number") {
		return undefined;
	}
	if (candidate.type === "auto_retry_start") {
		if (candidate.attempt !== undefined && typeof candidate.attempt !== "number") return undefined;
		if (candidate.maxAttempts !== undefined && typeof candidate.maxAttempts !== "number") return undefined;
		if (candidate.delayMs !== undefined && typeof candidate.delayMs !== "number") return undefined;
		if (candidate.errorMessage !== undefined && typeof candidate.errorMessage !== "string") return undefined;
	}
	if (candidate.type === "auto_retry_end") {
		if (candidate.success !== undefined && typeof candidate.success !== "boolean") return undefined;
		if (candidate.attempt !== undefined && typeof candidate.attempt !== "number") return undefined;
		if (candidate.finalError !== undefined && typeof candidate.finalError !== "string") return undefined;
	}
	if (candidate.type === "extension_error") {
		if (candidate.event !== undefined && typeof candidate.event !== "string") return undefined;
		if (candidate.error !== undefined && typeof candidate.error !== "string") return undefined;
		if (candidate.extensionPath !== undefined && typeof candidate.extensionPath !== "string") return undefined;
	}
	return candidate as CuratorRpcEvent;
}

function isCuratorEventType(type: string): type is CuratorRpcEventType {
	return type === "agent_start"
		|| type === "turn_start"
		|| type === "message_update"
		|| type === "tool_execution_update"
		|| type === "agent_end"
		|| type === "auto_retry_start"
		|| type === "auto_retry_end"
		|| type === "extension_error";
}

function parseEventTime(timestamp: string | undefined): number | undefined {
	if (!timestamp) {
		return undefined;
	}
	const parsed = Date.parse(timestamp);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Deterministic event -> signal mapping used by frontend and TUI renderers.
 * Priority order is strict to keep transitions stable:
 * timed_out > retrying > terminal end states > recovering > fault > active > idle.
 */
function mapPaneToSignal(pane: CuratorPaneState): CuratorTelemetrySignal {
	if (pane.status === "timed_out") {
		return buildSignal("fire", "timed_out", pane);
	}
	if (pane.retryActive) {
		return buildSignal("fire", "retrying", pane);
	}
	if (pane.status === "ended") {
		if (pane.finishReason === "completed") return buildSignal("water", "completed", pane);
		if (pane.finishReason === "cancelled") return buildSignal("water", "cancelled", pane);
		return buildSignal("fire", "failed", pane);
	}
	if (pane.recoveryActive) {
		return buildSignal("water", "recovering", pane);
	}
	if (pane.failureActive) {
		return buildSignal("fire", "fault", pane);
	}
	if (pane.status === "running") {
		return buildSignal("water", "active", pane);
	}
	return buildSignal("water", "idle", pane);
}

function buildSignal(
	element: CuratorTelemetrySignalElement,
	stage: CuratorTelemetrySignalStage,
	pane: CuratorPaneState,
): CuratorTelemetrySignal {
	return {
		version: "curator.signal.v1",
		key: `${element}:${stage}`,
		element,
		stage,
		retryActive: pane.retryActive,
		retryAttempt: pane.retryAttempt,
		retryMaxAttempts: pane.retryMaxAttempts,
		failureActive: pane.failureActive,
		recoveryActive: pane.recoveryActive,
		detail: pane.lastError ?? pane.finishReason,
	};
}
