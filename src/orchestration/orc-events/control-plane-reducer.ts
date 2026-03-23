import {
	getOrcSecurityTelemetryDisposition,
	isBlockingOrcSecurityEvent,
} from "../orc-security.js";
import type {
	OrcActiveExecutionWave,
	OrcCheckpointBoundarySummary,
	OrcCheckpointMetadataSummary,
	OrcControlPlaneState,
	OrcDurableEventOffset,
	OrcLifecyclePhase,
	OrcOrchestratorMessage,
	OrcParallelWorkerResult,
	OrcReducedTransportHealth,
	OrcTerminalStateSummary,
	OrcVerificationError,
	OrcWorkerResultStatus,
} from "../orc-state.js";
import { ORC_FAILURE_DISPOSITIONS } from "./transport-policy.js";
import { summarizeOrcEvent } from "./summary.js";
import type {
	OrcBusEvent,
	OrcFailureRetryability,
	OrcSecurityApprovalEvent,
	OrcToolResultEvent,
	OrcTransportFaultCode,
	OrcWorkerStatusEvent,
} from "./types.js";

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
	applyReducedResumeBridgeMetadata(next, event);
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

export function isCheckpointWorthyOrcEvent(event: OrcBusEvent): boolean {
	switch (event.kind) {
		case "checkpoint.status":
			return true;
		case "graph.lifecycle":
			return ["running", "completed", "failed", "cancelled"].includes(event.payload.stage);
		case "worker.status":
			return ["waiting_on_input", "completed", "failed", "cancelled"].includes(event.payload.status);
		case "security.approval":
			return isBlockingOrcSecurityEvent(event.payload.event);
		case "transport.fault":
			return true;
		case "process.lifecycle":
			return ["exited", "terminated"].includes(event.payload.stage);
		default:
			return false;
	}
}

export function deriveCheckpointBoundarySummary(event: OrcBusEvent): OrcCheckpointBoundarySummary | undefined {
	if (!isCheckpointWorthyOrcEvent(event)) {
		return undefined;
	}
	return {
		eventId: event.envelope.origin.eventId,
		eventKind: event.kind,
		status: event.envelope.what.status,
		threadId: event.envelope.origin.threadId,
		runCorrelationId: event.envelope.origin.runCorrelationId,
		waveId: readWaveId(event),
		workerId: extractWorkerId(event),
		recordedAt: event.envelope.when,
	};
}

export function deriveDurableEventOffset(event: OrcBusEvent): OrcDurableEventOffset {
	const rawPayload = event.envelope.rawPayload;
	const sequence = rawPayload && typeof rawPayload === "object" && "sequence" in rawPayload ? rawPayload.sequence : undefined;
	const eventLogGlobalIndex = sequence && typeof sequence === "object" && sequence !== null && "globalEventIndex" in sequence && typeof sequence.globalEventIndex === "number"
		? sequence.globalEventIndex
		: undefined;
	return {
		eventId: event.envelope.origin.eventId,
		runCorrelationId: event.envelope.origin.runCorrelationId,
		streamSequence: event.envelope.origin.streamSequence,
		eventLogGlobalIndex,
		recordedAt: event.envelope.when,
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
		&& entry.detail === nextSecurityEvent.detail,
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
	const checkpointBoundary = deriveCheckpointBoundarySummary(event) ?? state.checkpointMetadata.checkpointBoundary;
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
		transportRunCorrelationId: event.envelope.origin.runCorrelationId ?? state.checkpointMetadata.transportRunCorrelationId,
		latestDurableEventOffset: deriveDurableEventOffset(event),
		checkpointBoundary,
		message: event.payload.message ?? state.checkpointMetadata.message,
		updatedAt: event.envelope.when,
	};
}

function applyReducedResumeBridgeMetadata(state: OrcControlPlaneState, event: OrcBusEvent): void {
	state.checkpointMetadata.transportRunCorrelationId = event.envelope.origin.runCorrelationId ?? state.checkpointMetadata.transportRunCorrelationId;
	state.checkpointMetadata.latestDurableEventOffset = deriveDurableEventOffset(event);
	const boundary = deriveCheckpointBoundarySummary(event);
	if (boundary) {
		state.checkpointMetadata.checkpointBoundary = boundary;
	}
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

function extractWorkerId(event: OrcBusEvent): string | undefined {
	if ("workerId" in event.payload && typeof event.payload.workerId === "string") {
		return event.payload.workerId;
	}
	return event.envelope.origin.workerId ?? event.envelope.who.workerId;
}
