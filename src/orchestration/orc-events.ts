import type {
	OrcCanonicalEventEnvelope,
	OrcEventLifecycleStatus,
	OrcEventSeverity,
	OrcInteractionTarget,
} from "./orc-io.js";
import { presentOrcEventSummary } from "./orc-presentation.js";
import {
	getOrcSecurityTelemetryDisposition,
	isBlockingOrcSecurityEvent,
	mapCommandInterceptorResultToOrcSecurityEvent,
	type OrcCommandInterceptorResult,
	type OrcSecurityEvent,
} from "./orc-security.js";
import type {
	OrcActiveExecutionWave,
	OrcCheckpointMetadataSummary,
	OrcControlPlaneState,
	OrcLifecyclePhase,
	OrcOrchestratorMessage,
	OrcParallelWorkerResult,
	OrcReducedTransportHealth,
	OrcTerminalStateSummary,
	OrcVerificationError,
	OrcWorkerResultStatus,
} from "./orc-state.js";

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
export type OrcTransportRecoveryBoundary = "recoverable_noise" | "fatal_corruption";
export type OrcTransportWarningCode =
	| "transport_parse_noise"
	| "transport_idle_timeout"
	| "transport_partial_line_truncated"
	| "transport_stderr_truncated";
export type OrcTransportFaultCode =
	| "transport_corrupt_stream"
	| "transport_ready_timeout"
	| "transport_stall_timeout"
	| "transport_stdout_overflow"
	| "transport_startup_failure"
	| "transport_disconnect"
	| "transport_broken_pipe"
	| "transport_non_zero_exit"
	| "transport_signal_shutdown"
	| "transport_user_cancellation"
	| "transport_ambiguous_terminal_state";

export type OrcFailureRetryability = "phase_2_retryable" | "phase_3_recovery" | "not_retryable";

export interface OrcFailureDisposition {
	code: OrcTransportFaultCode;
	terminalState: "failed" | "cancelled" | "ambiguous";
	retryability: OrcFailureRetryability;
	remediationHint: string;
	phase2Decision: string;
}

/**
 * Phase 2 recovery taxonomy:
 * - `recoverable_noise` warnings are malformed or incomplete records where the transport can keep reading later lines.
 * - `fatal_corruption` faults mean framing/progress guarantees have broken badly enough that runtime supervision should treat the stream as unhealthy.
 */
export interface OrcTransportFaultBoundaryRule {
	code: OrcTransportWarningCode | OrcTransportFaultCode;
	boundary: OrcTransportRecoveryBoundary;
	defaultStatus: OrcTransportHealthStatus;
	recovery: "continue_stream" | "request_supervisor_restart" | "terminate_transport";
	description: string;
}

export const ORC_TRANSPORT_FAULT_BOUNDARY_RULES: Record<
	OrcTransportWarningCode | OrcTransportFaultCode,
	OrcTransportFaultBoundaryRule
> = {
	transport_parse_noise: {
		code: "transport_parse_noise",
		boundary: "recoverable_noise",
		defaultStatus: "degraded",
		recovery: "continue_stream",
		description: "A single completed stdout line could not be decoded or normalized, but newline framing remains intact.",
	},
	transport_idle_timeout: {
		code: "transport_idle_timeout",
		boundary: "recoverable_noise",
		defaultStatus: "degraded",
		recovery: "continue_stream",
		description: "The child process has gone quiet longer than the idle threshold but has not yet exceeded the fatal stall timeout.",
	},
	transport_partial_line_truncated: {
		code: "transport_partial_line_truncated",
		boundary: "recoverable_noise",
		defaultStatus: "degraded",
		recovery: "continue_stream",
		description: "End-of-stream arrived with an unterminated stdout JSONL fragment, so the partial bytes were reported instead of silently parsed or dropped.",
	},
	transport_stderr_truncated: {
		code: "transport_stderr_truncated",
		boundary: "recoverable_noise",
		defaultStatus: "degraded",
		recovery: "continue_stream",
		description: "A stderr diagnostic snippet exceeded the preview budget and was truncated for UI/debug safety.",
	},
	transport_corrupt_stream: {
		code: "transport_corrupt_stream",
		boundary: "fatal_corruption",
		defaultStatus: "faulted",
		recovery: "request_supervisor_restart",
		description: "Repeated malformed stdout lines or invalid envelope structure indicate the JSONL stream can no longer be trusted.",
	},
	transport_ready_timeout: {
		code: "transport_ready_timeout",
		boundary: "fatal_corruption",
		defaultStatus: "faulted",
		recovery: "request_supervisor_restart",
		description: "The child process spawned but failed to produce a valid ready-capable envelope before the launch timeout elapsed.",
	},
	transport_stall_timeout: {
		code: "transport_stall_timeout",
		boundary: "fatal_corruption",
		defaultStatus: "faulted",
		recovery: "request_supervisor_restart",
		description: "No stdout/stderr progress was observed beyond the fatal stall threshold, so the transport should be considered hung.",
	},
	transport_stdout_overflow: {
		code: "transport_stdout_overflow",
		boundary: "fatal_corruption",
		defaultStatus: "faulted",
		recovery: "terminate_transport",
		description: "The stdout assembler buffer exceeded its byte budget before a newline arrived, destroying trustworthy record boundaries.",
	},
	transport_startup_failure: {
		code: "transport_startup_failure",
		boundary: "fatal_corruption",
		defaultStatus: "faulted",
		recovery: "request_supervisor_restart",
		description: "The runner failed before a stable ready state was established.",
	},
	transport_disconnect: {
		code: "transport_disconnect",
		boundary: "fatal_corruption",
		defaultStatus: "offline",
		recovery: "request_supervisor_restart",
		description: "The transport disconnected unexpectedly and may require replay-aware recovery.",
	},
	transport_broken_pipe: {
		code: "transport_broken_pipe",
		boundary: "fatal_corruption",
		defaultStatus: "faulted",
		recovery: "request_supervisor_restart",
		description: "A required IPC pipe closed unexpectedly while the runtime was communicating with the runner.",
	},
	transport_non_zero_exit: {
		code: "transport_non_zero_exit",
		boundary: "fatal_corruption",
		defaultStatus: "offline",
		recovery: "request_supervisor_restart",
		description: "The runner exited with a non-zero status code.",
	},
	transport_signal_shutdown: {
		code: "transport_signal_shutdown",
		boundary: "fatal_corruption",
		defaultStatus: "offline",
		recovery: "request_supervisor_restart",
		description: "The runner was terminated by SIGTERM/SIGINT or another external signal.",
	},
	transport_user_cancellation: {
		code: "transport_user_cancellation",
		boundary: "fatal_corruption",
		defaultStatus: "offline",
		recovery: "terminate_transport",
		description: "The operator intentionally cancelled the run.",
	},
	transport_ambiguous_terminal_state: {
		code: "transport_ambiguous_terminal_state",
		boundary: "fatal_corruption",
		defaultStatus: "faulted",
		recovery: "request_supervisor_restart",
		description: "Conflicting terminal signals were observed and the true final state is ambiguous.",
	},
};

