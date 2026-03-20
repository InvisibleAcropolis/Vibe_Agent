import assert from "node:assert";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import { getOAuthProviders } from "@mariozechner/pi-ai/oauth";
import { Text } from "@mariozechner/pi-tui";
import type { AgentHost, AgentHostState, HostCommand } from "../src/agent-host.js";
import { createAppDebugger } from "../src/app-debugger.js";
import { AppConfig } from "../src/app-config.js";
import { VibeAgentApp } from "../src/app.js";
import { CustomEditor, ModelRegistry, type AgentSessionEvent, type ExtensionUIContext, type SessionInfo, type SessionStats } from "../src/local-coding-agent.js";
import type { VibeAgentAppOptions } from "../src/types.js";
import { VirtualTerminal } from "./helpers/virtual-terminal.js";

async function flush(terminal: VirtualTerminal): Promise<string[]> {
	await new Promise<void>((resolve) => setImmediate(resolve));
	await new Promise<void>((resolve) => setImmediate(resolve));
	return await terminal.flushAndGetViewport();
}

function collectFiles(root: string): string[] {
	const entries = readdirSync(root, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const fullPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectFiles(fullPath));
			continue;
		}
		files.push(fullPath);
	}
	return files;
}

const testModel = {
	provider: "test",
	id: "demo-model",
	name: "Demo Model",
	contextWindow: 200000,
	reasoning: true,
} as Model<any>;

class FakeHost implements AgentHost {
	uiContext?: ExtensionUIContext;
	messages: AgentMessage[] = [];
	commands: HostCommand[] = [
		{ name: "settings", description: "Settings", source: "builtin" },
		{ name: "stats", description: "Session stats", source: "builtin" },
		{ name: "artifacts", description: "View artifacts", source: "builtin" },
		{ name: "help", description: "Show help", source: "builtin" },
		{ name: "clear", description: "Clear chat", source: "builtin" },
		{ name: "skill:plan", description: "Plan skill", source: "skill" },
	];
	state: AgentHostState = {
		model: testModel,
		thinkingLevel: "medium",
		isStreaming: false,
		isCompacting: false,
		steeringMode: "all",
		followUpMode: "all",
		sessionId: "session-1",
		sessionName: "demo-session",
		autoCompactionEnabled: true,
		pendingMessageCount: 0,
		messageCount: 0,
	};
	modelFallbackMessage?: string;
	private listeners = new Set<(event: AgentSessionEvent) => void>();

	constructor(options: { fallbackMessage?: string } = {}) {
		this.modelFallbackMessage = options.fallbackMessage;
	}

	async start(uiContext: ExtensionUIContext) {
		this.uiContext = uiContext;
		return {
			messages: this.messages,
			state: this.state,
			modelFallbackMessage: this.modelFallbackMessage,
			availableProviderCount: 1,
		};
	}

	async stop(): Promise<void> {}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	getMessages(): AgentMessage[] {
		return this.messages;
	}

	getState(): AgentHostState {
		return this.state;
	}

	async prompt(text: string): Promise<void> {
		this.messages.push({
			role: "user",
			content: [{ type: "text", text }],
		} as unknown as AgentMessage);
		this.emit({ type: "message_end" } as unknown as AgentSessionEvent);

		this.state.isStreaming = true;
		this.messages.push({
			role: "assistant",
			content: [{ type: "text", text: `Echo: ${text}` }],
			stopReason: "end_turn",
			usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			provider: "test",
			model: "demo-model",
			api: "test",
			timestamp: Date.now(),
		} as unknown as AgentMessage);
		this.emit({ type: "message_update" } as unknown as AgentSessionEvent);
		this.state.isStreaming = false;
		this.emit({ type: "message_end" } as unknown as AgentSessionEvent);
	}

	async abort(): Promise<void> {
		this.state.isStreaming = false;
	}

	async cycleThinkingLevel(): Promise<void> {
		this.state.thinkingLevel = this.state.thinkingLevel === "medium" ? "high" : "medium";
		this.emit({ type: "message_end" } as unknown as AgentSessionEvent);
	}

