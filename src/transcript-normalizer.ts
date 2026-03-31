import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { TranscriptItem, TranscriptPart } from "./shell-next/shared-models.js";

export interface OrcTelemetryEvent {
	eventId?: string;
	kind?: string;
	timestamp?: string | number;
	sourceId?: string;
	source?: {
		workerId?: string;
		agentId?: string;
		runtimeId?: string;
		sessionId?: string;
	};
	envelope?: {
		origin?: {
			eventId?: string;
			emittedAt?: string;
			workerId?: string;
			runtimeId?: string;
			sessionId?: string;
		};
		what?: {
			severity?: string;
			status?: string;
			name?: string;
			description?: string;
		};
	};
	payload?: Record<string, unknown>;
	severity?: string;
	status?: string;
	message?: string;
	checkpointId?: string;
	error?: unknown;
	[k: string]: unknown;
}

export interface RpcTelemetryEvent {
	eventId?: string;
	emittedAt?: string | number;
	source?: {
		agentId?: string;
		agentRole?: string;
		instanceId?: string;
	};
	telemetry?: {
		kind?: string;
		severity?: string;
		payload?: Record<string, unknown>;
	};
	[k: string]: unknown;
}

export interface TelemetryTranscriptInput {
	orc?: readonly OrcTelemetryEvent[];
	rpc?: readonly RpcTelemetryEvent[];
}

export interface NormalizedTranscript {
	items: TranscriptItem[];
	unknownMessages: AgentMessage[];
}

type ToolCallContent = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

type UnknownAssistantPart = {
	type: string;
	[k: string]: unknown;
};

type NormalizedSeverity = "notice" | "warning" | "error" | "critical";

function stableSlug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

function stableId(prefix: string, fields: Array<string | number | undefined>): string {
	const raw = fields
		.map((field) => (field === undefined ? "" : String(field)))
		.join("|");
	let hash = 2166136261;
	for (let index = 0; index < raw.length; index += 1) {
		hash ^= raw.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	const suffix = (hash >>> 0).toString(16).padStart(8, "0");
	const slug = stableSlug(raw) || "entry";
	return `${prefix}-${slug}-${suffix}`;
}

function toIsoTimestamp(timestamp: number | string | undefined): string {
	if (typeof timestamp === "string") {
		const parsed = Date.parse(timestamp);
		return Number.isFinite(parsed) ? new Date(parsed).toISOString() : timestamp;
	}
	if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
		return new Date(timestamp).toISOString();
	}
	return new Date(0).toISOString();
}

function readTextBlocks(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((item) => {
			if (typeof item !== "object" || item === null || !("type" in item)) return "";
			if (item.type === "text" && "text" in item && typeof item.text === "string") return item.text;
			if (item.type === "image") return "[image]";
			return "";
		})
		.filter(Boolean)
		.join("\n")
		.trim();
}

function createPart(id: string, kind: TranscriptPart["kind"], text: string, title?: string, expanded?: boolean): TranscriptPart {
	return {
		id,
		kind,
		text,
		title,
		expanded,
	};
}

function summarizeText(text: string, fallback: string): string {
	const trimmed = text.trim();
	if (!trimmed) return fallback;
	const singleLine = trimmed.replace(/\s+/g, " ");
	return singleLine.length > 120 ? `${singleLine.slice(0, 117)}...` : singleLine;
}

function getStatusValue(part: UnknownAssistantPart): string | undefined {
	if (typeof part.status === "string") return part.status;
	if (typeof part.state === "string") return part.state;
	if (typeof part.text === "string") return part.text;
	return undefined;
}

