/**
 * Ingress boundary: convert canonical transport envelopes into normalized orchestration bus events.
 * This layer may read raw payload fields and attach derived metadata before reducers or UI summaries consume the event.
 */
import type { OrcCanonicalEventEnvelope, OrcEventLifecycleStatus } from "../orc-io.js";
import type { OrcSecurityEvent } from "../orc-security.js";
import type {
	OrcBaseBusEvent,
	OrcBusEvent,
	OrcBusEventKind,
	OrcCheckpointStatusEvent,
	OrcGraphLifecycleEvent,
	OrcInteractionLane,
	OrcNormalizeEventOptions,
	OrcToolResultEvent,
	OrcWorkerStatusEvent,
} from "./types.js";

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

function fallbackEnvelopeSummary(envelope: Pick<OrcCanonicalEventEnvelope, "what">): string {
	return envelope.what.description ?? envelope.what.name;
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
					summary: readString(envelope, ["summary", "message"], fallbackEnvelopeSummary(envelope)),
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

export function inferBusEventKind(
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

export function isBusEventKind(value: string): value is OrcBusEventKind {
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

export function buildNormalizationNotes(envelope: OrcCanonicalEventEnvelope): string[] {
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

export function readString<TRawPayload>(envelope: OrcCanonicalEventEnvelope<TRawPayload>, keys: string[]): string | undefined;
export function readString<TRawPayload>(envelope: OrcCanonicalEventEnvelope<TRawPayload>, keys: string[], fallback: string): string;
export function readString<TRawPayload>(envelope: OrcCanonicalEventEnvelope<TRawPayload>, keys: string[], fallback?: string): string | undefined {
	const value = readRawValue(envelope, keys);
	return typeof value === "string" ? value : fallback;
}

export function readNumber<TRawPayload>(envelope: OrcCanonicalEventEnvelope<TRawPayload>, keys: string[], fallback?: number): number | undefined {
	const value = readRawValue(envelope, keys);
	return typeof value === "number" ? value : fallback;
}

export function readBoolean<TRawPayload>(envelope: OrcCanonicalEventEnvelope<TRawPayload>, keys: string[], fallback?: boolean): boolean | undefined {
	const value = readRawValue(envelope, keys);
	return typeof value === "boolean" ? value : fallback;
}

export function readRecord<TRawPayload>(envelope: OrcCanonicalEventEnvelope<TRawPayload>, keys: string[]): Record<string, unknown> | undefined {
	const value = readRawValue(envelope, keys);
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function readStringArray<TRawPayload>(envelope: OrcCanonicalEventEnvelope<TRawPayload>, keys: string[]): string[] | undefined {
	const value = readRawValue(envelope, keys);
	return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

export function readStringUnion<TRawPayload, T extends string>(
	envelope: OrcCanonicalEventEnvelope<TRawPayload>,
	keys: string[],
	allowed: readonly T[],
): T | undefined;
export function readStringUnion<TRawPayload, T extends string>(
	envelope: OrcCanonicalEventEnvelope<TRawPayload>,
	keys: string[],
	allowed: readonly T[],
	fallback: T,
): T;
export function readStringUnion<TRawPayload, T extends string>(
	envelope: OrcCanonicalEventEnvelope<TRawPayload>,
	keys: string[],
	allowed: readonly T[],
	fallback?: T,
): T | undefined {
	const value = readRawValue(envelope, keys);
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function readSecurityEvent(envelope: OrcCanonicalEventEnvelope): OrcSecurityEvent {
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
