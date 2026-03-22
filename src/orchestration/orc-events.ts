import type {
	OrcCanonicalEventEnvelope,
	OrcEventLifecycleStatus,
	OrcEventSeverity,
	OrcInteractionTarget,
} from "./orc-io.js";
import type { OrcSecurityEvent } from "./orc-security.js";

export type OrcBusEventKind =
	| "process.lifecycle"
	| "graph.lifecycle"
	| "agent.message"
	| "tool.call"
	| "tool.result"
	| "worker.status"
	| "stream.warning"
	| "transport.fault"
	| "checkpoint.status"
	| "security.approval";

export type OrcOverlayKind = "agent-detail" | "tool-call" | "approval" | "transport-health" | "checkpoint" | "error";
export type OrcTransportHealthStatus = "unknown" | "healthy" | "degraded" | "faulted" | "offline";
export type OrcInteractionLane = "agent_interacting_with_user" | "agent_interacting_with_computer" | "system_support";

export interface OrcBaseBusEvent<
	TKind extends OrcBusEventKind,
	TPayload extends Record<string, unknown>,
	TRawPayload = Record<string, unknown>,
> {
	kind: TKind;
	envelope: OrcCanonicalEventEnvelope<TRawPayload>;
	payload: TPayload;
	interaction: {
		target: OrcInteractionTarget;
		lane: OrcInteractionLane;
		isUserFacing: boolean;
		isComputerFacing: boolean;
	};
	debug: {
		rawPayload?: OrcCanonicalEventEnvelope<TRawPayload>["rawPayload"];
		normalizedFrom: string;
		notes?: string[];
	};
}

/**
 * Required from upstream: `origin.eventId`, `origin.emittedAt`, and lifecycle identity in `what.name`.
 * Optional when upstream payloads are incomplete: `payload.pid`, `payload.exitCode`, and `payload.signal`.
 */
export type OrcProcessLifecycleEvent<TRawPayload = Record<string, unknown>> = OrcBaseBusEvent<
	"process.lifecycle",
	{
		stage: "spawned" | "ready" | "exited" | "terminated" | "restart_requested";
		pid?: number;
		exitCode?: number;
		signal?: string;
		reason?: string;
	},
	TRawPayload
>;

/**
 * Required from upstream: graph identity and lifecycle stage via `payload.graphId` + `payload.stage`.
 * Optional when upstream payloads are incomplete: `payload.nodeId`, `payload.routeKey`, and timing metadata.
 */
export type OrcGraphLifecycleEvent<TRawPayload = Record<string, unknown>> = OrcBaseBusEvent<
	"graph.lifecycle",
	{
		graphId: string;
		stage: "declared" | "initialized" | "running" | "paused" | "completed" | "failed" | "cancelled";
		nodeId?: string;
		routeKey?: string;
		startedAt?: string;
		finishedAt?: string;
		reason?: string;
	},
	TRawPayload
>;

/**
 * Required from upstream: message text can be partial but some textual summary must exist in `payload.content`.
 * Optional when upstream payloads are incomplete: token counts, audience hints, and message role.
 */
export type OrcAgentMessageEvent<TRawPayload = Record<string, unknown>> = OrcBaseBusEvent<
	"agent.message",
	{
		messageId: string;
		content: string;
		role?: "assistant" | "system" | "tool" | "user";
		audience?: "operator" | "subagent" | "tool_runtime";
		workerId?: string;
		agentId?: string;
		tokenCount?: number;
		streamState?: "partial" | "final";
	},
	TRawPayload
>;

/**
 * Required from upstream: a stable call identifier and tool name are needed to correlate tool lifecycle.
 * Optional when upstream payloads are incomplete: command preview, arguments, and execution location.
 */
export type OrcToolCallEvent<TRawPayload = Record<string, unknown>> = OrcBaseBusEvent<
	"tool.call",
	{
		callId: string;
		toolName: string;
		workerId?: string;
		agentId?: string;
		commandPreview?: string;
		arguments?: Record<string, unknown>;
		workingDirectory?: string;
		approvalRequired?: boolean;
	},
	TRawPayload
>;

/**
 * Required from upstream: a stable call identifier and terminal/result status are needed for reducer joins.
 * Optional when upstream payloads are incomplete: structured result data, stderr snippets, and duration.
 */
export type OrcToolResultEvent<TRawPayload = Record<string, unknown>> = OrcBaseBusEvent<
	"tool.result",
	{
		callId: string;
		toolName: string;
		status: "succeeded" | "failed" | "cancelled" | "timed_out";
		workerId?: string;
		agentId?: string;
		durationMs?: number;
		outputText?: string;
		errorText?: string;
		result?: Record<string, unknown>;
	},
	TRawPayload
