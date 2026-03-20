import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { AppConfig } from "../src/app-config.js";
import { VibeAgentApp } from "../src/app.js";
import type { AgentSessionEvent } from "../src/local-coding-agent.js";
import { VirtualTerminal } from "./helpers/virtual-terminal.js";

const PROMPT = "Think carefully about 41 * 17. Reply with only the number.";

async function flush(terminal: VirtualTerminal): Promise<string[]> {
	await new Promise<void>((resolve) => setImmediate(resolve));
	await new Promise<void>((resolve) => setImmediate(resolve));
	return await terminal.flushAndGetViewport();
}

async function sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
	check: () => boolean | Promise<boolean>,
	timeoutMs: number,
	description: string,
): Promise<void> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (await check()) {
			return;
		}
		await sleep(100);
	}
	throw new Error(`Timed out waiting for ${description} after ${timeoutMs}ms`);
}

function createIsolatedRuntimeConfig(): string {
	const tempDir = mkdtempSync(path.join(os.tmpdir(), "vibeagent-real-thinking-"));
	const configPath = path.join(tempDir, "vibe-agent-config.json");
	const runtimeConfig = AppConfig.load();
	AppConfig.save(
		{
			...runtimeConfig,
			showThinking: true,
		},
		configPath,
	);
	return configPath;
}

function getThinkingDiagnostics(message: AssistantMessage | undefined) {
	const thinkingBlock = message?.content.find((content) => content.type === "thinking");
	const text = thinkingBlock?.type === "thinking" ? thinkingBlock.thinking : "";
	let thinkingSignature:
		| { type?: string; encrypted_content?: string; summary?: Array<{ text?: string }> }
		| undefined;
	if (thinkingBlock?.type === "thinking" && typeof thinkingBlock.thinkingSignature === "string" && thinkingBlock.thinkingSignature.trim().length > 0) {
		try {
			thinkingSignature = JSON.parse(thinkingBlock.thinkingSignature) as {
				type?: string;
				encrypted_content?: string;
				summary?: Array<{ text?: string }>;
			};
		} catch {
			thinkingSignature = undefined;
		}
	}
	return {
		provider: message?.provider,
		modelId: message?.model,
		api: message?.api,
		thinkingTextLength: text.length,
		thinkingText: text,
		signatureType: thinkingSignature?.type,
		encryptedReasoningPresent: typeof thinkingSignature?.encrypted_content === "string" && thinkingSignature.encrypted_content.length > 0,
		summaryParts: Array.isArray(thinkingSignature?.summary) ? thinkingSignature.summary.length : 0,
		summaryText: Array.isArray(thinkingSignature?.summary)
			? thinkingSignature.summary.map((part) => part.text ?? "").join("\n\n")
			: "",
	};
}

function summarizeTray(lines: string[]): string {
	const joined = lines.join("\n");
	const thinkingIndex = joined.indexOf("Thinking");
	if (thinkingIndex < 0) {
		return joined;
	}
	return joined.slice(Math.max(0, thinkingIndex - 120), Math.min(joined.length, thinkingIndex + 480));
}

async function main(): Promise<void> {
	const configPath = createIsolatedRuntimeConfig();
	const terminal = new VirtualTerminal(120, 42);
	const app = new VibeAgentApp({ terminal, configPath });
	const eventTypes: string[] = [];
	let sawThinkingStart = false;
	let sawThinkingEnd = false;
	let sawAssistantTurnEnd = false;
	let lastAssistantMessage: AssistantMessage | undefined;

	app.start();
	try {
		await waitFor(() => {
			const state = app.stateStore.getState();
			if (state.statusMessage.startsWith("Startup failed:")) {
				throw new Error(state.statusMessage);
			}
			try {
				return !!app.host.getState().sessionId;
			} catch {
				return false;
			}
		}, 90_000, "real host startup");

		await flush(terminal);
		await app.host.newSession();
		await app.host.setThinkingLevel("high");

		const unsubscribe = app.host.subscribe((event: AgentSessionEvent) => {
			const assistantType = "assistantMessageEvent" in event ? event.assistantMessageEvent.type : undefined;
			eventTypes.push(assistantType ? `${event.type}:${assistantType}` : event.type);
			if ("message" in event && event.message?.role === "assistant") {
				lastAssistantMessage = event.message as AssistantMessage;
			}
			if (event.type === "message_update" && assistantType === "thinking_start") {
				sawThinkingStart = true;
			}
			if (event.type === "message_update" && assistantType === "thinking_end") {
				sawThinkingEnd = true;
			}
			if (event.type === "message_end" && "message" in event && event.message?.role === "assistant") {
				sawAssistantTurnEnd = true;
			}
		});

		try {
			await app.host.prompt(PROMPT);
			await waitFor(() => {
				try {
					return sawAssistantTurnEnd && !app.host.getState().isStreaming;
				} catch {
					return false;
				}
			}, 120_000, "real assistant turn completion");
		} finally {
			unsubscribe();
		}

		const lines = await flush(terminal);
		const activeThinking = app.stateStore.getState().activeThinking;
		const diagnostics = {
			hostModel: app.host.getState().model ? `${app.host.getState().model?.provider}/${app.host.getState().model?.id}` : undefined,
			thinkingLevel: app.host.getState().thinkingLevel,
			sawThinkingStart,
			sawThinkingEnd,
			activeThinking,
			assistant: getThinkingDiagnostics(lastAssistantMessage),
			recentEvents: eventTypes.slice(-12),
			trayExcerpt: summarizeTray(lines),
		};

		console.log(JSON.stringify(diagnostics, null, 2));

		assert.ok(sawThinkingStart, "Real host never emitted thinking_start for the live assistant turn.");
		assert.ok(sawThinkingEnd, "Real host never emitted thinking_end for the live assistant turn.");
		assert.ok(
			activeThinking.text.trim().length > 0,
			`Real host completed a live thinking turn, but the app still has no displayable thinking text.\n${JSON.stringify(diagnostics, null, 2)}`,
		);

		console.log("\nPASS real thinking integration");
	} finally {
		app.stop();
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

await main().catch((error) => {
	console.error("FAIL real thinking integration");
	console.error(error);
	process.exitCode = 1;
});