	async setThinkingLevel(level: AgentHostState["thinkingLevel"]): Promise<void> {
		this.state.thinkingLevel = level;
		this.emit({ type: "message_end" } as unknown as AgentSessionEvent);
	}

	getAvailableThinkingLevels() {
		return ["off", "minimal", "low", "medium", "high"] as ThinkingLevel[];
	}

	async cycleModel(): Promise<void> {}

	async getAvailableModels(): Promise<Model<any>[]> {
		return [testModel];
	}

	async setModel(provider: string, modelId: string): Promise<void> {
		this.state.model = { ...testModel, provider, id: modelId };
		this.emit({ type: "message_end" } as unknown as AgentSessionEvent);
	}

	async getCommands(): Promise<HostCommand[]> {
		return this.commands;
	}

	async newSession(): Promise<void> {
		this.messages = [];
		this.emit({ type: "message_end" } as unknown as AgentSessionEvent);
	}

	async compact(): Promise<void> {}

	getSessionStats(): SessionStats {
		return {
			sessionFile: undefined,
			sessionId: this.state.sessionId,
			userMessages: 2,
			assistantMessages: 2,
			toolCalls: 1,
			toolResults: 1,
			totalMessages: this.messages.length,
			tokens: { input: 1500, output: 800, cacheRead: 200, cacheWrite: 100, total: 2600 },
			cost: 0.0042,
		};
	}

	async exportHtml(): Promise<string> {
		return "export.html";
	}

	async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
		return [{ entryId: "fork-1", text: "Fork this message" }];
	}

	async fork(): Promise<{ text: string; cancelled: boolean }> {
		return { text: "Forked text", cancelled: false };
	}

	async getTreeTargets(): Promise<Array<{ entryId: string; text: string }>> {
		return [{ entryId: "tree-1", text: "Tree target" }];
	}

	async navigateTree(): Promise<{ editorText?: string; cancelled: boolean }> {
		return { editorText: "Tree result", cancelled: false };
	}

	async listSessions(): Promise<SessionInfo[]> {
		return [];
	}

	async switchSession(): Promise<void> {}

	async setSessionName(name: string): Promise<void> {
		this.state.sessionName = name;
		this.emit({ type: "message_end" } as unknown as AgentSessionEvent);
	}

	pushToolSequence(): void {
		this.messages.push({
			role: "assistant",
			content: [
				{ type: "text", text: "Running a tool" },
				{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "README.md" } },
			],
			stopReason: "toolUse",
			usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			provider: "test",
			model: "demo-model",
			api: "test",
			timestamp: Date.now(),
		} as unknown as AgentMessage);
		this.messages.push({
			role: "toolResult",
			toolCallId: "tool-1",
			toolName: "read",
			content: [{ type: "text", text: "File contents here" }],
			isError: false,
			timestamp: Date.now(),
		} as unknown as AgentMessage);
		this.emit({ type: "message_end" } as unknown as AgentSessionEvent);
	}

	pushWriteArtifact(): void {
		this.messages.push({
			role: "assistant",
			content: [
				{ type: "text", text: "Creating a file" },
				{ type: "toolCall", id: "tool-2", name: "write", arguments: { file_path: "/tmp/test.ts", content: "export const x = 1;" } },
			],
			stopReason: "toolUse",
			usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			provider: "test",
			model: "demo-model",
			api: "test",
			timestamp: Date.now(),
		} as unknown as AgentMessage);
		this.messages.push({
			role: "toolResult",
			toolCallId: "tool-2",
			toolName: "write",
			content: [{ type: "text", text: "File written" }],
			isError: false,
			timestamp: Date.now(),
		} as unknown as AgentMessage);
		this.emit({ type: "message_end" } as unknown as AgentSessionEvent);
	}

	private emit(event: AgentSessionEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}