>;

/**
 * Required from upstream: `payload.workerId` and `payload.status` so the tracker can maintain per-agent activity.
 * Optional when upstream payloads are incomplete: wave binding, task label, and completion timestamps.
 */
export type OrcWorkerStatusEvent<TRawPayload = Record<string, unknown>> = OrcBaseBusEvent<
	"worker.status",
	{
		workerId: string;
		status: "idle" | "queued" | "running" | "waiting_on_input" | "completed" | "failed" | "cancelled";
		waveId?: string;
		taskId?: string;
		summary?: string;
		startedAt?: string;
		finishedAt?: string;
	},
	TRawPayload
>;

/**
 * Required from upstream: warning code + message must exist even if stream offsets are missing.
 * Optional when upstream payloads are incomplete: chunk/line numbers and parser-recovery details.
 */
export type OrcStreamWarningEvent<TRawPayload = Record<string, unknown>> = OrcBaseBusEvent<
	"stream.warning",
	{
		warningCode: string;
		message: string;
		stream: "stdout" | "stderr" | "event_bus";
		chunkSequence?: number;
		lineSequence?: number;
		recoverable?: boolean;
	},
	TRawPayload
>;

/**
 * Required from upstream: fault code + message must exist even if the transport cannot provide diagnostics.
 * Optional when upstream payloads are incomplete: retryability, syscall details, and process identity.
 */
export type OrcTransportFaultEvent<TRawPayload = Record<string, unknown>> = OrcBaseBusEvent<
	"transport.fault",
	{
		faultCode: string;
		message: string;
		status: "degraded" | "faulted" | "offline";
		retryable?: boolean;
		pid?: number;
		syscall?: string;
	},
	TRawPayload
>;

/**
 * Required from upstream: a checkpoint status plus at least one correlation key (`checkpointId` or thread/wave context).
 * Optional when upstream payloads are incomplete: storage path, artifact bundle ids, and rewind target hints.
 */
export type OrcCheckpointStatusEvent<TRawPayload = Record<string, unknown>> = OrcBaseBusEvent<
	"checkpoint.status",
	{
		status: "started" | "captured" | "restored" | "failed" | "stale";
		checkpointId?: string;
		threadId?: string;
		waveId?: string;
		storagePath?: string;
		artifactBundleIds?: string[];
		rewindTargetIds?: string[];
		message?: string;
	},
	TRawPayload
>;

/**
 * Required from upstream: `payload.event.kind`, `payload.event.statusText`, and `payload.event.detail`.
 * Optional when upstream payloads are incomplete: command preview, worker identity, and escalation metadata.
 */
export type OrcSecurityApprovalEvent<TRawPayload = Record<string, unknown>> = OrcBaseBusEvent<
	"security.approval",
	{
		event: OrcSecurityEvent;
		severityOverride?: Extract<OrcEventSeverity, "notice" | "warning" | "error" | "critical">;
		escalationReason?: string;
	},
	TRawPayload
>;

export type OrcBusEvent<TRawPayload = Record<string, unknown>> =
	| OrcProcessLifecycleEvent<TRawPayload>
	| OrcGraphLifecycleEvent<TRawPayload>
	| OrcAgentMessageEvent<TRawPayload>
	| OrcToolCallEvent<TRawPayload>
	| OrcToolResultEvent<TRawPayload>
	| OrcWorkerStatusEvent<TRawPayload>
	| OrcStreamWarningEvent<TRawPayload>
	| OrcTransportFaultEvent<TRawPayload>
	| OrcCheckpointStatusEvent<TRawPayload>
	| OrcSecurityApprovalEvent<TRawPayload>;

export interface OrcLatestActivityRecord {
	agentId: string;
	workerId?: string;
	label: string;
	lastEventKind: OrcBusEventKind;
	lastStatus: OrcEventLifecycleStatus;
	interactionLane: OrcInteractionLane;
	summary: string;
	updatedAt: string;
	severity: OrcEventSeverity;
	rawEvent: OrcBusEvent;
}

export interface OrcActiveOverlay {
	id: string;
	kind: OrcOverlayKind;
	title: string;
	status: OrcEventLifecycleStatus | "visible" | "hidden";
	workerId?: string;
	agentId?: string;
	relatedEventId: string;
	openedAt: string;
	updatedAt: string;
	summary: string;
	severity: OrcEventSeverity;
}

