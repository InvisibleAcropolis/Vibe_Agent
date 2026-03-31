import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { normalizeTranscript } from "./transcript-normalizer.js";
import { Markdown, TUI, type Component } from "@mariozechner/pi-tui";
import { AssistantMessageComponent, getMarkdownTheme, ToolExecutionComponent, UserMessageComponent } from "./local-coding-agent.js";

type ThinkingSignatureSummary = {
	summary?: Array<{ text?: string }>;
	reasoning?: {
		summary?: Array<{ text?: string }>;
		summary_text?: string;
	};
	summary_text?: string;
	summaryText?: string;
};

export interface MessageRendererOptions {
	hideThinking: boolean;
	toolOutputExpanded: boolean;
	tui: TUI;
}

export interface MessageRenderResult {
	components: Component[];
	normalizedTranscript: ReturnType<typeof normalizeTranscript>;
}

/**
 * Renders agent messages into TUI components.
 * This provides full parity with the WebUI's message display, including:
 * - User messages with markdown
 * - Assistant messages with thinking/reasoning
 * - Tool executions with expandable results
 */
export function renderAgentMessages(messages: AgentMessage[], options: MessageRendererOptions): MessageRenderResult {
	const components: Component[] = [];
	const toolExecutionsByName = new Map<string, ToolExecutionComponent[]>();
	const normalized = normalizeTranscript(messages);

	for (const item of normalized.items) {
		switch (item.kind) {
			case "user": {
				const text = item.parts.find((part) => part.kind === "text")?.text ?? "";
				components.push(new UserMessageComponent(text, getMarkdownTheme()));
				break;
			}
			case "assistant-text":
			case "assistant-thinking": {
				const assistant = sanitizeAssistantMessage(
					{
						role: "assistant",
						api: "openai-responses",
						provider: "openai",
						model: "normalized-transcript",
						stopReason: "stop",
						timestamp: Date.parse(item.timestamp),
						content: item.parts
							.map((part) => {
								if (!part.text) return undefined;
								if (part.kind === "thinking") {
									return { type: "thinking" as const, thinking: part.text };
								}
								return { type: "text" as const, text: part.text };
							})
							.filter((part): part is { type: "thinking"; thinking: string } | { type: "text"; text: string } => !!part),
					} as AssistantMessage,
					options.hideThinking,
				);
				components.push(new AssistantMessageComponent(assistant, options.hideThinking, getMarkdownTheme()));
				break;
			}
			case "tool-call": {
				const detail = item.parts.find((part) => part.kind === "detail")?.text;
				let args: Record<string, unknown> = {};
				if (detail) {
					try {
						args = JSON.parse(detail) as Record<string, unknown>;
					} catch {
						args = { raw: detail };
					}
				}
				const toolComponent = new ToolExecutionComponent(item.toolName, args, {}, undefined, options.tui);
				toolComponent.setExpanded(options.toolOutputExpanded);
				const existing = toolExecutionsByName.get(item.toolName) ?? [];
				existing.push(toolComponent);
				toolExecutionsByName.set(item.toolName, existing);
				components.push(toolComponent);
				break;
			}
			case "tool-result": {
				const detail = item.parts.find((part) => part.kind === "detail")?.text ?? "";
				const queue = toolExecutionsByName.get(item.toolName);
				const toolComponent = queue?.shift();
				if (toolComponent) {
					toolComponent.updateResult({
						content: [{ type: "text", text: detail }],
						isError: false,
					});
				}
				break;
			}
			case "artifact":
			case "runtime-status":
				components.push(new Markdown(item.summary, 1, 0, getMarkdownTheme()));
				break;
			default:
				components.push(new Markdown(item.summary, 1, 0, getMarkdownTheme()));
		}
	}

	for (const message of normalized.unknownMessages) {
		components.push(new Markdown(JSON.stringify(message, null, 2), 1, 0, getMarkdownTheme()));
	}

	return { components, normalizedTranscript: normalized };
}

function sanitizeAssistantMessage(message: AssistantMessage, hideThinking: boolean): AssistantMessage {
	if (!hideThinking || !message.content.some((content) => content.type === "thinking")) {
		return message;
	}
	return {
		...message,
		content: message.content.filter((content) => content.type !== "thinking"),
	};
}

export function extractLatestThinkingText(messages: AgentMessage[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role !== "assistant") {
			continue;
		}
		const thinkingText = extractThinkingTextFromAssistantMessage(message as AssistantMessage);
		if (thinkingText) {
			return thinkingText;
		}
	}
	return undefined;
}

export function extractThinkingTextFromAssistantMessage(message: AssistantMessage | undefined): string | undefined {
	if (!message) {
		return undefined;
	}
	const thinkingBlocks = message.content
		.filter((content): content is Extract<AssistantMessage["content"][number], { type: "thinking" }> => content.type === "thinking")
		.flatMap((content) => {
			const inlineThinking = content.thinking.trim();
			if (inlineThinking.length > 0) {
				return [inlineThinking];
			}
			const summaryThinking = extractThinkingSummaryFromSignature(content.thinkingSignature);
			return summaryThinking ? [summaryThinking] : [];
		})
		.filter(Boolean);
	if (thinkingBlocks.length === 0) {
		return extractFallbackThinkingSummary(message);
	}
	return thinkingBlocks.join("\n\n");
}

function extractThinkingSummaryFromSignature(signature: string | undefined): string | undefined {
	if (!signature || !signature.trim().startsWith("{")) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(signature) as ThinkingSignatureSummary;
		const summaryParts = parsed.summary ?? parsed.reasoning?.summary;
		const summaryText = joinSummaryParts(summaryParts);
		if (summaryText) {
			return summaryText;
		}
		return cleanSummaryText(parsed.summary_text ?? parsed.summaryText ?? parsed.reasoning?.summary_text);
	} catch {
		return undefined;
	}
}

function extractFallbackThinkingSummary(message: AssistantMessage): string | undefined {
	const unknownMessage = message as AssistantMessage & {
		reasoning?: {
			summary?: Array<{ text?: string }>;
			summary_text?: string;
		};
		summaryText?: string;
	};
	const structuredSummary = joinSummaryParts(unknownMessage.reasoning?.summary);
	if (structuredSummary) {
		return structuredSummary;
	}
	return cleanSummaryText(unknownMessage.reasoning?.summary_text ?? unknownMessage.summaryText);
}

function joinSummaryParts(parts: Array<{ text?: string }> | undefined): string | undefined {
	if (!Array.isArray(parts)) {
		return undefined;
	}
	const summary = parts
		.map((part) => cleanSummaryText(part?.text))
		.filter((part): part is string => !!part)
		.join("\n\n")
		.trim();
	return summary || undefined;
}

function cleanSummaryText(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

/** Backwards-compatible wrapper that returns just the components */
export function renderAgentMessageComponents(messages: AgentMessage[], options: MessageRendererOptions): Component[] {
	return renderAgentMessages(messages, options).components;
}
