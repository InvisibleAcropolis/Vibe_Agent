import assert from "node:assert";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentHost, AgentHostStartResult, AgentHostState, HostCommand } from "../src/agent-host.js";
import { VibeAgentApp } from "../src/app.js";
import { AppSetupService } from "../src/app/app-setup-service.js";
import { ArtifactCatalogService } from "../src/durable/artifacts/artifact-catalog-service.js";
import { LogCatalogService } from "../src/durable/logs/log-catalog-service.js";
import { MemoryStoreService } from "../src/durable/memory/memory-store-service.js";
import { WorkbenchInventoryService } from "../src/durable/workbench-inventory-service.js";
import { ensureVibeDurableStorage, getVibeConfigPath } from "../src/durable/durable-paths.js";
import { getRuntimeSessionDir } from "../src/runtime/runtime-session-namespace.js";
import type { AgentRuntime, RuntimeDescriptor } from "../src/runtime/agent-runtime.js";
import { CompatAgentRuntime } from "../src/runtime/compat-agent-runtime.js";
import { RuntimeCoordinator } from "../src/runtime/runtime-coordinator.js";
import { VirtualTerminal } from "./helpers/virtual-terminal.js";

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "vibe-agent-test-"));
process.on("exit", () => {
	rmSync(tempRoot, { recursive: true, force: true });
});

function createHostState(overrides: Partial<AgentHostState> = {}): AgentHostState {
	return {
		thinkingLevel: "medium",
		isStreaming: false,
		isCompacting: false,
		steeringMode: "all",
		followUpMode: "all",
		sessionId: "session-1",
		sessionName: "Session 1",
		autoCompactionEnabled: true,
		pendingMessageCount: 0,
		messageCount: 0,
		...overrides,
	};
}

class FakeAgentHost implements AgentHost {
	private readonly messages: AgentMessage[];
	private readonly state: AgentHostState;
	startCount = 0;
	stopCount = 0;

	constructor(messages: AgentMessage[] = []) {
		this.messages = messages;
		this.state = createHostState({ messageCount: messages.length });
	}

	async start(): Promise<AgentHostStartResult> {
		this.startCount++;
		return {
			messages: this.messages,
			state: this.state,
			availableProviderCount: 1,
		};
	}

	async stop(): Promise<void> {
		this.stopCount++;
	}

	subscribe(): () => void {
		return () => undefined;
	}

	getMessages(): AgentMessage[] {
		return this.messages;
	}

	getState(): AgentHostState {
		return this.state;
	}

	async prompt(): Promise<void> {}

	async abort(): Promise<void> {}

	async cycleThinkingLevel(): Promise<void> {}

	async setThinkingLevel(): Promise<void> {}

	getAvailableThinkingLevels() {
		return ["off", "medium"] as ThinkingLevel[];
	}

	async cycleModel(): Promise<void> {}

	async getAvailableModels() {
		return [];
	}

	async setModel(): Promise<void> {}

	listRuntimes(): RuntimeDescriptor[] {
		return [{ id: "coding", kind: "coding", displayName: "Coding Runtime", capabilities: [], primary: true }];
	}

	getActiveRuntimeDescriptor(): RuntimeDescriptor {
		return this.listRuntimes()[0]!;
	}

	async switchRuntime(): Promise<void> {}

	async getCommands(): Promise<HostCommand[]> {
		return [];
	}

	async newSession(): Promise<void> {}

	async compact(): Promise<void> {}

	getSessionStats() {
		return {} as any;
	}

	async exportHtml(outputPath?: string): Promise<string> {
		return outputPath ?? "export.html";
	}

	async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
		return [];
	}

	async fork(): Promise<{ text: string; cancelled: boolean }> {
		return { text: "", cancelled: true };
	}

	async getTreeTargets(): Promise<Array<{ entryId: string; text: string }>> {
		return [];
	}

	async navigateTree(): Promise<{ editorText?: string; cancelled: boolean }> {
		return { cancelled: true };
	}

	async listSessions(): Promise<any[]> {
		return [];
	}

	async switchSession(): Promise<void> {}

	async setSessionName(): Promise<void> {}
}

class StubRuntime implements AgentRuntime {
	started = false;
	stopped = false;
	private readonly messages: AgentMessage[] = [];

	constructor(readonly descriptor: RuntimeDescriptor) {}

	async start(): Promise<AgentHostStartResult> {
		this.started = true;
		return {
			messages: this.messages,
			state: createHostState(),
			availableProviderCount: 0,
		};
	}