export interface OrcWaveCounts {
	active: number;
	queued: number;
	completed: number;
	failed: number;
	cancelled: number;
	byWaveId: Record<string, { queued: number; running: number; completed: number; failed: number; cancelled: number }>;
}

export interface OrcTransportHealthSnapshot {
	status: OrcTransportHealthStatus;
	lastHeartbeatAt?: string;
	lastFaultAt?: string;
	lastWarningAt?: string;
	consecutiveWarnings: number;
	consecutiveFaults: number;
	lastMessage?: string;
	rawEvent?: OrcBusEvent;
}

export interface OrcReducedErrorEntry {
	id: string;
	kind: Extract<OrcBusEventKind, "stream.warning" | "transport.fault" | "tool.result" | "security.approval">;
	message: string;
	severity: OrcEventSeverity;
	createdAt: string;
	workerId?: string;
	agentId?: string;
	eventId: string;
	rawEvent: OrcBusEvent;
}

export interface OrcEventReducerState {
	latestActivityByAgent: Record<string, OrcLatestActivityRecord>;
	activeOverlays: OrcActiveOverlay[];
	waveCounts: OrcWaveCounts;
	transportHealth: OrcTransportHealthSnapshot;
	recentErrors: OrcReducedErrorEntry[];
}

export const ORC_EVENT_REDUCER_INITIAL_STATE: OrcEventReducerState = {
	latestActivityByAgent: {},
	activeOverlays: [],
	waveCounts: {
		active: 0,
		queued: 0,
		completed: 0,
		failed: 0,
		cancelled: 0,
		byWaveId: {},
	},
	transportHealth: {
		status: "unknown",
		consecutiveWarnings: 0,
		consecutiveFaults: 0,
	},
	recentErrors: [],
};

export interface OrcNormalizeEventOptions<TRawPayload = Record<string, unknown>> {
	normalizedFrom?: string;
	rawNamespace?: string;
	fallbackEventKind?: OrcBusEventKind;
	rawPayload?: TRawPayload;
}

export function classifyOrcInteraction(envelope: Pick<OrcCanonicalEventEnvelope, "who" | "how" | "what">): OrcBaseBusEvent<OrcBusEventKind, Record<string, unknown>>["interaction"] {
	const isToolOrComputer =
		envelope.how.interactionTarget === "computer" || envelope.who.kind === "tool" || envelope.who.kind === "computer";
	const isAgent = envelope.who.kind === "agent";
	const lane: OrcInteractionLane = isAgent
		? isToolOrComputer
			? "agent_interacting_with_computer"
			: "agent_interacting_with_user"
		: "system_support";

	return {
		target: envelope.how.interactionTarget,
		lane,
		isUserFacing: lane === "agent_interacting_with_user",
		isComputerFacing: lane === "agent_interacting_with_computer",
	};
}

export function isUserFacingOrcEvent(event: OrcBusEvent): boolean {
	return event.interaction.isUserFacing;
}

export function isComputerFacingOrcEvent(event: OrcBusEvent): boolean {
	return event.interaction.isComputerFacing;
}