class FailingHost extends FakeHost {
	override async start(uiContext: ExtensionUIContext): ReturnType<FakeHost["start"]> {
		this.uiContext = uiContext;
		throw new Error("Host start failed");
	}
}

type TestCase = {
	name: string;
	run: () => Promise<void>;
};

function createAuthStorageStub(initialProviders: string[] = []) {
	const providers = new Set(initialProviders);
	let fallbackResolver: ((providerId: string) => string | undefined) | undefined;
	return {
		get: (providerId: string) => (providers.has(providerId) ? { type: "oauth", providerId } : undefined),
		list: () => [...providers].map((providerId) => ({ providerId, type: "oauth" })),
		hasAuth: (providerId: string) => providers.has(providerId) || !!fallbackResolver?.(providerId),
		getApiKey: async (_providerId: string) => undefined,
		getOAuthProviders: () => getOAuthProviders(),
		setFallbackResolver: (resolver: (providerId: string) => string | undefined) => {
			fallbackResolver = resolver;
		},
		login: async (providerId: string) => {
			providers.add(providerId);
		},
		logout: (providerId: string) => {
			providers.delete(providerId);
		},
	} as any;
}

function createReadyAppOptions(): VibeAgentAppOptions {
	const registryAuthStorage = createAuthStorageStub();
	registryAuthStorage.hasAuth = () => true;
	const registry = new ModelRegistry(registryAuthStorage);
	const preferredModel = registry.getAvailable().find((model) => model.provider === "google-antigravity")
		?? registry.getAvailable().find((model) => model.provider === "openai-codex")
		?? registry.getAvailable()[0];
	assert.ok(preferredModel, "Expected at least one model from ModelRegistry");

	const tmpDir = mkdtempSync(path.join(os.tmpdir(), "futureide-ready-"));
	const configPath = path.join(tmpDir, "future-ide-agent-config.json");
	AppConfig.save(
		{
			setupComplete: true,
			selectedProvider: preferredModel.provider,
			selectedModelId: preferredModel.id,
		},
		configPath,
	);

	return {
		configPath,
		authStorage: createAuthStorageStub([preferredModel.provider]),
	};
}