	async stop(): Promise<void> {
		this.stopped = true;
	}

	subscribe(): () => void {
		return () => undefined;
	}

	getMessages(): AgentMessage[] {
		return this.messages;
	}

	getState(): AgentHostState {
		return createHostState();
	}

	async prompt(): Promise<void> {
		throw new Error("Not supported");
	}

	async abort(): Promise<void> {}

	async cycleThinkingLevel(): Promise<void> {}

	async setThinkingLevel(): Promise<void> {}

	getAvailableThinkingLevels() {
		return ["off"] as ThinkingLevel[];
	}

	async cycleModel(): Promise<void> {}

	async getAvailableModels() {
		return [];
	}

	async setModel(): Promise<void> {}

	listRuntimes(): RuntimeDescriptor[] {
		return [{ id: "coding", kind: "coding", displayName: "Coding Runtime", capabilities: [], primary: true }];
	}

	getActiveRuntimeDescriptor(): RuntimeDescriptor {
		return this.listRuntimes()[0]!;
	}

	async switchRuntime(): Promise<void> {}

	async getCommands(): Promise<HostCommand[]> {
		return [];
	}

	async newSession(): Promise<void> {}

	async compact(): Promise<void> {}

	getSessionStats() {
		return {} as any;
	}

	async exportHtml(outputPath?: string): Promise<string> {
		return outputPath ?? "";
	}

	async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
		return [];
	}

	async fork(): Promise<{ text: string; cancelled: boolean }> {
		return { text: "", cancelled: true };
	}

	async getTreeTargets(): Promise<Array<{ entryId: string; text: string }>> {
		return [];
	}

	async navigateTree(): Promise<{ editorText?: string; cancelled: boolean }> {
		return { cancelled: true };
	}

	async listSessions(): Promise<any[]> {
		return [];
	}

	async switchSession(): Promise<void> {}

	async setSessionName(): Promise<void> {}
}

async function flushAsyncWork(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
	await new Promise<void>((resolve) => setImmediate(resolve));
}

test("AppSetupService handles startup gate and saved defaults", () => {
	const setup = new AppSetupService(
		{ list: () => [] },
		{
			getAvailable: () => [
				{ provider: "openai", id: "gpt-test" },
				{ provider: "anthropic", id: "claude-test" },
			],
		} as any,
		() => undefined,
	);

	assert.deepStrictEqual(
		setup.assessStartupGate({ setupComplete: false }),
		{ kind: "needs-provider", reason: "first-run" },
	);
	assert.deepStrictEqual(
		setup.validateSavedDefault({ setupComplete: true, selectedProvider: "openai", selectedModelId: "gpt-test" }),
		{ kind: "valid", providerId: "openai", modelId: "gpt-test" },
	);
	assert.deepStrictEqual(
		setup.validateSavedDefault({ setupComplete: true, selectedProvider: "missing", selectedModelId: "gpt-test" }),
		{ kind: "invalid-provider", reason: "saved-provider-unavailable" },
	);
});

test("RuntimeCoordinator starts active and background runtimes", async () => {
	const codingHost = new FakeAgentHost();
	const codingRuntime = new CompatAgentRuntime(
		{
			id: "coding",
			kind: "coding",
			displayName: "Coding Runtime",
			capabilities: ["interactive-prompt"],
			primary: true,
		},
		codingHost,
	);
	const workerRuntime = new StubRuntime({
		id: "worker",
		kind: "worker",
		displayName: "Worker Runtime",
		capabilities: ["background-processing", "memory-store"],
	});
	const toolRuntime = new StubRuntime({
		id: "tool",
		kind: "tool",
		displayName: "Tool Runtime",
		capabilities: ["artifact-source", "log-source"],
	});

	const coordinator = new RuntimeCoordinator([codingRuntime, workerRuntime, toolRuntime]);
	await coordinator.start({} as any);

	assert.strictEqual(codingHost.startCount, 1);
	assert.strictEqual(workerRuntime.started, true);
	assert.strictEqual(toolRuntime.started, true);

	await coordinator.stop();
	assert.strictEqual(codingHost.stopCount, 1);
	assert.strictEqual(workerRuntime.stopped, true);
	assert.strictEqual(toolRuntime.stopped, true);
});