function getArtifactId(part: UnknownAssistantPart, fallbackId: string): string {
	for (const key of ["artifactId", "id", "name", "path", "title"]) {
		const value = part[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	return fallbackId;
}

function normalizeSeverity(raw: unknown): NormalizedSeverity {
	const value = typeof raw === "string" ? raw.toLowerCase() : "";
	if (value === "critical" || value === "fatal") return "critical";
	if (value === "error" || value === "failed") return "error";
	if (value === "warning" || value === "warn") return "warning";
	return "notice";
}

function severityLabel(severity: NormalizedSeverity): string {
	if (severity === "critical") return "critical";
	if (severity === "error") return "error";
	if (severity === "warning") return "warning";
	return "notice";
}

function toRuntimeStatus(raw: unknown): "idle" | "running" | "busy" | "done" | "failed" {
	const value = typeof raw === "string" ? raw.toLowerCase() : "";
	if (value === "idle") return "idle";
	if (value === "busy") return "busy";
	if (value === "done" || value === "completed" || value === "succeeded") return "done";
	if (value === "failed" || value === "error") return "failed";
	return "running";
}

function readSourceId(event: OrcTelemetryEvent | RpcTelemetryEvent): string {
	if (typeof event.sourceId === "string" && event.sourceId.trim()) return event.sourceId;
	if (event.source && typeof event.source === "object") {
		const source = event.source as Record<string, unknown>;
		for (const key of ["workerId", "agentId", "agentRole", "runtimeId", "instanceId", "sessionId"]) {
			const value = source[key];
			if (typeof value === "string" && value.trim()) return value;
		}
	}
	if ("envelope" in event && event.envelope && typeof event.envelope === "object") {
		const origin = (event.envelope as { origin?: Record<string, unknown> }).origin;
		const value = origin?.workerId ?? origin?.runtimeId ?? origin?.sessionId;
		if (typeof value === "string" && value.trim()) return value;
	}
	return "unknown-source";
}

function compactTelemetrySummary(source: string, kind: string, detail: string): string {
	const head = `${source} · ${kind}`;
	return detail ? summarizeText(`${head} · ${detail}`, `${source} · ${kind}`) : head;
}

function appendTelemetryParts(itemId: string, compact: string, expanded: string, badges: readonly string[]): TranscriptPart[] {
	return [
		createPart(stableId("part", [itemId, "summary"]), "summary", compact, "summary"),
		{ ...createPart(stableId("part", [itemId, "detail"]), "detail", expanded, "details", true), badges },
	];
}

export function normalizeOrcTelemetryToTranscriptItems(events: readonly OrcTelemetryEvent[]): TranscriptItem[] {
	const items: TranscriptItem[] = [];
	for (const [index, event] of events.entries()) {
		const timestamp = toIsoTimestamp(event.timestamp ?? event.envelope?.origin?.emittedAt);
		const sourceId = readSourceId(event);
		const severity = normalizeSeverity(event.severity ?? event.envelope?.what?.severity);
		const kind = typeof event.kind === "string" ? event.kind : "unknown";
		const payload = event.payload ?? {};
		const eventId = event.eventId ?? event.envelope?.origin?.eventId ?? stableId("orc-event", [index, timestamp, kind, sourceId]);
		const runtimeId = (event.source?.runtimeId ?? event.envelope?.origin?.runtimeId) as string | undefined;
		const sessionId = (event.source?.sessionId ?? event.envelope?.origin?.sessionId) as string | undefined;
		const detail = typeof event.message === "string"
			? event.message
			: typeof event.envelope?.what?.description === "string"
				? event.envelope.what.description
				: JSON.stringify(payload);

		if (kind === "checkpoint.status" || typeof event.checkpointId === "string" || typeof payload.checkpointId === "string") {
			const checkpointId = (typeof event.checkpointId === "string" ? event.checkpointId : payload.checkpointId) as string;
			const compact = compactTelemetrySummary(sourceId, "checkpoint", checkpointId || "checkpoint event");
			const itemId = stableId("checkpoint", [eventId, checkpointId, timestamp]);
			items.push({
				id: itemId,
				kind: "checkpoint",
				timestamp,
				runtimeId,
				sessionId,
				checkpointId: checkpointId || `checkpoint-${index}`,
				summary: compact,
				parts: appendTelemetryParts(itemId, compact, JSON.stringify(event, null, 2), [severityLabel(severity), sourceId]),
			});
			continue;
		}

		if (kind === "worker.status" || kind === "process.lifecycle" || kind === "graph.lifecycle") {
			const statusRaw = event.status ?? event.envelope?.what?.status ?? payload.status;
			const status = toRuntimeStatus(statusRaw);
			const compact = compactTelemetrySummary(sourceId, "runtime", typeof statusRaw === "string" ? statusRaw : status);
			const itemId = stableId("runtime-status", [eventId, timestamp, sourceId, status]);
			items.push({
				id: itemId,
				kind: "runtime-status",
				timestamp,
				runtimeId,
				sessionId,
				status,
				summary: compact,
				parts: appendTelemetryParts(itemId, compact, JSON.stringify(event, null, 2), [severityLabel(severity), sourceId]),
			});
			continue;
		}

		if (kind === "agent.message" || kind.startsWith("subagent")) {
			const subagentId = typeof payload.subagentId === "string" ? payload.subagentId : sourceId;
			const compact = compactTelemetrySummary(subagentId, "subagent", detail);
			const itemId = stableId("subagent-event", [eventId, timestamp, subagentId]);
			items.push({
				id: itemId,
				kind: "subagent-event",
				timestamp,
				runtimeId,
				sessionId,
				subagentId,
				summary: compact,
				parts: appendTelemetryParts(itemId, compact, JSON.stringify(event, null, 2), [severityLabel(severity), subagentId]),
			});
			continue;
		}

		if (severity === "error" || severity === "critical" || kind.includes("error") || kind.includes("fault")) {
			const code = typeof payload.code === "string" ? payload.code : kind;
			const compact = compactTelemetrySummary(sourceId, "error", detail);
			const itemId = stableId("error", [eventId, timestamp, sourceId, code]);
			items.push({
				id: itemId,
				kind: "error",
				timestamp,
				runtimeId,
				sessionId,
				code,
				summary: compact,
				parts: appendTelemetryParts(itemId, compact, JSON.stringify(event, null, 2), [severityLabel(severity), sourceId]),
			});
		}
	}
	return items;
}

export function normalizeRpcTelemetryToTranscriptItems(events: readonly RpcTelemetryEvent[]): TranscriptItem[] {
	const items: TranscriptItem[] = [];
	for (const [index, event] of events.entries()) {
		const timestamp = toIsoTimestamp(event.emittedAt);
		const sourceId = readSourceId(event);
		const telemetry = event.telemetry ?? {};
		const kind = typeof telemetry.kind === "string" ? telemetry.kind : "unknown";
		const severity = normalizeSeverity(telemetry.severity);
		const payload = telemetry.payload ?? {};
		const eventId = event.eventId ?? stableId("rpc-event", [index, timestamp, sourceId, kind]);
		const compact = compactTelemetrySummary(sourceId, kind, JSON.stringify(payload));
		const sessionId = typeof event.source?.instanceId === "string" ? event.source.instanceId : undefined;

		if (severity === "error" || severity === "critical" || kind === "fault") {
			const code = typeof payload.code === "string" ? payload.code : kind;
			const itemId = stableId("error", [eventId, sourceId, code, timestamp]);
			items.push({
				id: itemId,
				kind: "error",
				timestamp,
				sessionId,
				code,
				summary: compactTelemetrySummary(sourceId, "error", typeof payload.message === "string" ? payload.message : kind),
				parts: appendTelemetryParts(itemId, compact, JSON.stringify(event, null, 2), [severityLabel(severity), sourceId]),
			});
			continue;
		}

		const status = toRuntimeStatus(payload.status ?? kind);
		const itemId = stableId("runtime-status", [eventId, sourceId, status, timestamp]);
		items.push({
			id: itemId,
			kind: "runtime-status",
			timestamp,
			sessionId,
			status,
			summary: compactTelemetrySummary(sourceId, "rpc", kind),
			parts: appendTelemetryParts(itemId, compact, JSON.stringify(event, null, 2), [severityLabel(severity), sourceId]),
		});
	}
	return items;
}

function compareByTimestampThenId(left: TranscriptItem, right: TranscriptItem): number {
	const leftMs = Date.parse(left.timestamp);
	const rightMs = Date.parse(right.timestamp);
	if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
		return leftMs - rightMs;
	}
	if (left.timestamp !== right.timestamp) {
		return left.timestamp < right.timestamp ? -1 : 1;
	}
	return left.id.localeCompare(right.id);
}

export function normalizeTranscript(messages: AgentMessage[], telemetry?: TelemetryTranscriptInput): NormalizedTranscript {
	const items: TranscriptItem[] = [];
	const unknownMessages: AgentMessage[] = [];
	const toolCallNames = new Map<string, string>();

	for (const [messageIndex, message] of messages.entries()) {
		const timestamp = toIsoTimestamp((message as { timestamp?: number | string }).timestamp);

		if (message.role === "user") {
			const text = readTextBlocks(message.content);
			const itemId = stableId("user", [message.role, timestamp, messageIndex, text]);
			items.push({
				id: itemId,
				kind: "user",
				timestamp,
				summary: summarizeText(text, "User message"),
				parts: [createPart(stableId("part", [itemId, "text"]), "text", text || "(empty)")],
			});
			continue;
		}

		if (message.role === "assistant") {
			for (const [contentIndex, content] of (message.content as Array<AssistantMessage["content"][number] | UnknownAssistantPart>).entries()) {
				if (content.type === "text") {
					const text = content.text.trim();
					if (!text) continue;
					const itemId = stableId("assistant-text", [timestamp, messageIndex, contentIndex, text]);
					items.push({
						id: itemId,
						kind: "assistant-text",
						timestamp,
						summary: summarizeText(text, "Assistant text"),
						parts: [createPart(stableId("part", [itemId, "text"]), "text", text)],
					});
					continue;
				}

				if (content.type === "thinking") {
					const text = content.thinking.trim();
					if (!text) continue;
					const itemId = stableId("assistant-thinking", [timestamp, messageIndex, contentIndex, text]);
					items.push({
						id: itemId,
						kind: "assistant-thinking",
						timestamp,
						summary: summarizeText(text, "Assistant thinking"),
						parts: [createPart(stableId("part", [itemId, "thinking"]), "thinking", text, "thinking")],
					});
					continue;
				}

				if (content.type === "toolCall") {
					const call = content as ToolCallContent;
					toolCallNames.set(call.id, call.name);
					const argsText = JSON.stringify(call.arguments ?? {}, null, 2);
					const itemId = stableId("tool-call", [timestamp, messageIndex, contentIndex, call.id, call.name]);
					items.push({
						id: itemId,
						kind: "tool-call",
						timestamp,
						summary: `${call.name}()`,
						toolName: call.name,
						parts: [createPart(stableId("part", [itemId, "arguments"]), "detail", argsText, "arguments")],
					});
					continue;
				}

				if ((content as UnknownAssistantPart).type === "artifact") {
					const artifactPart = content as UnknownAssistantPart;
					const artifactId = getArtifactId(artifactPart, stableId("artifact-ref", [timestamp, messageIndex, contentIndex]));
					const itemId = stableId("artifact", [timestamp, messageIndex, contentIndex, artifactId]);
					items.push({
						id: itemId,
						kind: "artifact",
						timestamp,
						summary: `Artifact: ${artifactId}`,
						artifactId,
						parts: [createPart(stableId("part", [itemId, "artifact"]), "artifact-link", JSON.stringify(artifactPart))],
					});
					continue;
				}

				if ((content as UnknownAssistantPart).type === "status") {
					const statusPart = content as UnknownAssistantPart;
					const status = getStatusValue(statusPart) ?? "running";
					const statusValue = ["idle", "running", "busy", "done", "failed"].includes(status)
						? (status as "idle" | "running" | "busy" | "done" | "failed")
						: "running";
					const itemId = stableId("runtime-status", [timestamp, messageIndex, contentIndex, status, JSON.stringify(statusPart)]);
					items.push({
						id: itemId,
						kind: "runtime-status",
						timestamp,
						summary: `Status: ${status}`,
						status: statusValue,
						parts: [createPart(stableId("part", [itemId, "status"]), "status", JSON.stringify(statusPart))],
					});
					continue;
				}
			}
			continue;
		}

		if (message.role === "toolResult") {
			const text = readTextBlocks(message.content);
			const toolName = toolCallNames.get(message.toolCallId) ?? message.toolName;
			const itemId = stableId("tool-result", [timestamp, messageIndex, message.toolCallId, toolName, text]);
			items.push({
				id: itemId,
				kind: "tool-result",
				timestamp,
				summary: summarizeText(text, `${toolName} result`),
				toolName,
				parts: [createPart(stableId("part", [itemId, "output"]), "detail", text || "(empty result)", "tool output")],
			});
			continue;
		}

		unknownMessages.push(message);
	}

	if (telemetry?.orc?.length) {
		items.push(...normalizeOrcTelemetryToTranscriptItems(telemetry.orc));
	}
	if (telemetry?.rpc?.length) {
		items.push(...normalizeRpcTelemetryToTranscriptItems(telemetry.rpc));
	}

	items.sort(compareByTimestampThenId);
	return { items, unknownMessages };
}
