import path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@mariozechner/pi-ai";
import type { Artifact, ArtifactType } from "../../types.js";
import type { DurableRecordMetadata } from "../record-metadata.js";

export interface ArtifactRecord extends DurableRecordMetadata {
	type: ArtifactType;
	title: string;
	content: string;
	language?: string;
	filePath?: string;
	sourceToolName?: string;
}

export interface ArtifactExtractionContext {
	runtimeId: string;
	sessionId?: string;
	threadId?: string;
	phase?: string;
	waveNumber?: number;
}

type ToolCallSummary = {
	name: string;
	filePath?: string;
};

export function extractArtifactRecords(messages: AgentMessage[], context: ArtifactExtractionContext): ArtifactRecord[] {
	const artifacts: ArtifactRecord[] = [];
	const toolCalls = new Map<string, ToolCallSummary>();
	const timestamp = new Date().toISOString();
	let artifactCounter = 0;
	let markdownCounter = 0;

	for (const message of messages) {
		if (message.role === "assistant") {
			const assistant = message as AssistantMessage;
			for (const content of assistant.content) {
				if (content.type === "toolCall") {
					const filePath =
						typeof content.arguments?.file_path === "string"
							? content.arguments.file_path
							: undefined;
					toolCalls.set(content.id, {
						name: content.name,
						filePath,
					});

					if (content.name === "write" && filePath) {
						artifacts.push(
							createArtifactRecord(++artifactCounter, context, timestamp, {
								type: filePath.endsWith(".md") ? "text" : "file",
								title: path.basename(filePath) || "file",
								content: String(content.arguments?.content ?? ""),
								filePath,
								language: guessLanguage(filePath),
								sourceToolName: content.name,
								tags: filePath.endsWith(".md") ? ["markdown", "plan"] : undefined,
								kind: filePath.endsWith(".md") ? "artifact:markdown-plan" : undefined,
							}),
						);
					}

					if (content.name === "edit" && filePath) {
						artifacts.push(
							createArtifactRecord(++artifactCounter, context, timestamp, {
								type: "diff",
								title: `Edit: ${path.basename(filePath) || "file"}`,
								content: formatEditDiff(content.arguments ?? {}),
								filePath,
								sourceToolName: content.name,
							}),
						);
					}
					continue;
				}

				if (content.type === "text" && typeof content.text === "string" && isMarkdownPlanningArtifact(content.text, context)) {
					markdownCounter += 1;
					artifacts.push(
						createArtifactRecord(++artifactCounter, context, timestamp, {
							type: "text",
							title: inferMarkdownTitle(content.text, markdownCounter),
							content: content.text,
							language: "markdown",
							tags: ["markdown", "plan", "orchestration"],
							kind: "artifact:markdown-plan",
						}),
					);
				}
			}
			continue;
		}

		if (message.role === "toolResult") {
			const resultMessage = message as ToolResultMessage;
			if (resultMessage.isError) {
				continue;
			}

			const toolCall = toolCalls.get(resultMessage.toolCallId);
			if (!toolCall || toolCall.name !== "read") {
				continue;
			}

			const textContent = extractTextFromContent(resultMessage.content);
			if (!textContent) {
				continue;
			}

			artifacts.push(
				createArtifactRecord(++artifactCounter, context, timestamp, {
					type: toolCall.filePath?.endsWith(".md") ? "text" : "file",
					title: toolCall.filePath ? `Read: ${path.basename(toolCall.filePath) || "file"}` : "Read Result",
					content: textContent,
					filePath: toolCall.filePath,
					language: toolCall.filePath ? guessLanguage(toolCall.filePath) : undefined,
					sourceToolName: toolCall.name,
					tags: toolCall.filePath?.endsWith(".md") ? ["markdown"] : undefined,
					kind: toolCall.filePath?.endsWith(".md") ? "artifact:markdown" : undefined,
				}),
			);
		}
	}

	return artifacts;
}

export function toArtifactView(record: ArtifactRecord): Artifact {
	return {
		id: record.id,
		type: record.type,
		title: record.title,
		content: record.content,
		language: record.language,
		filePath: record.filePath,
	};
}

function createArtifactRecord(
	index: number,
	context: ArtifactExtractionContext,
	timestamp: string,
	partial: Pick<ArtifactRecord, "type" | "title" | "content" | "filePath" | "language" | "sourceToolName"> & {
		tags?: string[];
		kind?: string;
	},
): ArtifactRecord {
	return {
		id: `${context.runtimeId}:${context.sessionId ?? "session"}:${context.threadId ?? "thread"}:artifact:${index}`,
		kind: partial.kind ?? `artifact:${partial.type}`,
		ownerRuntimeId: context.runtimeId,
		sessionId: context.sessionId,
		threadId: context.threadId,
		phase: context.phase,
		waveNumber: context.waveNumber,
		sourcePath: partial.filePath,
		createdAt: timestamp,
		updatedAt: timestamp,
		status: "ready",
		tags: [...new Set([partial.type, ...(partial.tags ?? [])])],
		orchestration: {
			runtimeId: context.runtimeId,
			sessionId: context.sessionId,
			threadId: context.threadId,
			phase: context.phase,
			waveNumber: context.waveNumber,
			sourcePath: partial.filePath,
		},
		type: partial.type,
		title: partial.title,
		content: partial.content,
		filePath: partial.filePath,
		language: partial.language,
		sourceToolName: partial.sourceToolName,
	};
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
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return undefined;
	}
	const texts = content
		.filter((item) => typeof item === "object" && item !== null && item.type === "text" && typeof item.text === "string")
		.map((item) => item.text);
	return texts.length > 0 ? texts.join("\n") : undefined;
}

function isMarkdownPlanningArtifact(text: string, context: ArtifactExtractionContext): boolean {
	if (context.phase?.toLowerCase().includes("plan")) {
		return true;
	}
	const trimmed = text.trim();
	if (!trimmed) {
		return false;
	}
	return /(^#)|(^[-*]\s)|(^\d+\.\s)|\bplan\b/i.test(trimmed);
}

function inferMarkdownTitle(text: string, counter: number): string {
	const heading = text.split("\n").map((line) => line.trim()).find((line) => line.startsWith("#"));
	if (heading) {
		return heading.replace(/^#+\s*/, "").trim() || `Plan ${counter}`;
	}
	return `Plan ${counter}`;
}