test("Durable services catalog artifacts, memory stores, and logs", () => {
	const artifactCatalog = new ArtifactCatalogService();
	const memoryStores = new MemoryStoreService();
	const logs = new LogCatalogService();
	const inventory = new WorkbenchInventoryService(artifactCatalog, memoryStores, logs);

	artifactCatalog.replaceFromMessages(
		{ runtimeId: "coding", sessionId: "session-1" },
		[
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call-1",
						name: "write",
						arguments: { file_path: "src/test.ts", content: "export const value = 1;" },
					},
				],
			} as any,
		],
	);
	memoryStores.registerManifest({
		ownerRuntimeId: "worker",
		sourcePath: "memory/manifest.json",
		manifest: {
			name: "Primary Memory",
			storeType: "vector",
			retentionPolicy: "long-lived",
			tags: ["index"],
		},
	});
	logs.registerLog({
		ownerRuntimeId: "coding",
		sourcePath: ".debug/run-1",
		logType: "debug-snapshot",
		label: "Debug Snapshot",
		reason: "test",
	});

	const snapshot = inventory.getInventory();
	assert.strictEqual(snapshot.artifacts.length, 1);
	assert.strictEqual(snapshot.artifacts[0]?.filePath, "src/test.ts");
	assert.strictEqual(snapshot.memoryStores[0]?.storeType, "vector");
	assert.ok(snapshot.memoryStores[0]?.tags.includes("index"));
	assert.strictEqual(snapshot.logs[0]?.logType, "debug-snapshot");
});

test("Vibe durable storage bootstraps the full private directory tree", () => {
	const durableRoot = path.join(tempRoot, "durable-root");
	const tree = ensureVibeDurableStorage({ durableRoot });

	assert.deepStrictEqual(readdirSync(durableRoot).sort(), ["artifacts", "auth", "checkpoints", "config", "logs", "memory", "plans", "sessions", "tracker"].sort());
	for (const dirPath of Object.values(tree)) {
		assert.strictEqual(statSync(dirPath).isDirectory(), true);
	}
	assert.strictEqual(getVibeConfigPath("vibe-agent-config.json", { durableRoot }), path.join(durableRoot, "config", "vibe-agent-config.json"));
	assert.strictEqual(getRuntimeSessionDir("orc", "/workspace/demo", durableRoot), path.join(durableRoot, "sessions", "orc", Buffer.from("/workspace/demo").toString("base64url")));
});

test("VibeAgentApp boots with a coding runtime and catalogs artifacts", async () => {
	const terminal = new VirtualTerminal(100, 30);
	const host = new FakeAgentHost([
		{
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "call-1",
					name: "write",
					arguments: { file_path: "src/generated.ts", content: "export const generated = true;" },
				},
			],
		} as any,
	]);

	const app = new VibeAgentApp({
		terminal,
		host,
		configPath: path.join(tempRoot, "single-runtime-config.json"),
		durableRootPath: path.join(tempRoot, "app-durable-root"),
		getEnvApiKey: (providerId) => (providerId === "openai" ? "test-key" : undefined),
	});

	app.start();
	await flushAsyncWork();

	assert.strictEqual(host.startCount, 1);
	assert.strictEqual(app.inventoryService.listArtifacts().length, 1);
	assert.strictEqual(app.inventoryService.listArtifacts()[0]?.filePath, "src/generated.ts");

	app.stop();
	await flushAsyncWork();
});

test("VibeAgentApp starts registered coding, worker, and tool runtimes", async () => {
	const terminal = new VirtualTerminal(100, 30);
	const codingHost = new FakeAgentHost();
	const codingRuntime = new CompatAgentRuntime(
		{
			id: "coding",
			kind: "coding",
			displayName: "Coding Runtime",
			capabilities: ["interactive-prompt"],
			primary: true,
		},
		codingHost,
	);
	const workerRuntime = new StubRuntime({
		id: "worker",
		kind: "worker",
		displayName: "Worker Runtime",
		capabilities: ["background-processing", "memory-store"],
	});
	const toolRuntime = new StubRuntime({
		id: "tool",
		kind: "tool",
		displayName: "Tool Runtime",
		capabilities: ["artifact-source", "log-source"],
	});

	const app = new VibeAgentApp({
		terminal,
		runtimes: [codingRuntime, workerRuntime, toolRuntime],
		configPath: path.join(tempRoot, "multi-runtime-config.json"),
		durableRootPath: path.join(tempRoot, "multi-runtime-durable-root"),
		getEnvApiKey: (providerId) => (providerId === "openai" ? "test-key" : undefined),
	});

	app.start();
	await flushAsyncWork();

	assert.strictEqual(codingHost.startCount, 1);
	assert.strictEqual(workerRuntime.started, true);
	assert.strictEqual(toolRuntime.started, true);

	app.stop();
	await flushAsyncWork();
});