export function classifyOrcTransportIssue(
	code: OrcTransportWarningCode | OrcTransportFaultCode,
): OrcTransportFaultBoundaryRule {
	return ORC_TRANSPORT_FAULT_BOUNDARY_RULES[code];
}

export const ORC_FAILURE_DISPOSITIONS: Record<OrcTransportFaultCode, OrcFailureDisposition> = {
	transport_corrupt_stream: {
		code: "transport_corrupt_stream",
		terminalState: "failed",
		retryability: "phase_2_retryable",
		remediationHint: "Restart the Python runner; the JSONL framing is no longer trustworthy.",
		phase2Decision: "Supervisor restart is allowed in Phase 2 because no durable replay is required before relaunch.",
	},
	transport_ready_timeout: {
		code: "transport_ready_timeout",
		terminalState: "failed",
		retryability: "phase_2_retryable",
		remediationHint: "Confirm the runner bootstrap command and Python environment, then relaunch the transport.",
		phase2Decision: "Phase 2 may retry bootstrap failures by starting a fresh transport process.",
	},
	transport_stall_timeout: {
		code: "transport_stall_timeout",
		terminalState: "failed",
		retryability: "phase_2_retryable",
		remediationHint: "Terminate the hung runner and start a fresh transport session.",
		phase2Decision: "Phase 2 may restart a hung transport because work replay is not attempted yet.",
	},
	transport_stdout_overflow: {
		code: "transport_stdout_overflow",
		terminalState: "failed",
		retryability: "not_retryable",
		remediationHint: "Reduce runner output volume or fix framing before retrying; the current stream exceeded the safety budget.",
		phase2Decision: "Deferred for manual remediation because Phase 2 cannot safely recover the lost record boundary.",
	},
	transport_startup_failure: {
		code: "transport_startup_failure",
		terminalState: "failed",
		retryability: "phase_2_retryable",
		remediationHint: "Verify the spawn contract, executable path, and permissions, then relaunch.",
		phase2Decision: "Phase 2 can retry spawn/setup failures with a clean process start.",
	},
	transport_disconnect: {
		code: "transport_disconnect",
		terminalState: "failed",
		retryability: "phase_3_recovery",
		remediationHint: "Inspect runner logs and use checkpoint/replay recovery when it becomes available; Phase 2 only records the failure.",
		phase2Decision: "Deferred to Phase 3 because reconnecting may require durable replay to reconstruct in-flight state.",
	},
	transport_broken_pipe: {
		code: "transport_broken_pipe",
		terminalState: "failed",
		retryability: "phase_2_retryable",
		remediationHint: "The child closed its pipe unexpectedly; inspect stderr and launch a fresh runner.",
		phase2Decision: "Phase 2 may retry broken-pipe failures by starting a new transport process.",
	},
	transport_non_zero_exit: {
		code: "transport_non_zero_exit",
		terminalState: "failed",
		retryability: "phase_3_recovery",
		remediationHint: "Review stderr and tracker snapshots before relaunching; durable replay is needed to recover in-flight work safely.",
		phase2Decision: "Deferred to Phase 3 because the process may have exited mid-wave without replayable completion state.",
	},
	transport_signal_shutdown: {
		code: "transport_signal_shutdown",
		terminalState: "failed",
		retryability: "phase_3_recovery",
		remediationHint: "Determine whether an external SIGTERM/SIGINT interrupted the run, then resume only after replay support is available.",
		phase2Decision: "Deferred to Phase 3 because signal interruptions may leave partial side effects that need replay-aware recovery.",
	},
	transport_user_cancellation: {
		code: "transport_user_cancellation",
		terminalState: "cancelled",
		retryability: "phase_2_retryable",
		remediationHint: "Operator cancellation is final for this run; start a new run or resume from a later checkpoint if desired.",
		phase2Decision: "Phase 2 treats user cancellation as an intentional terminal state and allows launching a fresh run later.",
	},
	transport_ambiguous_terminal_state: {
		code: "transport_ambiguous_terminal_state",
		terminalState: "ambiguous",
		retryability: "phase_3_recovery",
		remediationHint: "Inspect the event log and tracker snapshot together; replay support is required to resolve conflicting terminal signals safely.",
		phase2Decision: "Deferred to Phase 3 because conflicting terminal signals require durable recovery/replay analysis.",
	},
};

export function classifyOrcFailureDisposition(code: OrcTransportFaultCode): OrcFailureDisposition {
	return ORC_FAILURE_DISPOSITIONS[code];
}

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
		failureCode?: OrcTransportFaultCode;
		retryability?: OrcFailureRetryability;
		remediationHint?: string;
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
		remediationHint?: string;
		retryability?: OrcFailureRetryability;
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
	lastRemediationHint?: string;
	lastFailureCode?: string;
	retryability?: OrcFailureRetryability;
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