export function normalizeOrcTransportEnvelope<TRawPayload = Record<string, unknown>>(
	envelope: OrcCanonicalEventEnvelope<TRawPayload>,
	options: OrcNormalizeEventOptions<TRawPayload> = {},
): OrcBusEvent<TRawPayload> {
	const interaction = classifyOrcInteraction(envelope);
	const rawPayload = options.rawPayload ?? envelope.rawPayload?.payload;
	const debug = {
		rawPayload: rawPayload === undefined && envelope.rawPayload ? envelope.rawPayload : rawPayload === undefined ? undefined : {
			namespace: options.rawNamespace ?? envelope.rawPayload?.namespace ?? "transport.raw",
			payload: rawPayload,
		},
		normalizedFrom: options.normalizedFrom ?? `${envelope.what.category}:${envelope.what.name}`,
		notes: buildNormalizationNotes(envelope),
	};
	const base = { envelope, interaction, debug };
	const kind = inferBusEventKind(envelope, options.fallbackEventKind);

	switch (kind) {
		case "process.lifecycle":
			return {
				...base,
				kind,
				payload: {
					stage: readStringUnion(envelope, ["stage", "lifecycleStage"], ["spawned", "ready", "exited", "terminated", "restart_requested"], "spawned"),
					pid: readNumber(envelope, ["pid"]),
					exitCode: readNumber(envelope, ["exitCode"]),
					signal: readString(envelope, ["signal"]),
					reason: readString(envelope, ["reason", "message"]),
				},
			};
		case "graph.lifecycle":
			return {
				...base,
				kind,
				payload: {
					graphId: readString(envelope, ["graphId"], envelope.origin.threadId ?? envelope.origin.runCorrelationId),
					stage: readStringUnion(envelope, ["stage", "graphStage"], ["declared", "initialized", "running", "paused", "completed", "failed", "cancelled"], mapStatusToGraphStage(envelope.what.status)),
					nodeId: readString(envelope, ["nodeId"]),
					routeKey: readString(envelope, ["routeKey"]),
					startedAt: readString(envelope, ["startedAt"]),
					finishedAt: readString(envelope, ["finishedAt"]),
					reason: readString(envelope, ["reason", "message"]),
				},
			};
		case "agent.message":
			return {
				...base,
				kind,
				payload: {
					messageId: readString(envelope, ["messageId"], envelope.origin.eventId),
					content: readString(envelope, ["content", "message", "text"], envelope.what.description ?? envelope.what.name),
					role: readStringUnion(envelope, ["role"], ["assistant", "system", "tool", "user"]),
					audience: readStringUnion(envelope, ["audience"], ["operator", "subagent", "tool_runtime"]),
					workerId: readString(envelope, ["workerId"], envelope.origin.workerId),
					agentId: readString(envelope, ["agentId"], envelope.who.id),
					tokenCount: readNumber(envelope, ["tokenCount"]),
					streamState: readStringUnion(envelope, ["streamState"], ["partial", "final"]),
				},
			};
		case "tool.call":
			return {
				...base,
				kind,
				payload: {
					callId: readString(envelope, ["callId", "toolCallId"], envelope.how.toolCallId ?? envelope.origin.eventId),
					toolName: readString(envelope, ["toolName"], envelope.how.toolName ?? "unknown-tool"),
					workerId: readString(envelope, ["workerId"], envelope.origin.workerId),
					agentId: readString(envelope, ["agentId"], envelope.who.id),
					commandPreview: readString(envelope, ["commandPreview", "command"]),
					arguments: readRecord(envelope, ["arguments", "args"]),
					workingDirectory: readString(envelope, ["workingDirectory", "cwd"]),
					approvalRequired: readBoolean(envelope, ["approvalRequired"]),
				},
			};
		case "tool.result":
			return {
				...base,
				kind,
				payload: {
					callId: readString(envelope, ["callId", "toolCallId"], envelope.how.toolCallId ?? envelope.origin.eventId),
					toolName: readString(envelope, ["toolName"], envelope.how.toolName ?? "unknown-tool"),
					status: readStringUnion(envelope, ["status", "resultStatus"], ["succeeded", "failed", "cancelled", "timed_out"], mapStatusToToolResult(envelope.what.status)),
					workerId: readString(envelope, ["workerId"], envelope.origin.workerId),
					agentId: readString(envelope, ["agentId"], envelope.who.id),
					durationMs: readNumber(envelope, ["durationMs"]),
					outputText: readString(envelope, ["outputText", "stdout", "resultText"]),
					errorText: readString(envelope, ["errorText", "stderr", "message"]),
					result: readRecord(envelope, ["result"]),
				},
			};
		case "worker.status":
			return {
				...base,
				kind,
				payload: {
					workerId: readString(envelope, ["workerId"], envelope.origin.workerId ?? envelope.who.workerId ?? envelope.who.id),
					status: readStringUnion(envelope, ["status", "workerStatus"], ["idle", "queued", "running", "waiting_on_input", "completed", "failed", "cancelled"], mapStatusToWorkerStatus(envelope.what.status)),
					waveId: readString(envelope, ["waveId"], envelope.origin.waveId),
					taskId: readString(envelope, ["taskId"]),
					summary: readString(envelope, ["summary", "message"], envelope.what.description),
					startedAt: readString(envelope, ["startedAt"]),
					finishedAt: readString(envelope, ["finishedAt"]),
				},
			};
		case "stream.warning":
			return {
				...base,
				kind,
				payload: {
					warningCode: readString(envelope, ["warningCode", "code"], "stream-warning"),
					message: readString(envelope, ["message", "detail"], envelope.what.description ?? envelope.what.name),
					stream: readStringUnion(envelope, ["stream"], ["stdout", "stderr", "event_bus"], envelope.how.channel === "stderr" ? "stderr" : "stdout"),
					chunkSequence: readNumber(envelope, ["chunkSequence"]),
					lineSequence: readNumber(envelope, ["lineSequence"]),
					recoverable: readBoolean(envelope, ["recoverable"], true),
				},
			};
		case "transport.fault":
			return {
				...base,
				kind,
				payload: {
					faultCode: readString(envelope, ["faultCode", "code"], "transport-fault"),
					message: readString(envelope, ["message", "detail"], envelope.what.description ?? envelope.what.name),
					status: readStringUnion(envelope, ["status"], ["degraded", "faulted", "offline"], envelope.what.status === "failed" ? "faulted" : "degraded"),
					retryable: readBoolean(envelope, ["retryable"]),
					pid: readNumber(envelope, ["pid"]),
					syscall: readString(envelope, ["syscall"]),
				},
			};
		case "checkpoint.status":
			return {
				...base,
				kind,
				payload: {
					status: readStringUnion(envelope, ["status", "checkpointStatus"], ["started", "captured", "restored", "failed", "stale"], mapStatusToCheckpointStatus(envelope.what.status)),
					checkpointId: readString(envelope, ["checkpointId"], envelope.how.checkpointId),
					threadId: readString(envelope, ["threadId"], envelope.origin.threadId),
					waveId: readString(envelope, ["waveId"], envelope.origin.waveId),
					storagePath: readString(envelope, ["storagePath"]),
					artifactBundleIds: readStringArray(envelope, ["artifactBundleIds"]),
					rewindTargetIds: readStringArray(envelope, ["rewindTargetIds"]),
					message: readString(envelope, ["message", "detail"]),
				},
			};
		case "security.approval":
			return {
				...base,
				kind,
				payload: {
					event: readSecurityEvent(envelope),
					severityOverride: readStringUnion(envelope, ["severityOverride"], ["notice", "warning", "error", "critical"]),
					escalationReason: readString(envelope, ["escalationReason"]),
				},
			};
	}
}

