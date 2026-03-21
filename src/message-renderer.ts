import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
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

function getTextContent(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((item) => {
			if (typeof item !== "object" || item === null || !("type" in item)) {
				return "";
			}
			if (item.type === "text" && "text" in item && typeof item.text === "string") {
				return item.text;
			}
			if (item.type === "image") {
				return "[image]";
			}
			return "";
		})
		.join("\n")
		.trim();
}

export interface MessageRendererOptions {
	hideThinking: boolean;
	toolOutputExpanded: boolean;
	tui: TUI;
}

export interface MessageRenderResult {
	components: Component[];
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
	const toolExecutions = new Map<string, ToolExecutionComponent>();

	for (const message of messages) {
		if (message.role === "user") {
			components.push(new UserMessageComponent(getTextContent(message.content), getMarkdownTheme()));
			continue;
		}

		if (message.role === "assistant") {
			const assistant = sanitizeAssistantMessage(message as AssistantMessage, options.hideThinking);
			components.push(new AssistantMessageComponent(assistant, options.hideThinking, getMarkdownTheme()));

			for (const content of assistant.content) {
				if (content.type !== "toolCall") {
					continue;
				}
				const toolComponent = new ToolExecutionComponent(content.name, content.arguments, {}, undefined, options.tui);
				toolComponent.setExpanded(options.toolOutputExpanded);
				if (assistant.stopReason) {
					toolComponent.setArgsComplete();
				}
				toolExecutions.set(content.id, toolComponent);
				components.push(toolComponent);
			}
			continue;
		}

		if (message.role === "toolResult") {
			const resultMessage = message as any;
			const existing = toolExecutions.get(resultMessage.toolCallId);
			if (existing) {
				existing.updateResult(
					{
						content: resultMessage.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
						details: resultMessage.details,
						isError: !!resultMessage.isError,
					},
					false,
				);
			}
			continue;
		}

		components.push(new Markdown(JSON.stringify(message, null, 2), 1, 0, getMarkdownTheme()));
	}

	return { components };
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