export function mapOrcSecurityEventToCanonicalSeverity(event: OrcSecurityEvent): Extract<OrcEventSeverity, "notice" | "warning" | "error" | "critical"> {
	const disposition = getOrcSecurityTelemetryDisposition(event);
	if (disposition === "blocked") {
		return "error";
	}
	if (disposition === "approval-required") {
		return "warning";
	}
	return "notice";
}

export function createOrcSecurityApprovalEvent(input: {
	envelope: OrcCanonicalEventEnvelope<Record<string, unknown>>;
	event: OrcSecurityEvent;
	normalizedFrom?: string;
	notes?: string[];
	escalationReason?: string;
}): OrcSecurityApprovalEvent {
	return {
		kind: "security.approval",
		envelope: {
			...input.envelope,
			what: {
				...input.envelope.what,
				category: "security",
				severity: mapOrcSecurityEventToCanonicalSeverity(input.event),
				status: isBlockingOrcSecurityEvent(input.event) ? "waiting_on_input" : "succeeded",
				description: input.envelope.what.description ?? input.event.detail,
			},
		},
		payload: {
			event: input.event,
			severityOverride: mapOrcSecurityEventToCanonicalSeverity(input.event),
			escalationReason: input.escalationReason ?? input.event.reason,
		},
		interaction: classifyOrcInteraction(input.envelope),
		debug: {
			rawPayload: input.envelope.rawPayload,
			normalizedFrom: input.normalizedFrom ?? "security-event",
			notes: input.notes,
		},
	};
}

export function createOrcSecurityEventFromInterceptorResult(input: {
	envelope: OrcCanonicalEventEnvelope<Record<string, unknown>>;
	result: OrcCommandInterceptorResult;
	normalizedFrom?: string;
	notes?: string[];
}): OrcSecurityApprovalEvent {
	const event = mapCommandInterceptorResultToOrcSecurityEvent(input.result);
	return createOrcSecurityApprovalEvent({
		envelope: input.envelope,
		event,
		normalizedFrom: input.normalizedFrom ?? "command-interceptor",
		notes: input.notes,
		escalationReason: input.result.reason,
	});
}

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

