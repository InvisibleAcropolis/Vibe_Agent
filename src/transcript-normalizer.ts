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
	let itemCounter = 0;
	let partCounter = 0;

	const nextId = (prefix: string): string => `${prefix}-${itemCounter++}`;
	const nextPartId = (prefix: string): string => `${prefix}-part-${partCounter++}`;

	for (const message of messages) {
		const timestamp = toIsoTimestamp((message as { timestamp?: number | string }).timestamp);

		if (message.role === "user") {
			const text = readTextBlocks(message.content);
			items.push({
				id: nextId("user"),
				kind: "user",
				timestamp,
				summary: summarizeText(text, "User message"),
				parts: [createPart(nextPartId("user-text"), "text", text || "(empty)")],
			});
			continue;
		}

		if (message.role === "assistant") {
			for (const content of message.content as Array<AssistantMessage["content"][number] | UnknownAssistantPart>) {
				if (content.type === "text") {
					const text = content.text.trim();
					if (!text) continue;
					items.push({
						id: nextId("assistant-text"),
						kind: "assistant-text",
						timestamp,
						summary: summarizeText(text, "Assistant text"),
						parts: [createPart(nextPartId("assistant-text"), "text", text)],
					});
					continue;
				}

				if (content.type === "thinking") {
					const text = content.thinking.trim();
					if (!text) continue;
					items.push({
						id: nextId("assistant-thinking"),
						kind: "assistant-thinking",
						timestamp,
						summary: summarizeText(text, "Assistant thinking"),
						parts: [createPart(nextPartId("assistant-thinking"), "thinking", text)],
					});
					continue;
				}

				if (content.type === "toolCall") {
					const call = content as ToolCallContent;
					toolCallNames.set(call.id, call.name);
					const argsText = JSON.stringify(call.arguments ?? {}, null, 2);
					items.push({
						id: nextId("tool-call"),
						kind: "tool-call",
						timestamp,
							summary: `${call.name}()`,
						toolName: call.name,
						parts: [createPart(nextPartId("tool-call"), "detail", argsText, "arguments")],
					});
					continue;
				}

				if ((content as UnknownAssistantPart).type === "artifact") {
					const artifactPart = content as UnknownAssistantPart;
					const artifactId = getArtifactId(artifactPart, nextId("artifact-ref"));
					items.push({
						id: nextId("artifact"),
						kind: "artifact",
						timestamp,
						summary: `Artifact: ${artifactId}`,
						artifactId,
						parts: [createPart(nextPartId("artifact"), "artifact-link", JSON.stringify(artifactPart))],
					});
					continue;
				}

				if ((content as UnknownAssistantPart).type === "status") {
					const statusPart = content as UnknownAssistantPart;
					const status = getStatusValue(statusPart) ?? "running";
					const statusValue = ["idle", "running", "busy", "done", "failed"].includes(status)
						? (status as "idle" | "running" | "busy" | "done" | "failed")
						: "running";
					items.push({
						id: nextId("runtime-status"),
						kind: "runtime-status",
						timestamp,
						summary: `Status: ${status}`,
						status: statusValue,
						parts: [createPart(nextPartId("status"), "status", JSON.stringify(statusPart))],
					});
					continue;
				}
			}
			continue;
		}

		if (message.role === "toolResult") {
			const text = readTextBlocks(message.content);
			const toolName = toolCallNames.get(message.toolCallId) ?? message.toolName;
			items.push({
				id: nextId("tool-result"),
				kind: "tool-result",
				timestamp,
				summary: summarizeText(text, `${toolName} result`),
				toolName,
				parts: [createPart(nextPartId("tool-result"), "detail", text || "(empty result)")],
			});
			continue;
		}

		unknownMessages.push(message);
	}

	return { items, unknownMessages };
}
