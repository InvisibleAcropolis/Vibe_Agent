import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@mariozechner/pi-ai";
import { Markdown, TUI, type Component } from "@mariozechner/pi-tui";
import { AssistantMessageComponent, getMarkdownTheme, ToolExecutionComponent, UserMessageComponent } from "./local-coding-agent.js";
import type { Artifact } from "./types.js";

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
	artifacts: Artifact[];
}

/**
 * Renders agent messages into TUI components and extracts artifacts.
 * This provides full parity with the WebUI's message display, including:
 * - User messages with markdown
 * - Assistant messages with thinking/reasoning
 * - Tool executions with expandable results
 * - Artifact extraction for the artifact panel
 */
export function renderAgentMessages(messages: AgentMessage[], options: MessageRendererOptions): MessageRenderResult {
	const components: Component[] = [];
	const artifacts: Artifact[] = [];
	const toolExecutions = new Map<string, ToolExecutionComponent>();
	let artifactCounter = 0;

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

				// Extract artifacts from tool calls
				if (content.name === "write" && content.arguments?.file_path) {
					artifacts.push({
						id: `artifact-${++artifactCounter}`,
						type: "file",
						title: String(content.arguments.file_path).split("/").pop() ?? "file",
						content: String(content.arguments.content ?? ""),
						filePath: String(content.arguments.file_path),
						language: guessLanguage(String(content.arguments.file_path)),
					});
				}
				if (content.name === "edit" && content.arguments?.file_path) {
					artifacts.push({
						id: `artifact-${++artifactCounter}`,
						type: "diff",
						title: `Edit: ${String(content.arguments.file_path).split("/").pop() ?? "file"}`,
						content: formatEditDiff(content.arguments),
						filePath: String(content.arguments.file_path),
					});
				}
			}
			continue;
		}

		if (message.role === "toolResult") {
			const resultMessage = message as ToolResultMessage;
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

			// Extract read results as artifacts
			if ((resultMessage as any).toolName === "read" && !resultMessage.isError) {
				const textContent = extractTextFromContent(resultMessage.content);
				if (textContent) {
					artifacts.push({
						id: `artifact-${++artifactCounter}`,
						type: "file",
						title: `Read: ${(resultMessage as any).toolName ?? "file"}`,
						content: textContent,
					});
				}
			}
			continue;
		}

		components.push(new Markdown(JSON.stringify(message, null, 2), 1, 0, getMarkdownTheme()));
	}

	return { components, artifacts };
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
		.map((content) => content.thinking.trim())
		.filter(Boolean);
	if (thinkingBlocks.length === 0) {
		return undefined;
	}
	return thinkingBlocks.join("\n\n");
}

/** Backwards-compatible wrapper that returns just the components */
export function renderAgentMessageComponents(messages: AgentMessage[], options: MessageRendererOptions): Component[] {
	return renderAgentMessages(messages, options).components;
}

function guessLanguage(filePath: string): string | undefined {
	const ext = filePath.split(".").pop()?.toLowerCase();
	const languageMap: Record<string, string> = {
		ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
		py: "python", rs: "rust", go: "go", java: "java", rb: "ruby",
		c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
		html: "html", css: "css", scss: "scss", json: "json", yaml: "yaml",
		yml: "yaml", md: "markdown", sh: "bash", bash: "bash", zsh: "bash",
		sql: "sql", xml: "xml", toml: "toml", ini: "ini", cfg: "ini",
	};
	return ext ? languageMap[ext] : undefined;
}

function formatEditDiff(args: Record<string, unknown>): string {
	const lines: string[] = [];
	if (args.old_string) {
		for (const line of String(args.old_string).split("\n")) {
			lines.push(`- ${line}`);
		}
	}
	if (args.new_string) {
		for (const line of String(args.new_string).split("\n")) {
			lines.push(`+ ${line}`);
		}
	}
	return lines.join("\n") || "(empty diff)";
}

function extractTextFromContent(content: unknown): string | undefined {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;
	const texts = content
		.filter((item) => typeof item === "object" && item !== null && item.type === "text" && typeof item.text === "string")
		.map((item) => item.text);
	return texts.length > 0 ? texts.join("\n") : undefined;
}