export function normalizeOrcTransportEnvelope<TRawPayload extends Record<string, unknown> = Record<string, unknown>>(
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
					workerId: readString(envelope, ["workerId"]) ?? envelope.origin.workerId ?? envelope.who.workerId,
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
					workerId: readString(envelope, ["workerId"]) ?? envelope.origin.workerId ?? envelope.who.workerId,
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
					workerId: readString(envelope, ["workerId"]) ?? envelope.origin.workerId ?? envelope.who.workerId,
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
					waveId: readString(envelope, ["waveId"]) ?? envelope.origin.waveId ?? envelope.origin.threadId,
					taskId: readString(envelope, ["taskId"]),
					summary: readString(envelope, ["summary", "message"], envelope.what.description ?? eventNameAsSummary(envelope)),
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
					remediationHint: readString(envelope, ["remediationHint"]),
					retryability: readStringUnion(envelope, ["retryability"], ["phase_2_retryable", "phase_3_recovery", "not_retryable"]),
				},
			};
		case "checkpoint.status":
			return {
				...base,
				kind,
				payload: {
					status: readStringUnion(envelope, ["status", "checkpointStatus"], ["started", "captured", "restored", "failed", "stale"], mapStatusToCheckpointStatus(envelope.what.status)),
					checkpointId: readString(envelope, ["checkpointId"], envelope.how.checkpointId ?? envelope.origin.eventId),
					threadId: readString(envelope, ["threadId"], envelope.origin.threadId ?? envelope.origin.runCorrelationId),
					waveId: readString(envelope, ["waveId"]) ?? envelope.origin.waveId ?? envelope.origin.threadId,
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

export interface OrcControlPlaneReductionOptions {
	maxMessages?: number;
	maxVerificationErrors?: number;
}

const DEFAULT_CONTROL_PLANE_REDUCTION_OPTIONS: Required<OrcControlPlaneReductionOptions> = {
	maxMessages: 50,
	maxVerificationErrors: 50,
};

export function reduceOrcControlPlaneEvent(
	state: OrcControlPlaneState,
	event: OrcBusEvent,
	options: OrcControlPlaneReductionOptions = {},
): OrcControlPlaneState {
	const limits = { ...DEFAULT_CONTROL_PLANE_REDUCTION_OPTIONS, ...options };
	const next: OrcControlPlaneState = {
		...state,
		messages: [...state.messages],
		securityEvents: state.securityEvents ? [...state.securityEvents] : undefined,
		workerResults: state.workerResults.map((result) => ({
			...result,
			artifactIds: [...result.artifactIds],
			logIds: [...result.logIds],
			metadata: result.metadata ? { ...result.metadata } : undefined,
		})),
		verificationErrors: state.verificationErrors.map((issue) => ({ ...issue })),
		activeWave: state.activeWave
			? { ...state.activeWave, workerIds: [...state.activeWave.workerIds] }
			: undefined,
		checkpointMetadata: {
			...state.checkpointMetadata,
			artifactBundleIds: [...state.checkpointMetadata.artifactBundleIds],
			rewindTargetIds: [...state.checkpointMetadata.rewindTargetIds],
		},
		transportHealth: { ...state.transportHealth },
		terminalState: { ...state.terminalState, ambiguityNotes: [...state.terminalState.ambiguityNotes] },
		lastUpdatedAt: event.envelope.when,
	};

	applyReducedPhaseAndLifecycle(next, event);
	applyReducedActiveWave(next, event);
	applyReducedWorkerResults(next, event);
	applyReducedUserMessages(next, event, limits.maxMessages);
	applyReducedSecurityEvents(next, event);
	applyReducedCheckpointMetadata(next, event);
	applyReducedTransportHealth(next, event);
	applyReducedTerminalState(next, event);
	trimReducedCollections(next, limits);
	return next;
}

export function createInitialCheckpointMetadataSummary(): OrcCheckpointMetadataSummary {
	return {
		status: "idle",
		artifactBundleIds: [],
		rewindTargetIds: [],
	};
}

export function createInitialReducedTransportHealth(): OrcReducedTransportHealth {
	return {
		status: "unknown",
		consecutiveWarnings: 0,
		consecutiveFaults: 0,
	};
}

export function createInitialTerminalStateSummary(): OrcTerminalStateSummary {
	return {
		status: "running",
		ambiguityNotes: [],
	};
}

/**
 * Durable reduction rules for outside engineers:
 * - retries mutate the existing worker summary in place and never create a second durable worker row; retry counts live in metadata.
 * - cancellations win over non-terminal activity but do not erase already-recorded failures or partial outputs.
 * - ambiguous completion is recorded when competing terminal signals disagree across worker/graph/process events.
 * - partial failures keep the thread phase executing/verifying when useful work remains, while the terminal summary captures the degraded outcome.
 *
 * Phase 3 checkpoint implication: tracker snapshots should be taken only at durable reduced-state boundaries. Event-log offsets before the
 * checkpoint can be replayed to rebuild transient overlays, but snapshots after the checkpoint must already include the durable reductions below.
 */

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
		state.transportHealth.consecutiveWarnings = 0;
		state.transportHealth.consecutiveFaults = 0;
		state.transportHealth.lastRemediationHint = undefined;
		state.transportHealth.lastFailureCode = undefined;
		state.transportHealth.retryability = undefined;
		return;
	}

	if (event.kind === "security.approval" && !isBlockingOrcSecurityEvent(event.payload.event)) {
		state.transportHealth.lastHeartbeatAt = event.envelope.when;
		state.transportHealth.lastMessage = summarizeOrcEvent(event);
		return;
	}
	if (event.kind === "stream.warning") {
		state.transportHealth.status = "degraded";
		state.transportHealth.lastWarningAt = event.envelope.when;
		state.transportHealth.lastMessage = event.payload.message;
		state.transportHealth.lastFailureCode = event.payload.warningCode;
		state.transportHealth.consecutiveWarnings += 1;
		state.transportHealth.rawEvent = event;
		return;
	}
	if (event.kind === "transport.fault") {
		state.transportHealth.status = event.payload.status;
		state.transportHealth.lastFaultAt = event.envelope.when;
		state.transportHealth.lastMessage = event.payload.message;
		state.transportHealth.lastFailureCode = event.payload.faultCode;
		state.transportHealth.lastRemediationHint = event.payload.remediationHint;
		state.transportHealth.retryability = event.payload.retryability;
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

function applyReducedPhaseAndLifecycle(state: OrcControlPlaneState, event: OrcBusEvent): void {
	const phase = deriveLifecyclePhase(state, event);
	if (phase) {
		state.phase = phase;
	}
}

function applyReducedActiveWave(state: OrcControlPlaneState, event: OrcBusEvent): void {
	const waveId = readWaveId(event);
	if (!waveId) {
		if (event.kind === "graph.lifecycle" && ["completed", "failed", "cancelled"].includes(event.payload.stage)) {
			state.activeWave = undefined;
		}
		return;
	}
	const workerId = extractWorkerId(event);
	const nextPhase = mapEventToWavePhase(state.phase, event);
	const prior = state.activeWave && state.activeWave.waveId === waveId ? state.activeWave : undefined;
	const workerIds = uniqueStringValues([...(prior?.workerIds ?? []), ...(workerId ? [workerId] : [])]);
	const goal = event.kind === "worker.status" ? event.payload.summary ?? prior?.goal : prior?.goal;
	state.activeWave = {
		waveId,
		phase: nextPhase,
		startedAt: prior?.startedAt ?? event.envelope.when,
		checkpointId: event.kind === "checkpoint.status" ? event.payload.checkpointId ?? prior?.checkpointId : prior?.checkpointId,
		workerCount: Math.max(prior?.workerCount ?? 0, workerIds.length),
		workerIds,
		goal,
	};
	if (event.kind === "checkpoint.status" && ["captured", "restored"].includes(event.payload.status)) {
		state.activeWave.checkpointId = event.payload.checkpointId ?? state.activeWave.checkpointId;
	}
	if ((event.kind === "graph.lifecycle" && ["completed", "failed", "cancelled"].includes(event.payload.stage)) || (event.kind === "process.lifecycle" && ["exited", "terminated"].includes(event.payload.stage))) {
		state.activeWave = undefined;
	}
}

function applyReducedWorkerResults(state: OrcControlPlaneState, event: OrcBusEvent): void {
	const workerId = extractWorkerId(event);
	if (!workerId) {
		return;
	}
	const waveId = readWaveId(event) ?? state.activeWave?.waveId ?? "unknown-wave";
	const index = state.workerResults.findIndex((item) => item.workerId === workerId && item.waveId === waveId);
	const prior = index >= 0 ? state.workerResults[index] : undefined;
	const next = prior ? { ...prior, artifactIds: [...prior.artifactIds], logIds: [...prior.logIds], metadata: prior.metadata ? { ...prior.metadata } : {} } : createInitialWorkerResult(workerId, waveId, event.envelope.when);
	mergeWorkerResultFromEvent(state, next, event);
	if (index >= 0) {
		state.workerResults[index] = next;
	} else {
		state.workerResults.push(next);
	}
}

function applyReducedUserMessages(state: OrcControlPlaneState, event: OrcBusEvent, maxMessages: number): void {
	if (event.kind !== "agent.message" || !event.interaction.isUserFacing) {
		return;
	}
	const message: OrcOrchestratorMessage = {
		id: event.payload.messageId,
		role: event.payload.workerId ? "worker" : event.payload.role === "user" ? "user" : "orchestrator",
		phase: state.phase,
		createdAt: event.envelope.when,
		content: event.payload.content,
		waveId: readWaveId(event),
		workerId: event.payload.workerId,
		metadata: {
			agentId: event.payload.agentId ?? event.envelope.who.id,
			streamState: event.payload.streamState ?? null,
		},
	};
	const existingIndex = state.messages.findIndex((item) => item.id === message.id);
	if (existingIndex >= 0) {
		state.messages[existingIndex] = message;
	} else {
		state.messages.push(message);
	}
	state.messages = state.messages.slice(-maxMessages);
}


function applyReducedSecurityEvents(state: OrcControlPlaneState, event: OrcBusEvent): void {
	if (event.kind !== "security.approval") {
		return;
	}
	const securityEvents = state.securityEvents ?? [];
	const nextSecurityEvent = { ...event.payload.event };
	const existingIndex = securityEvents.findIndex((entry) =>
		entry.createdAt === nextSecurityEvent.createdAt
		&& entry.kind === nextSecurityEvent.kind
		&& entry.workerId === nextSecurityEvent.workerId
		&& entry.detail === nextSecurityEvent.detail
	);
	if (existingIndex >= 0) {
		securityEvents[existingIndex] = nextSecurityEvent;
	} else {
		securityEvents.push(nextSecurityEvent);
	}
	state.securityEvents = securityEvents;
	if (!nextSecurityEvent.workerId) {
		return;
	}
	const waveId = readWaveId(event) ?? state.activeWave?.waveId ?? "unknown-wave";
	const index = state.workerResults.findIndex((item) => item.workerId === nextSecurityEvent.workerId && item.waveId === waveId);
	const workerResult = index >= 0 ? { ...state.workerResults[index]!, artifactIds: [...state.workerResults[index]!.artifactIds], logIds: [...state.workerResults[index]!.logIds], metadata: { ...(state.workerResults[index]!.metadata ?? {}) } } : createInitialWorkerResult(nextSecurityEvent.workerId, waveId, event.envelope.when);
	workerResult.metadata = workerResult.metadata ?? {};
	workerResult.metadata.securityTelemetryDisposition = getOrcSecurityTelemetryDisposition(nextSecurityEvent);
	workerResult.metadata.securityStatusText = nextSecurityEvent.statusText;
	workerResult.metadata.lastSecurityEventAt = event.envelope.when;
	if (nextSecurityEvent.kind === "approval-required") {
		workerResult.status = "pending";
		workerResult.summary = nextSecurityEvent.detail;
		workerResult.errorMessage = undefined;
		workerResult.metadata.awaitingApproval = true;
	}
	if (nextSecurityEvent.kind === "blocked-command") {
		workerResult.status = workerResult.status === "completed" ? "ambiguous" : "failed";
		workerResult.summary = nextSecurityEvent.detail;
		workerResult.errorMessage = nextSecurityEvent.detail;
		workerResult.finishedAt = event.envelope.when;
		workerResult.metadata.awaitingApproval = false;
		appendVerificationErrorFromSecurityEvent(state, workerResult, event);
	}
	if (index >= 0) {
		state.workerResults[index] = workerResult;
	} else {
		state.workerResults.push(workerResult);
	}
}

function applyReducedCheckpointMetadata(state: OrcControlPlaneState, event: OrcBusEvent): void {
	if (event.kind !== "checkpoint.status") {
		return;
	}
	state.checkpointId = event.payload.checkpointId ?? state.checkpointId;
	state.checkpointMetadata = {
		...state.checkpointMetadata,
		checkpointId: event.payload.checkpointId ?? state.checkpointMetadata.checkpointId,
		status: event.payload.status,
		threadId: event.payload.threadId ?? state.checkpointMetadata.threadId ?? state.threadId,
		waveId: event.payload.waveId ?? state.checkpointMetadata.waveId,
		storagePath: event.payload.storagePath ?? state.checkpointMetadata.storagePath,
		artifactBundleIds: uniqueStringValues([
			...state.checkpointMetadata.artifactBundleIds,
			...(event.payload.artifactBundleIds ?? []),
		]),
		rewindTargetIds: uniqueStringValues([
			...state.checkpointMetadata.rewindTargetIds,
			...(event.payload.rewindTargetIds ?? []),
		]),
		message: event.payload.message ?? state.checkpointMetadata.message,
		updatedAt: event.envelope.when,
	};
}

function applyReducedTransportHealth(state: OrcControlPlaneState, event: OrcBusEvent): void {
	if (["process.lifecycle", "graph.lifecycle", "agent.message", "worker.status", "checkpoint.status", "tool.result"].includes(event.kind)) {
		state.transportHealth.status = "healthy";
		state.transportHealth.lastHeartbeatAt = event.envelope.when;
		state.transportHealth.lastMessage = summarizeOrcEvent(event);
		state.transportHealth.consecutiveWarnings = 0;
		state.transportHealth.consecutiveFaults = 0;
		state.transportHealth.lastRemediationHint = undefined;
		state.transportHealth.lastFailureCode = undefined;
		state.transportHealth.retryability = undefined;
		return;
	}
	if (event.kind === "stream.warning") {
		state.transportHealth.status = "degraded";
		state.transportHealth.lastWarningAt = event.envelope.when;
		state.transportHealth.lastMessage = event.payload.message;
		state.transportHealth.lastFailureCode = event.payload.warningCode;
		state.transportHealth.consecutiveWarnings += 1;
		return;
	}
	if (event.kind === "transport.fault") {
		state.transportHealth.status = event.payload.status;
		state.transportHealth.lastFaultAt = event.envelope.when;
		state.transportHealth.lastMessage = event.payload.message;
		state.transportHealth.lastFailureCode = event.payload.faultCode;
		state.transportHealth.lastRemediationHint = event.payload.remediationHint;
		state.transportHealth.retryability = event.payload.retryability;
		state.transportHealth.consecutiveFaults += 1;
	}
}

function applyReducedTerminalState(state: OrcControlPlaneState, event: OrcBusEvent): void {
	const previous = state.terminalState.status;
	const candidate = deriveTerminalStatus(event);
	if (!candidate) {
		if (isRetryEvent(event) && previous !== "completed") {
			state.terminalState.status = "running";
			state.terminalState.reason = summarizeOrcEvent(event);
		}
		return;
	}
	if (previous !== "running" && previous !== candidate) {
		state.terminalState.status = "ambiguous";
		state.terminalState.reason = `Conflicting terminal signals: ${previous} vs ${candidate}`;
		state.terminalState.resolvedAt = event.envelope.when;
		state.terminalState.sourceEventId = event.envelope.origin.eventId;
		state.terminalState.failureCode = "transport_ambiguous_terminal_state";
		state.terminalState.remediationHint = ORC_FAILURE_DISPOSITIONS.transport_ambiguous_terminal_state.remediationHint;
		state.terminalState.retryability = ORC_FAILURE_DISPOSITIONS.transport_ambiguous_terminal_state.retryability;
		state.terminalState.ambiguityNotes = uniqueStringValues([
			...state.terminalState.ambiguityNotes,
			state.terminalState.reason,
		]);
		if (state.phase !== "cancelled") {
			state.phase = "failed";
		}
		return;
	}
	state.terminalState.status = candidate;
	state.terminalState.reason = summarizeOrcEvent(event);
	state.terminalState.resolvedAt = event.envelope.when;
	state.terminalState.sourceEventId = event.envelope.origin.eventId;
	state.terminalState.failureCode = deriveTerminalFailureCode(event);
	state.terminalState.remediationHint = deriveTerminalRemediationHint(event);
	state.terminalState.retryability = deriveTerminalRetryability(event);
	if (candidate !== "ambiguous") {
		state.terminalState.ambiguityNotes = [];
	}
}

function trimReducedCollections(state: OrcControlPlaneState, limits: Required<OrcControlPlaneReductionOptions>): void {
	state.verificationErrors = state.verificationErrors.slice(-limits.maxVerificationErrors);
}

function deriveLifecyclePhase(state: OrcControlPlaneState, event: OrcBusEvent): OrcLifecyclePhase | undefined {
	if (isRetryEvent(event)) {
		return state.activeWave ? state.activeWave.phase : "executing";
	}
	if (isCancellationEvent(event)) {
		return "cancelled";
	}
	switch (event.kind) {
		case "process.lifecycle":
			switch (event.payload.stage) {
				case "spawned": return "bootstrapping";
				case "ready": return "planning";
				case "exited": return event.payload.exitCode === 0 ? (state.terminalState.status === "ambiguous" ? "failed" : "completed") : "failed";
				case "terminated": return state.phase === "cancelled" ? "cancelled" : "failed";
				case "restart_requested": return "bootstrapping";
			}
			break;
		case "graph.lifecycle":
			switch (event.payload.stage) {
				case "declared":
				case "initialized": return "planning";
				case "running": return state.activeWave ? "executing" : "planning";
				case "paused": return "verifying";
				case "completed": return state.workerResults.some((r) => r.status === "failed" || r.status === "partial" || r.status === "ambiguous") ? "verifying" : "completed";
				case "failed": return "failed";
				case "cancelled": return "cancelled";
			}
			break;
		case "worker.status":
			switch (event.payload.status) {
				case "queued": return "dispatching";
				case "running":
				case "waiting_on_input": return "executing";
				case "completed":
				case "failed":
				case "cancelled": return state.workerResults.some((r) => isWorkerStillActive(r)) ? "executing" : "verifying";
			}
			break;
		case "checkpoint.status":
			if (event.payload.status === "captured" || event.payload.status === "restored") return "checkpointed";
			if (event.payload.status === "failed") return "failed";
			return state.phase;
		case "transport.fault":
			return event.payload.status === "offline" ? "failed" : state.phase;
		case "security.approval":
			return isBlockingOrcSecurityEvent(event.payload.event) ? state.phase : state.phase;
	}
	return undefined;
}

function mergeWorkerResultFromEvent(state: OrcControlPlaneState, result: OrcParallelWorkerResult, event: OrcBusEvent): void {
	result.metadata = result.metadata ?? {};
	if (event.kind === "worker.status") {
		result.summary = event.payload.summary ?? result.summary;
		result.startedAt = event.payload.startedAt ?? result.startedAt ?? event.envelope.when;
		if (event.payload.finishedAt) {
			result.finishedAt = event.payload.finishedAt;
		}
		if (isRetryEvent(event)) {
			result.status = "pending";
			result.finishedAt = undefined;
			result.metadata.retryCount = Number(result.metadata.retryCount ?? 0) + 1;
			result.metadata.lastRetryAt = event.envelope.when;
			return;
		}
		result.status = mapWorkerStatusToResultStatus(event.payload.status, result.status);
		if (["completed", "failed", "cancelled"].includes(event.payload.status)) {
			result.finishedAt = event.payload.finishedAt ?? event.envelope.when;
		}
		if (result.status === "cancelled") {
			result.errorMessage = event.payload.summary ?? result.errorMessage ?? "Worker cancelled before producing a final result.";
		}
		return;
	}
	if (event.kind === "tool.result") {
		result.summary = event.payload.outputText ?? event.payload.errorText ?? result.summary;
		result.finishedAt = ["succeeded", "failed", "cancelled", "timed_out"].includes(event.payload.status) ? event.envelope.when : result.finishedAt;
		if (event.payload.status === "succeeded" && result.status === "pending") {
			result.status = "completed";
		} else if (event.payload.status === "failed" || event.payload.status === "timed_out") {
			result.status = result.status === "completed" ? "partial" : "failed";
			result.errorMessage = event.payload.errorText ?? event.payload.outputText ?? result.errorMessage;
			appendVerificationErrorFromToolResult(state, result, event);
		} else if (event.payload.status === "cancelled") {
			result.status = result.status === "completed" ? "ambiguous" : "cancelled";
			result.errorMessage = event.payload.errorText ?? "Tool execution cancelled.";
		}
		result.metadata.lastToolName = event.payload.toolName;
		return;
	}
	if (event.kind === "graph.lifecycle" && ["failed", "cancelled", "completed"].includes(event.payload.stage)) {
		if (event.payload.stage === "cancelled") {
			result.status = result.status === "completed" ? "ambiguous" : "cancelled";
		} else if (event.payload.stage === "failed") {
			result.status = result.status === "completed" ? "partial" : "failed";
		}
		result.finishedAt = event.envelope.when;
	}
}

function appendVerificationErrorFromToolResult(state: OrcControlPlaneState, result: OrcParallelWorkerResult, event: OrcToolResultEvent): void {
	const issue: OrcVerificationError = {
		code: `tool_${event.payload.status}`,
		message: event.payload.errorText ?? event.payload.outputText ?? `Tool ${event.payload.toolName} ${event.payload.status}.`,
		severity: "error",
		source: "runtime",
		workerId: result.workerId,
		logId: event.payload.callId,
	};
	const existingIndex = state.verificationErrors.findIndex((entry) => entry.logId === issue.logId && entry.workerId === issue.workerId);
	if (existingIndex >= 0) {
		state.verificationErrors[existingIndex] = issue;
	} else {
		state.verificationErrors.push(issue);
	}
}


function appendVerificationErrorFromSecurityEvent(state: OrcControlPlaneState, result: OrcParallelWorkerResult, event: OrcSecurityApprovalEvent): void {
	const issue: OrcVerificationError = {
		code: `security_${event.payload.event.kind}`,
		message: event.payload.event.detail,
		severity: event.payload.event.kind === "blocked-command" ? "error" : "warning",
		source: "runtime",
		workerId: result.workerId,
		logId: event.envelope.origin.eventId,
	};
	const existingIndex = state.verificationErrors.findIndex((entry) => entry.logId === issue.logId && entry.workerId === issue.workerId);
	if (existingIndex >= 0) {
		state.verificationErrors[existingIndex] = issue;
	} else {
		state.verificationErrors.push(issue);
	}
}

function createInitialWorkerResult(workerId: string, waveId: string, when: string): OrcParallelWorkerResult {
	return {
		workerId,
		waveId,
		status: "pending",
		artifactIds: [],
		logIds: [],
		startedAt: when,
	};
}

function mapWorkerStatusToResultStatus(status: OrcWorkerStatusEvent["payload"]["status"], prior: OrcWorkerResultStatus): OrcWorkerResultStatus {
	switch (status) {
		case "completed": return prior === "failed" ? "partial" : "completed";
		case "failed": return prior === "completed" ? "partial" : "failed";
		case "cancelled": return prior === "completed" ? "ambiguous" : "cancelled";
		default: return "pending";
	}
}

function deriveTerminalFailureCode(event: OrcBusEvent): OrcTransportFaultCode | undefined {
	if (event.kind === "transport.fault") {
		return event.payload.faultCode as OrcTransportFaultCode;
	}
	if (event.kind === "process.lifecycle") {
		if (event.payload.failureCode) {
			return event.payload.failureCode;
		}
		if (event.payload.stage === "terminated") {
			if (event.payload.reason?.includes("cancel")) {
				return "transport_user_cancellation";
			}
			if (event.payload.signal === "SIGINT" || event.payload.signal === "SIGTERM") {
				return "transport_signal_shutdown";
			}
			return "transport_disconnect";
		}
		if (event.payload.stage === "exited" && (event.payload.exitCode ?? 0) !== 0) {
			return "transport_non_zero_exit";
		}
	}
	return undefined;
}

function deriveTerminalRemediationHint(event: OrcBusEvent): string | undefined {
	const code = deriveTerminalFailureCode(event);
	return code ? ORC_FAILURE_DISPOSITIONS[code].remediationHint : undefined;
}

function deriveTerminalRetryability(event: OrcBusEvent): OrcFailureRetryability | undefined {
	if (event.kind === "transport.fault" && event.payload.retryability) {
		return event.payload.retryability;
	}
	if (event.kind === "process.lifecycle" && event.payload.retryability) {
		return event.payload.retryability;
	}
	const code = deriveTerminalFailureCode(event);
	return code ? ORC_FAILURE_DISPOSITIONS[code].retryability : undefined;
}

function deriveTerminalStatus(event: OrcBusEvent): OrcTerminalStateSummary["status"] | undefined {
	if (isCancellationEvent(event)) {
		return "cancelled";
	}
	if (event.kind === "process.lifecycle") {
		if (event.payload.stage === "exited") {
			return event.payload.exitCode === 0 ? "completed" : "failed";
		}
		if (event.payload.stage === "terminated") {
			return event.payload.reason?.includes("cancel") ? "cancelled" : "failed";
		}
	}
	if (event.kind === "graph.lifecycle") {
		if (event.payload.stage === "completed") return "completed";
		if (event.payload.stage === "failed") return "failed";
		if (event.payload.stage === "cancelled") return "cancelled";
	}
	if (event.kind === "transport.fault" && event.payload.status === "offline") {
		return "failed";
	}
	return undefined;
}

function isRetryEvent(event: OrcBusEvent): boolean {
	const name = event.envelope.what.name.toLowerCase();
	const description = (event.envelope.what.description ?? "").toLowerCase();
	return name.includes("retry") || description.includes("retry");
}

function isCancellationEvent(event: OrcBusEvent): boolean {
	if (event.envelope.what.status === "cancelled") {
		return true;
	}
	if (event.kind === "worker.status") {
		return event.payload.status === "cancelled";
	}
	if (event.kind === "tool.result") {
		return event.payload.status === "cancelled";
	}
	if (event.kind === "graph.lifecycle") {
		return event.payload.stage === "cancelled";
	}
	if (event.kind === "process.lifecycle") {
		return event.payload.stage === "terminated" && (event.payload.reason?.includes("cancel") ?? false);
	}
	return false;
}

function isWorkerStillActive(result: OrcParallelWorkerResult): boolean {
	return result.status === "pending";
}

function mapEventToWavePhase(currentPhase: OrcLifecyclePhase, event: OrcBusEvent): OrcActiveExecutionWave["phase"] {
	if (event.kind === "worker.status") {
		if (event.payload.status === "queued") return "dispatching";
		if (event.payload.status === "completed" || event.payload.status === "failed" || event.payload.status === "cancelled") return "verifying";
		return "executing";
	}
	if (currentPhase === "dispatching" || currentPhase === "executing" || currentPhase === "verifying") {
		return currentPhase;
	}
	return "executing";
}

function readWaveId(event: OrcBusEvent): string | undefined {
	if ("waveId" in event.payload && typeof event.payload.waveId === "string") {
		return event.payload.waveId;
	}
	return event.envelope.origin.waveId;
}

function uniqueStringValues(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))];
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

