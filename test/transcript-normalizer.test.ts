import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { normalizeTranscript } from "../src/transcript-normalizer.js";

function loadFixtureMessages(name: string): AgentMessage[] {
	const filePath = path.join(process.cwd(), "coding-agent", "test", "fixtures", name);
	const lines = readFileSync(filePath, "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	const messages: AgentMessage[] = [];
	for (const line of lines) {
		const entry = JSON.parse(line) as { type?: string; message?: AgentMessage };
		if (entry.type === "message" && entry.message) {
			messages.push(entry.message);
		}
	}
	return messages;
}

test("normalizeTranscript splits assistant output into typed timeline items", () => {
	const messages: AgentMessage[] = [
		{ role: "user", content: "build it", timestamp: Date.parse("2026-03-30T01:00:00.000Z") },
		{
			role: "assistant",
			api: "openai-responses",
			provider: "openai",
			model: "gpt-5.1",
			stopReason: "toolUse",
			timestamp: Date.parse("2026-03-30T01:00:02.000Z"),
			content: [
				{ type: "thinking", thinking: "I should inspect files." },
				{ type: "text", text: "I will read the docs." },
				{ type: "status", status: "running", detail: "Scanning workspace" } as any,
				{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "README.md" } },
				{ type: "artifact", artifactId: "artifact-1", path: "README.md" } as any,
			],
		} as AgentMessage,
		{
			role: "toolResult",
			toolCallId: "tool-1",
			toolName: "read",
			isError: false,
			timestamp: Date.parse("2026-03-30T01:00:03.000Z"),
			content: [{ type: "text", text: "# Docs" }],
		} as AgentMessage,
	];

	const normalized = normalizeTranscript(messages);
	assert.equal(normalized.unknownMessages.length, 0);

	const kinds = normalized.items.map((item) => item.kind);
	assert.deepEqual(kinds, ["user", "assistant-thinking", "assistant-text", "runtime-status", "tool-call", "artifact", "tool-result"]);

	const statusItem = normalized.items.find((item) => item.kind === "runtime-status");
	assert.ok(statusItem && statusItem.summary.includes("Status"));

	const artifactItem = normalized.items.find((item) => item.kind === "artifact");
	assert.equal((artifactItem as { artifactId?: string } | undefined)?.artifactId, "artifact-1");
});

test("normalizeTranscript is deterministic for captured real sessions", () => {
	const fixtures = ["large-session.jsonl", "before-compaction.jsonl"];

	for (const fixtureName of fixtures) {
		const messages = loadFixtureMessages(fixtureName);
		const first = normalizeTranscript(messages);
		const second = normalizeTranscript(messages);
		assert.deepEqual(first.items, second.items, `${fixtureName} normalization should be stable across runs`);
		assert.deepEqual(
			first.unknownMessages.map((message) => message.role),
			second.unknownMessages.map((message) => message.role),
			`${fixtureName} unknown-role set should be stable`,
		);
		assert.ok(
			first.unknownMessages.every((message) => message.role === "bashExecution"),
			`${fixtureName} should only leave non-transcript bash execution messages as unknown`,
		);

		const kinds = new Set(first.items.map((item) => item.kind));
		assert.ok(kinds.has("user"), `${fixtureName} should include user timeline items`);
		assert.ok(kinds.has("assistant-text"), `${fixtureName} should include assistant text timeline items`);
		assert.ok(kinds.has("tool-call"), `${fixtureName} should include tool call timeline items`);
		assert.ok(kinds.has("tool-result"), `${fixtureName} should include tool result timeline items`);
	}
});