export function reduceOrcBusEvent(state: OrcEventReducerState, event: OrcBusEvent): OrcEventReducerState {
	const next: OrcEventReducerState = {
		latestActivityByAgent: { ...state.latestActivityByAgent },
		activeOverlays: [...state.activeOverlays],
		waveCounts: {
			...state.waveCounts,
			byWaveId: { ...state.waveCounts.byWaveId },
		},
		transportHealth: { ...state.transportHealth },
		recentErrors: [...state.recentErrors],
	};

	applyLatestActivity(next, event);
	applyOverlayState(next, event);
	applyWaveCounts(next, event);
	applyTransportHealth(next, event);
	applyRecentErrors(next, event);

	return next;
}

function applyLatestActivity(state: OrcEventReducerState, event: OrcBusEvent): void {
	const agentId = extractAgentId(event);
	if (!agentId) {
		return;
	}
	state.latestActivityByAgent[agentId] = {
		agentId,
		workerId: extractWorkerId(event),
		label: event.envelope.who.label,
		lastEventKind: event.kind,
		lastStatus: event.envelope.what.status,
		interactionLane: event.interaction.lane,
		summary: summarizeOrcEvent(event),
		updatedAt: event.envelope.when,
		severity: event.envelope.what.severity,
		rawEvent: event,
	};
}

function applyOverlayState(state: OrcEventReducerState, event: OrcBusEvent): void {
	const overlay = deriveOverlay(event);
	if (!overlay) {
		return;
	}
	const index = state.activeOverlays.findIndex((item) => item.id === overlay.id);
	if (overlay.status === "hidden") {
		if (index >= 0) {
			state.activeOverlays.splice(index, 1);
		}
		return;
	}
	if (index >= 0) {
		state.activeOverlays[index] = overlay;
		return;
	}
	state.activeOverlays.push(overlay);
}