async function withApp(
	host: AgentHost,
	run: (app: VibeAgentApp, terminal: VirtualTerminal) => Promise<void>,
	options: Partial<VibeAgentAppOptions> = {},
): Promise<void> {
	const terminal = new VirtualTerminal(110, 32);
	const app = new VibeAgentApp({ terminal, host, ...options });
	app.start();
	try {
		await flush(terminal);
		await run(app, terminal);
	} finally {
		app.stop();
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

const tests: TestCase[] = [
	{
		name: "boots and renders the FutureIDE Agent shell",
		run: async () => {
			const host = new FakeHost({ fallbackMessage: "No models available yet." });
			await withApp(host, async (_app, terminal) => {
				const viewport = await flush(terminal);
				assert.ok(viewport.some((line) => line.includes("FutureIDE Agent")));
				assert.ok(viewport.some((line) => line.includes("demo-session")));
				assert.ok(viewport.some((line) => line.includes("No models available yet.")));
			}, createReadyAppOptions());
		},
	},
	{
		name: "submits a prompt and renders the streamed response",
		run: async () => {
			const host = new FakeHost();
			await withApp(host, async (_app, terminal) => {
				await host.prompt("hello");
				const viewport = await flush(terminal);
				assert.ok(host.messages.some((message) => message.role === "user" && JSON.stringify(message).includes("hello")));
				assert.ok(viewport.some((line) => line.includes("Echo: hello")));
			}, createReadyAppOptions());
		},
	},
	{
		name: "accepts typed input through the terminal editor",
		run: async () => {
			const host = new FakeHost();
			await withApp(host, async (_app, terminal) => {
				terminal.sendInput("typed prompt");
				terminal.sendInput("\r");
				const viewport = await flush(terminal);
				assert.ok(host.messages.some((message) => message.role === "user" && JSON.stringify(message).includes("typed prompt")));
				assert.ok(viewport.some((line) => line.includes("Echo: typed prompt")));
			}, createReadyAppOptions());
		},
	},
	{
		name: "renders tool executions and results",
		run: async () => {
			const host = new FakeHost();
			await withApp(host, async (_app, terminal) => {
				host.pushToolSequence();
				const viewport = await flush(terminal);
				assert.ok(viewport.some((line) => line.includes("read")));
				assert.ok(viewport.some((line) => line.includes("File contents")));
			}, createReadyAppOptions());
		},
	},
	{
		name: "applies extension UI status, widgets, and custom chrome",
		run: async () => {
			const host = new FakeHost();
			await withApp(host, async (_app, terminal) => {
				assert.ok(host.uiContext);
				host.uiContext.setStatus("demo", "READY");
				host.uiContext.setWidget("widget", ["Widget Line"]);
				host.uiContext.setHeader((_tui, _theme) => new Text("Custom Header", 0, 0));
				host.uiContext.setFooter((_tui, _theme, _footerData) => new Text("Custom Footer", 0, 0));
				host.uiContext.setEditorText("prefilled");
				host.uiContext.setEditorComponent((tui, theme, keybindings) => {
					const editor = new CustomEditor(tui, theme, keybindings);
					editor.setText("custom editor");
					return editor;
				});

				const viewport = await flush(terminal);
				assert.ok(viewport.some((line) => line.includes("Custom Header")));
				assert.ok(viewport.some((line) => line.includes("Custom Footer")));
				assert.ok(viewport.some((line) => line.includes("Widget Line")));
				assert.ok(viewport.some((line) => line.includes("READY")));
				assert.equal(host.uiContext.getEditorText(), "prefilled");
				assert.ok(viewport.some((line) => line.includes("prefilled")));
			}, createReadyAppOptions());
		},
	},
	{
		name: "updates control state and mounts custom overlays",
		run: async () => {
			const host = new FakeHost();
			await withApp(host, async (_app, terminal) => {
				assert.ok(host.uiContext);
				await host.setThinkingLevel("high");
				await host.setModel("test", "alt-model");
				await host.setSessionName("renamed-session");

				let finishCustom: ((result: string) => void) | undefined;
				const customPromise = host.uiContext.custom(
					async (_tui, _theme, _keybindings, done) => {
						finishCustom = done;
						return new Text("Custom Overlay", 0, 0);
					},
					{ overlay: true },
				);

				let viewport = await flush(terminal);
				assert.ok(viewport.some((line) => line.includes("thinking:high")));
				assert.ok(viewport.some((line) => line.includes("alt-model")));
				assert.ok(viewport.some((line) => line.includes("renamed-session")));
				assert.ok(viewport.some((line) => line.includes("Custom Overlay")));

				finishCustom?.("done");
				assert.equal(await customPromise, "done");

				viewport = await flush(terminal);
				assert.ok(!viewport.some((line) => line.includes("Custom Overlay")));
			}, createReadyAppOptions());
		},
	},
	{
		name: "surfaces startup failures in the shell",
		run: async () => {
			const host = new FailingHost();
			await withApp(host, async (_app, terminal) => {
				const viewport = await flush(terminal);
				assert.ok(viewport.some((line) => line.includes("Startup failed: Host start failed")));
			}, createReadyAppOptions());
		},
	},
	{
		name: "writes a debug snapshot bundle at the app root",
		run: async () => {
			const host = new FakeHost();
			const terminal = new VirtualTerminal(110, 32);
			const appRoot = mkdtempSync(path.join(os.tmpdir(), "futureide-agent-debug-"));
			const debuggerSink = createAppDebugger({
				appName: "future-ide-agent",
				appRoot,
				bundleDir: path.join(appRoot, ".debug", "test-run"),
			});
			const app = new VibeAgentApp({ terminal, host, debugger: debuggerSink, ...createReadyAppOptions() });
			app.start();
			try {
				await flush(terminal);
				const bundleDir = app.writeDebugSnapshot("test-snapshot");
				assert.ok(bundleDir);
				assert.ok(readdirSync(bundleDir!).some((entry) => entry.endsWith("-test-snapshot.txt")));
				const snapshotFile = readdirSync(bundleDir!).find((entry) => entry.endsWith("-test-snapshot.txt"));
				assert.ok(snapshotFile);
				const snapshotContents = readFileSync(path.join(bundleDir!, snapshotFile!), "utf8");
				assert.ok(snapshotContents.includes("Status: Agent ready."));
			} finally {
				app.stop();
				await new Promise<void>((resolve) => setImmediate(resolve));
			}
		},
	},
	{
		name: "extracts artifacts from write tool calls",
		run: async () => {
			const host = new FakeHost();
			await withApp(host, async (app, terminal) => {
				host.pushWriteArtifact();
				await flush(terminal);
				const state = app.stateStore.getState();
				assert.ok(state.artifacts.length > 0, "Should have at least one artifact");
				const artifact = state.artifacts.find((a) => a.title === "test.ts");
				assert.ok(artifact, "Should find test.ts artifact");
				assert.equal(artifact!.type, "file");
				assert.ok(artifact!.content.includes("export const x = 1;"));
			}, createReadyAppOptions());
		},
	},
	{
		name: "displays keybinding hints in the header",
		run: async () => {
			const host = new FakeHost();
			await withApp(host, async (_app, terminal) => {
				const viewport = await flush(terminal);
				assert.ok(viewport.some((line) => line.includes("F1 palette")));
				assert.ok(viewport.some((line) => line.includes("Ctrl+Q quit")));
			}, createReadyAppOptions());
		},
	},
	{
		name: "AppConfig.load returns defaults when file is missing",
		run: async () => {
			const tmpDir = mkdtempSync(path.join(os.tmpdir(), "futureide-cfg-"));
			const configPath = path.join(tmpDir, "future-ide-agent-config.json");
			const cfg = AppConfig.load(configPath);
			assert.strictEqual(cfg.setupComplete, false);
			assert.strictEqual(cfg.selectedProvider, undefined);
		},
	},
	{
		name: "AppConfig.save and load round-trips correctly",
		run: async () => {
			const tmpDir = mkdtempSync(path.join(os.tmpdir(), "futureide-cfg-"));
			const configPath = path.join(tmpDir, "future-ide-agent-config.json");
			AppConfig.save({ setupComplete: true, selectedProvider: "google-antigravity" }, configPath);
			const loaded = AppConfig.load(configPath);
			assert.strictEqual(loaded.setupComplete, true);
			assert.strictEqual(loaded.selectedProvider, "google-antigravity");
		},
	},
	{
		name: "powerline footer shows provider and model segments",
		run: async () => {
			const host = new FakeHost();
			await withApp(host, async (_app, terminal) => {
				const viewport = await flush(terminal);
				assert.ok(viewport.some((line) => line.includes("providers:")));
				assert.ok(viewport.some((line) => line.includes("test")));
				assert.ok(viewport.some((line) => line.includes("demo-model")));
				assert.ok(viewport.some((line) => line.includes("idle")));
			}, createReadyAppOptions());
		},
	},
	{
		name: "powerline header shows logo mark and connection indicator when provider active",
		run: async () => {
			const host = new FakeHost();
			await withApp(host, async (_app, terminal) => {
				const viewport = await flush(terminal);
				assert.ok(viewport.some((line) => line.includes("⬡")));
				assert.ok(viewport.some((line) => line.includes("FutureIDE Agent")));
				assert.ok(viewport.some((line) => line.includes("CONNECTED")));
			}, createReadyAppOptions());
		},
	},
	{
		name: "paintLineTwoParts fills terminal width with left and right content",
		run: async () => {
			const { paintLineTwoParts } = await import("../src/ansi.js");
			// Plain strings, no ANSI, width=20
			const result = paintLineTwoParts("LEFT", "RIGHT", 20);
			// Should be exactly 20 chars visible
			assert.strictEqual(result.length, 20);
			assert.ok(result.startsWith("LEFT"));
			assert.ok(result.endsWith("RIGHT"));
		},
	},
	{
		name: "WelcomeOAuthSelectorComponent puts preferred providers first with star prefix",
		run: async () => {
			const { WelcomeOAuthSelectorComponent } = await import("../src/welcome-controller.js");
			const selected: string[] = [];
			const comp = new WelcomeOAuthSelectorComponent(
				{ get: () => undefined } as any, // minimal authStorage stub
				(id) => selected.push(id),
				() => {},
			);
			// getLines() returns lines with provider names
			const lines = comp.getLines();
			// Check preferred providers are first
			const antigravityIdx = lines.findIndex((l: string) => l.includes("Antigravity") || l.includes("antigravity"));
			const copilotIdx = lines.findIndex((l: string) => l.includes("Copilot") || l.includes("GitHub") || l.includes("copilot"));
			// Antigravity should be first (index 0 or very early)
			assert.ok(antigravityIdx !== -1 && antigravityIdx < 2, `Antigravity should be first, got index ${antigravityIdx}`);
			// Antigravity should appear before GitHub Copilot
			if (copilotIdx !== -1) {
				assert.ok(antigravityIdx < copilotIdx, "Antigravity should appear before GitHub Copilot");
			}
			// First line should include star prefix for preferred
			const firstPreferredLine = lines[antigravityIdx];
			assert.ok(firstPreferredLine?.includes("★"), `Preferred provider should have ★ prefix, got: ${firstPreferredLine}`);
		},
	},
	{
		name: "first run enters setup with preferred OAuth guidance",
		run: async () => {
			const host = new FakeHost();
			await withApp(host, async (_app, terminal) => {
				const viewport = await flush(terminal);
				assert.ok(
					viewport.some((line) => line.includes("FutureIDE Agent setup") || line.includes("Connect a provider")),
					"Should show setup entry copy",
				);
			});
		},
	},
	{
		name: "/login slash command is recognized and handled",
		run: async () => {
			const { DefaultCommandController } = await import("../src/command-controller.js");
			const host = new FakeHost();
			let openedProviderSetup = false;
			const ctrl = new DefaultCommandController(
				host,
				{} as any, // overlayController
				{ setText: () => {} } as any, // editorController
				{ getState: () => ({ artifacts: [] }), setStatusMessage: () => {}, subscribe: () => () => {} } as any, // stateStore
				{ log: () => {}, logError: () => {} } as any, // debuggerSink
				(() => undefined) as any, // writeDebugSnapshot
				{ getGitBranch: () => undefined, getExtensionStatuses: () => new Map() } as any, // footerData
				(() => {}) as any, // clearMessages
				{ tui: { requestRender: () => {}, setFocus: () => {} }, setEditor: () => {}, setTitle: () => {} } as any,
				{
					openSetupHub: async () => {},
					openProviderSetup: async () => {
						openedProviderSetup = true;
					},
					openModelSetup: async () => {},
					openLogoutFlow: async () => {},
				},
			);
			const result = await ctrl.handleSlashCommand("/login");
			assert.strictEqual(result, true, "/login should be handled");
			assert.strictEqual(openedProviderSetup, true, "/login should route into provider setup");
		},
	},
	{
		name: "app skips onboarding when provider credentials exist",
		run: async () => {
			const host = new FakeHost();
			const terminal = new VirtualTerminal(110, 32);
			const app = new VibeAgentApp({ terminal, host, ...createReadyAppOptions() });
			app.start();
			try {
				const viewport = await flush(terminal);
				assert.ok(viewport.some((line) => line.includes("FutureIDE Agent")));
				assert.ok(viewport.some((line) => line.includes("demo-session")));
				assert.ok(!viewport.some((line) => line.includes("FutureIDE Agent setup")));
			} finally {
				app.stop();
				await new Promise<void>((resolve) => setImmediate(resolve));
			}
		},
	},
	{
		name: "WelcomeController.run resolves on skip (Esc)",
		run: async () => {
			const { WelcomeController } = await import("../src/welcome-controller.js");
			const tmpDir = mkdtempSync(path.join(os.tmpdir(), "futureide-wc-"));
			const configPath = path.join(tmpDir, "cfg.json");
			const cfg = AppConfig.load(configPath);

			const mockAuthStorage = { get: () => undefined, list: () => [], login: async () => {} } as any;
			const mockShellView = { setEditor: () => {}, setTitle: () => {} } as any;
			const mockTui = { requestRender: () => {}, setFocus: () => {} } as any;
			const mockModelRegistry = { getAvailable: () => [], refresh: () => {} } as any;

			const ctrl = new WelcomeController(mockShellView, mockAuthStorage, mockModelRegistry, cfg, configPath, mockTui);

			const runPromise = ctrl.run();
			ctrl.skip();
			const result = await runPromise;
			assert.deepStrictEqual(result, { completed: false, skipped: true });
		},
	},
	{
		name: "saved model recovery banner is shown when configured model is unavailable",
		run: async () => {
			const host = new FakeHost();
			const readyOptions = createReadyAppOptions();
			assert.ok(readyOptions.configPath);
			const saved = AppConfig.load(readyOptions.configPath);
			AppConfig.save(
				{
					...saved,
					selectedModelId: "missing-model",
				},
				readyOptions.configPath,
			);

			await withApp(host, async (_app, terminal) => {
				const viewport = await flush(terminal);
				assert.ok(viewport.some((line) => line.includes("Recover your default model") || line.includes("Choose a default model")));
			}, readyOptions);
		},
	},
	{
		name: "portable app sources do not reference monorepo-only paths or package aliases",
		run: async () => {
			const appRoot = path.resolve(path.join(import.meta.dirname, ".."));
			const candidateFiles = [
				path.join(appRoot, "package.json"),
				path.join(appRoot, "tsconfig.json"),
				...collectFiles(path.join(appRoot, "src")).filter((filePath) => filePath.endsWith(".ts")),
				...collectFiles(path.join(appRoot, "test")).filter((filePath) => filePath.endsWith(".ts")),
			];
			const forbidden = [
				["..", "..", "packages", ""].join("/"),
				["..", "..", "packages", ""].join("\\"),
				["..", "..", "..", "packages", ""].join("/"),
				["..", "..", "..", "packages", ""].join("\\"),
				["..", "..", "scripts", ""].join("/"),
				["..", "..", "scripts", ""].join("\\"),
				["@mariozechner", "pi-coding-agent"].join("/"),
			];

			for (const filePath of candidateFiles) {
				const text = readFileSync(filePath, "utf8");
				for (const snippet of forbidden) {
					assert.ok(!text.includes(snippet), `${path.relative(appRoot, filePath)} contains forbidden snippet: ${snippet}`);
				}
			}
		},
	},
];

// New test: verify app title contains "Vibe Agent"
const vibeAgentTitleTest: TestCase = {
	name: "app title is Vibe Agent",
	run: async () => {
		const terminal = new VirtualTerminal(120, 40);
		const app = new VibeAgentApp({ terminal });
		app.start();
		const lines = await flush(terminal);
		assert.ok(lines.some(l => l.includes("Vibe Agent")), `Expected 'Vibe Agent' in output, got:\n${lines.join("\n")}`);
		app.stop();
		await new Promise<void>((resolve) => setImmediate(resolve));
	},
};
tests.push(vibeAgentTitleTest);

let failures = 0;
for (const test of tests) {
	try {
		await test.run();
		console.log(`PASS ${test.name}`);
	} catch (error) {
		failures++;
		console.error(`FAIL ${test.name}`);
		console.error(error);
	}
}

if (failures > 0) {
	process.exitCode = 1;
} else {
	console.log(`\nPASS ${tests.length} tests`);
}
