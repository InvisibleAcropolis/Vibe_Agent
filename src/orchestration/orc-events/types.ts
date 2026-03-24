/**
 * Domain layer: shared normalized orchestration event types and reducer-facing state contracts only.
 * Import this module when you need stable event shapes without crossing into normalization, policy, or UI summary layers.
 */
import type {
	OrcCanonicalEventEnvelope,
	OrcEventLifecycleStatus,
	OrcEventSeverity,
	OrcInteractionTarget,
} from "../orc-io.js";
import type { OrcSecurityEvent } from "../orc-security.js";

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

export interface OrcTransportFaultBoundaryRule {
	code: OrcTransportWarningCode | OrcTransportFaultCode;
	boundary: OrcTransportRecoveryBoundary;
	defaultStatus: OrcTransportHealthStatus;
	recovery: "continue_stream" | "request_supervisor_restart" | "terminate_transport";
	description: string;
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

export interface OrcNormalizeEventOptions<TRawPayload = Record<string, unknown>> {
	normalizedFrom?: string;
	rawNamespace?: string;
	fallbackEventKind?: OrcBusEventKind;
	rawPayload?: TRawPayload;
}