function applyWaveCounts(state: OrcEventReducerState, event: OrcBusEvent): void {
	if (event.kind !== "worker.status") {
		return;
	}
	const waveId = event.payload.waveId;
	if (!waveId) {
		return;
	}
	const bucket = state.waveCounts.byWaveId[waveId] ?? { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
	bucket.queued = event.payload.status === "queued" ? bucket.queued + 1 : bucket.queued;
	bucket.running = ["running", "waiting_on_input"].includes(event.payload.status) ? bucket.running + 1 : bucket.running;
	bucket.completed = event.payload.status === "completed" ? bucket.completed + 1 : bucket.completed;
	bucket.failed = event.payload.status === "failed" ? bucket.failed + 1 : bucket.failed;
	bucket.cancelled = event.payload.status === "cancelled" ? bucket.cancelled + 1 : bucket.cancelled;
	state.waveCounts.byWaveId[waveId] = bucket;
	state.waveCounts.queued = sumWaveMetric(state.waveCounts.byWaveId, "queued");
	state.waveCounts.active = sumWaveMetric(state.waveCounts.byWaveId, "running");
	state.waveCounts.completed = sumWaveMetric(state.waveCounts.byWaveId, "completed");
	state.waveCounts.failed = sumWaveMetric(state.waveCounts.byWaveId, "failed");
	state.waveCounts.cancelled = sumWaveMetric(state.waveCounts.byWaveId, "cancelled");
}

function applyTransportHealth(state: OrcEventReducerState, event: OrcBusEvent): void {
	if (event.kind === "process.lifecycle" || event.kind === "graph.lifecycle" || event.kind === "agent.message" || event.kind === "worker.status") {
		state.transportHealth.status = "healthy";
		state.transportHealth.lastHeartbeatAt = event.envelope.when;
		state.transportHealth.lastMessage = summarizeOrcEvent(event);
		state.transportHealth.rawEvent = event;
		if (event.kind !== "stream.warning") {
			state.transportHealth.consecutiveWarnings = 0;
		}
		if (event.kind !== "transport.fault") {
			state.transportHealth.consecutiveFaults = 0;
		}
		return;
	}
	if (event.kind === "stream.warning") {
		state.transportHealth.status = "degraded";
		state.transportHealth.lastWarningAt = event.envelope.when;
		state.transportHealth.lastMessage = event.payload.message;
		state.transportHealth.consecutiveWarnings += 1;
		state.transportHealth.rawEvent = event;
		return;
	}
	if (event.kind === "transport.fault") {
		state.transportHealth.status = event.payload.status;
		state.transportHealth.lastFaultAt = event.envelope.when;
		state.transportHealth.lastMessage = event.payload.message;
		state.transportHealth.consecutiveFaults += 1;
		state.transportHealth.rawEvent = event;
	}
}

function applyRecentErrors(state: OrcEventReducerState, event: OrcBusEvent): void {
	const errorEntry = deriveReducedError(event);
	if (!errorEntry) {
		return;
	}
	state.recentErrors = [errorEntry, ...state.recentErrors].slice(0, 20);
}

function inferBusEventKind(
	envelope: OrcCanonicalEventEnvelope,
	fallbackEventKind?: OrcBusEventKind,
): OrcBusEventKind {
	const explicitKind = readString(envelope, ["eventKind"]);
	if (explicitKind && isBusEventKind(explicitKind)) {
		return explicitKind;
	}
	if (fallbackEventKind) {
		return fallbackEventKind;
	}
	const category = envelope.what.category;
	const name = envelope.what.name.toLowerCase();
	if (category === "tool_call") {
		return "tool.call";
	}
	if (category === "tool_result") {
		return "tool.result";
	}
	if (category === "checkpoint") {
		return "checkpoint.status";
	}
	if (category === "security") {
		return "security.approval";
	}
	if (category === "transport") {
		return name.includes("warn") ? "stream.warning" : name.includes("fault") || name.includes("disconnect") ? "transport.fault" : "process.lifecycle";
	}
	if (category === "agent_message") {
		return "agent.message";
	}
	if (category === "lifecycle") {
		return name.includes("graph") ? "graph.lifecycle" : name.includes("worker") ? "worker.status" : "process.lifecycle";
	}
	return "graph.lifecycle";
}

function isBusEventKind(value: string): value is OrcBusEventKind {
	return [
		"process.lifecycle",
		"graph.lifecycle",
		"agent.message",
		"tool.call",
		"tool.result",
		"worker.status",
		"stream.warning",
		"transport.fault",
		"checkpoint.status",
		"security.approval",
	].includes(value);
}

function buildNormalizationNotes(envelope: OrcCanonicalEventEnvelope): string[] {
	const notes: string[] = [];
	if (!envelope.origin.workerId && !envelope.who.workerId) {
		notes.push("workerId missing from upstream envelope; reducers should treat worker affinity as unknown.");
	}
	if (!envelope.rawPayload) {
		notes.push("raw payload absent; normalized event relies on canonical envelope fields only.");
	}
	return notes;
}

function readRawValue(envelope: OrcCanonicalEventEnvelope, keys: string[]): unknown {
	const payload = envelope.rawPayload?.payload;
	if (!payload || typeof payload !== "object") {
		return undefined;
	}
	for (const key of keys) {
		if (Object.hasOwn(payload, key)) {
			return (payload as Record<string, unknown>)[key];
		}
	}
	return undefined;
}

function readString(envelope: OrcCanonicalEventEnvelope, keys: string[], fallback?: string): string | undefined {
	const value = readRawValue(envelope, keys);
	return typeof value === "string" ? value : fallback;
}

function readNumber(envelope: OrcCanonicalEventEnvelope, keys: string[], fallback?: number): number | undefined {
	const value = readRawValue(envelope, keys);
	return typeof value === "number" ? value : fallback;
}

function readBoolean(envelope: OrcCanonicalEventEnvelope, keys: string[], fallback?: boolean): boolean | undefined {
	const value = readRawValue(envelope, keys);
	return typeof value === "boolean" ? value : fallback;
}

function readRecord(envelope: OrcCanonicalEventEnvelope, keys: string[]): Record<string, unknown> | undefined {
	const value = readRawValue(envelope, keys);
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function readStringArray(envelope: OrcCanonicalEventEnvelope, keys: string[]): string[] | undefined {
	const value = readRawValue(envelope, keys);
	return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function readStringUnion<T extends string>(
	envelope: OrcCanonicalEventEnvelope,
	keys: string[],
	allowed: readonly T[],
	fallback?: T,
): T | undefined {
	const value = readRawValue(envelope, keys);
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function readSecurityEvent(envelope: OrcCanonicalEventEnvelope): OrcSecurityEvent {
	const statusText = readString(envelope, ["statusText"], envelope.what.description ?? "Approval required") ?? "Approval required";
	return {
		kind: readStringUnion(envelope, ["kind"], ["approval-required", "blocked-command"], "approval-required") ?? "approval-required",
		statusText,
		detail: readString(envelope, ["detail", "message"], statusText) ?? statusText,
		command: readString(envelope, ["command"]),
		workerId: readString(envelope, ["workerId"], envelope.origin.workerId),
		createdAt: readString(envelope, ["createdAt"], envelope.when) ?? envelope.when,
	};
}

function mapStatusToGraphStage(status: OrcEventLifecycleStatus): OrcGraphLifecycleEvent["payload"]["stage"] {
	switch (status) {
		case "declared":
		case "queued":
			return "declared";
		case "started":
		case "streaming":
			return "running";
		case "waiting_on_input":
			return "paused";
		case "succeeded":
			return "completed";
		case "failed":
		case "timed_out":
			return "failed";
		case "cancelled":
			return "cancelled";
		default:
			return "initialized";
	}
}

function mapStatusToToolResult(status: OrcEventLifecycleStatus): OrcToolResultEvent["payload"]["status"] {
	switch (status) {
		case "failed":
			return "failed";
		case "cancelled":
			return "cancelled";
		case "timed_out":
			return "timed_out";
		default:
			return "succeeded";
	}
}

function mapStatusToWorkerStatus(status: OrcEventLifecycleStatus): OrcWorkerStatusEvent["payload"]["status"] {
	switch (status) {
		case "declared":
		case "queued":
			return "queued";
		case "started":
		case "streaming":
			return "running";
		case "waiting_on_input":
			return "waiting_on_input";
		case "succeeded":
			return "completed";
		case "failed":
		case "timed_out":
			return "failed";
		case "cancelled":
			return "cancelled";
		default:
			return "idle";
	}
}

function mapStatusToCheckpointStatus(status: OrcEventLifecycleStatus): OrcCheckpointStatusEvent["payload"]["status"] {
	switch (status) {
		case "started":
		case "streaming":
			return "started";
		case "succeeded":
			return "captured";
		case "failed":
		case "timed_out":
			return "failed";
		default:
			return "stale";
	}
}

function extractAgentId(event: OrcBusEvent): string | undefined {
	if (event.envelope.who.kind === "agent") {
		return event.envelope.who.id;
	}
	if ("agentId" in event.payload && typeof event.payload.agentId === "string") {
		return event.payload.agentId;
	}
	return undefined;
}

function extractWorkerId(event: OrcBusEvent): string | undefined {
	if ("workerId" in event.payload && typeof event.payload.workerId === "string") {
		return event.payload.workerId;
	}
	return event.envelope.origin.workerId ?? event.envelope.who.workerId;
}

function deriveOverlay(event: OrcBusEvent): OrcActiveOverlay | undefined {
	const base = {
		relatedEventId: event.envelope.origin.eventId,
		openedAt: event.envelope.when,
		updatedAt: event.envelope.when,
		summary: summarizeOrcEvent(event),
		severity: event.envelope.what.severity,
		workerId: extractWorkerId(event),
		agentId: extractAgentId(event),
	};
	switch (event.kind) {
		case "tool.call":
			return {
				id: `tool:${event.payload.callId}`,
				kind: "tool-call",
				title: `Tool: ${event.payload.toolName}`,
				status: event.envelope.what.status,
				...base,
			};
		case "security.approval":
			return {
				id: `approval:${event.envelope.origin.eventId}`,
				kind: "approval",
				title: event.payload.event.statusText,
				status: event.payload.event.kind === "blocked-command" ? "visible" : event.envelope.what.status,
				...base,
			};
		case "transport.fault":
			return {
				id: "transport-health",
				kind: "transport-health",
				title: "Transport health",
				status: event.payload.status === "offline" ? "visible" : event.envelope.what.status,
				...base,
			};
		case "checkpoint.status":
			return event.payload.status === "captured" || event.payload.status === "restored"
				? {
					id: `checkpoint:${event.payload.checkpointId ?? event.envelope.origin.eventId}`,
					kind: "checkpoint",
					title: "Checkpoint status",
					status: event.envelope.what.status,
					...base,
				}
				: undefined;
		case "tool.result":
			return ["failed", "cancelled", "timed_out"].includes(event.payload.status)
				? {
					id: `tool:${event.payload.callId}`,
					kind: "error",
					title: `Tool issue: ${event.payload.toolName}`,
					status: "visible",
					...base,
				}
				: {
					id: `tool:${event.payload.callId}`,
					kind: "tool-call",
					title: `Tool: ${event.payload.toolName}`,
					status: "hidden",
					...base,
				};
		default:
			return undefined;
	}
}

function deriveReducedError(event: OrcBusEvent): OrcReducedErrorEntry | undefined {
	switch (event.kind) {
		case "stream.warning":
			return {
				id: `warn:${event.envelope.origin.eventId}`,
				kind: event.kind,
				message: event.payload.message,
				severity: event.envelope.what.severity,
				createdAt: event.envelope.when,
				workerId: extractWorkerId(event),
				agentId: extractAgentId(event),
				eventId: event.envelope.origin.eventId,
				rawEvent: event,
			};
		case "transport.fault":
			return {
				id: `fault:${event.envelope.origin.eventId}`,
				kind: event.kind,
				message: event.payload.message,
				severity: event.envelope.what.severity,
				createdAt: event.envelope.when,
				workerId: extractWorkerId(event),
				agentId: extractAgentId(event),
				eventId: event.envelope.origin.eventId,
				rawEvent: event,
			};
		case "tool.result":
			return event.payload.status === "succeeded"
				? undefined
				: {
					id: `tool-error:${event.envelope.origin.eventId}`,
					kind: event.kind,
					message: event.payload.errorText ?? `${event.payload.toolName} ${event.payload.status}`,
					severity: event.envelope.what.severity,
					createdAt: event.envelope.when,
					workerId: extractWorkerId(event),
					agentId: extractAgentId(event),
					eventId: event.envelope.origin.eventId,
					rawEvent: event,
				};
		case "security.approval":
			return {
				id: `security:${event.envelope.origin.eventId}`,
				kind: event.kind,
				message: event.payload.event.detail,
				severity: event.payload.event.kind === "blocked-command" ? "error" : "warning",
				createdAt: event.envelope.when,
				workerId: event.payload.event.workerId,
				agentId: extractAgentId(event),
				eventId: event.envelope.origin.eventId,
				rawEvent: event,
			};
		default:
			return undefined;
	}
}

function summarizeOrcEvent(event: OrcBusEvent): string {
	switch (event.kind) {
		case "agent.message":
			return event.payload.content;
		case "tool.call":
			return `${event.envelope.who.label} called ${event.payload.toolName}`;
		case "tool.result":
			return `${event.payload.toolName} ${event.payload.status}`;
		case "worker.status":
			return `${event.payload.workerId} is ${event.payload.status}`;
		case "stream.warning":
			return event.payload.message;
		case "transport.fault":
			return event.payload.message;
		case "checkpoint.status":
			return event.payload.message ?? `Checkpoint ${event.payload.status}`;
		case "security.approval":
			return event.payload.event.detail;
		case "graph.lifecycle":
			return `${event.payload.graphId} ${event.payload.stage}`;
		case "process.lifecycle":
			return `Process ${event.payload.stage}`;
	}
}

function sumWaveMetric(
	byWaveId: OrcWaveCounts["byWaveId"],
	key: keyof OrcWaveCounts["byWaveId"][string],
): number {
	return Object.values(byWaveId).reduce((sum, bucket) => sum + bucket[key], 0);
}