function readRawValue<TRawPayload>(envelope: OrcCanonicalEventEnvelope<TRawPayload>, keys: string[]): unknown {
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

function readString<TRawPayload>(envelope: OrcCanonicalEventEnvelope<TRawPayload>, keys: string[]): string | undefined;
function readString<TRawPayload>(envelope: OrcCanonicalEventEnvelope<TRawPayload>, keys: string[], fallback: string): string;
function readString<TRawPayload>(envelope: OrcCanonicalEventEnvelope<TRawPayload>, keys: string[], fallback?: string): string | undefined {
	const value = readRawValue(envelope, keys);
	return typeof value === "string" ? value : fallback;
}

function readNumber<TRawPayload>(envelope: OrcCanonicalEventEnvelope<TRawPayload>, keys: string[], fallback?: number): number | undefined {
	const value = readRawValue(envelope, keys);
	return typeof value === "number" ? value : fallback;
}

function readBoolean<TRawPayload>(envelope: OrcCanonicalEventEnvelope<TRawPayload>, keys: string[], fallback?: boolean): boolean | undefined {
	const value = readRawValue(envelope, keys);
	return typeof value === "boolean" ? value : fallback;
}

function readRecord<TRawPayload>(envelope: OrcCanonicalEventEnvelope<TRawPayload>, keys: string[]): Record<string, unknown> | undefined {
	const value = readRawValue(envelope, keys);
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function readStringArray<TRawPayload>(envelope: OrcCanonicalEventEnvelope<TRawPayload>, keys: string[]): string[] | undefined {
	const value = readRawValue(envelope, keys);
	return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function readStringUnion<TRawPayload, T extends string>(
	envelope: OrcCanonicalEventEnvelope<TRawPayload>,
	keys: string[],
	allowed: readonly T[],
): T | undefined;
function readStringUnion<TRawPayload, T extends string>(
	envelope: OrcCanonicalEventEnvelope<TRawPayload>,
	keys: string[],
	allowed: readonly T[],
	fallback: T,
): T;
function readStringUnion<TRawPayload, T extends string>(
	envelope: OrcCanonicalEventEnvelope<TRawPayload>,
	keys: string[],
	allowed: readonly T[],
	fallback?: T,
): T | undefined {
	const value = readRawValue(envelope, keys);
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function readSecurityEvent(envelope: OrcCanonicalEventEnvelope): OrcSecurityEvent {
	const kind = readStringUnion(envelope, ["kind"], ["informational-notice", "approval-required", "blocked-command"], "approval-required") ?? "approval-required";
	const statusText = readString(envelope, ["statusText"], envelope.what.description ?? (kind === "informational-notice" ? "Security notice" : "Approval required")) ?? (kind === "informational-notice" ? "Security notice" : "Approval required");
	const telemetryDisposition = readStringUnion(envelope, ["telemetryDisposition"], ["informational", "approval-required", "blocked"], kind === "blocked-command" ? "blocked" : kind === "approval-required" ? "approval-required" : "informational");
	return {
		kind,
		statusText,
		detail: readString(envelope, ["detail", "message"], statusText) ?? statusText,
		command: readString(envelope, ["command"]),
		workerId: readString(envelope, ["workerId"]) ?? envelope.origin.workerId ?? envelope.who.workerId,
		createdAt: readString(envelope, ["createdAt"], envelope.when) ?? envelope.when,
		telemetryDisposition,
		requiresOperatorAction: readBoolean(envelope, ["requiresOperatorAction"], telemetryDisposition !== "informational"),
		blocksExecution: readBoolean(envelope, ["blocksExecution"], telemetryDisposition !== "informational"),
		source: readStringUnion(envelope, ["source"], ["runtime-policy", "command-interceptor", "tool-runtime", "future-enforcement"]),
		ruleId: readString(envelope, ["ruleId"]),
		reason: readString(envelope, ["reason"]),
	};
}

function eventNameAsSummary(envelope: Pick<OrcCanonicalEventEnvelope, "what">): string {
	return envelope.what.description ?? envelope.what.name;
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
			if (!isBlockingOrcSecurityEvent(event.payload.event)) {
				return undefined;
			}
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
				severity: mapOrcSecurityEventToCanonicalSeverity(event.payload.event),
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
	return presentOrcEventSummary(event).detail;
}

function sumWaveMetric(
	byWaveId: OrcWaveCounts["byWaveId"],
	key: keyof OrcWaveCounts["byWaveId"][string],
): number {
	return Object.values(byWaveId).reduce((sum, bucket) => sum + bucket[key], 0);
}
