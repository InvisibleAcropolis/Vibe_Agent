import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { TranscriptItem, TranscriptPart } from "./shell-next/shared-models.js";

export interface NormalizedTranscript {
	items: TranscriptItem[];
	unknownMessages: AgentMessage[];
}

type ToolCallContent = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

type UnknownAssistantPart = {
	type: string;
	[k: string]: unknown;
};

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
	if (typeof timestamp === "string") return timestamp;
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

function createPart(id: string, kind: TranscriptPart["kind"], text: string, title?: string): TranscriptPart {
	return {
		id,
		kind,
		text,
		title,
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

export function normalizeTranscript(messages: AgentMessage[]): NormalizedTranscript {
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

	return { items, unknownMessages };
}
