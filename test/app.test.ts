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
import { ensureVibeDurableStorage, getVibeArtifactCatalogPath, getVibeConfigPath, getVibeLogCatalogPath, getVibeMemoryCatalogPath, getVibeTrackerCatalogPath } from "../src/durable/durable-paths.js";
import { LocalFileOrcCheckpointStore } from "../src/orchestration/orc-checkpoints.js";
import { createDefaultOrcSecurityPolicy, ORC_SECURITY_STATUS_TEXT } from "../src/orchestration/orc-security.js";
import { OrcRuntimeSkeleton } from "../src/orchestration/orc-runtime.js";
import { FileSystemOrcTracker } from "../src/orchestration/orc-tracker.js";
import { getRuntimeSessionDir } from "../src/runtime/runtime-session-namespace.js";
import type { AgentRuntime, RuntimeDescriptor } from "../src/runtime/agent-runtime.js";
import { CompatAgentRuntime } from "../src/runtime/compat-agent-runtime.js";
import { RuntimeCoordinator } from "../src/runtime/runtime-coordinator.js";
import { VirtualTerminal } from "./helpers/virtual-terminal.js";
import { AppConfig as AppConfigStore } from "../src/app-config.js";

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

test("Durable services catalog artifacts, memory stores, logs, and orchestration documents", () => {
	const durableRoot = path.join(tempRoot, "durable-services-root");
	const artifactCatalog = new ArtifactCatalogService({ durableRoot });
	const memoryStores = new MemoryStoreService({ durableRoot });
	const logs = new LogCatalogService({ durableRoot });
	const inventory = new WorkbenchInventoryService(artifactCatalog, memoryStores, logs, { durableRoot });

	artifactCatalog.replaceFromMessages(
		{ runtimeId: "coding", sessionId: "session-1", threadId: "thread-7", phase: "planning", waveNumber: 2 },
		[
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call-1",
						name: "write",
						arguments: { file_path: "plans/wave-2.md", content: "# Wave 2 Plan\n- capture artifact" },
					},
				],
			} as any,
		],
	);
	memoryStores.registerManifest({
		ownerRuntimeId: "worker",
		sessionId: "session-1",
		threadId: "thread-7",
		phase: "planning",
		waveNumber: 2,
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
		sessionId: "session-1",
		threadId: "thread-7",
		phase: "planning",
		waveNumber: 2,
		sourcePath: ".debug/run-1",
		logType: "debug-snapshot",
		label: "Debug Snapshot",
		reason: "test",
	});

	const snapshot = inventory.getInventory();
	assert.strictEqual(snapshot.artifacts.length, 1);
	assert.strictEqual(snapshot.artifacts[0]?.filePath, "plans/wave-2.md");
	assert.strictEqual(snapshot.artifacts[0]?.phase, "planning");
	assert.strictEqual(snapshot.memoryStores[0]?.storeType, "vector");
	assert.ok(snapshot.memoryStores[0]?.tags.includes("index"));
	assert.strictEqual(snapshot.logs[0]?.logType, "debug-snapshot");
	assert.ok(snapshot.orchestrationDocuments.some((document) => document.documentType === "plan" && document.label === "wave-2.md"));
	assert.ok(snapshot.orchestrationDocuments.some((document) => document.documentType === "manifest" && document.label === "wave-2.md manifest"));
	assert.ok(snapshot.orchestrationDocuments.some((document) => document.relatedRecordIds.includes(snapshot.logs[0]!.id)));
	assert.strictEqual(statSync(getVibeArtifactCatalogPath({ durableRoot })).isFile(), true);
	assert.strictEqual(statSync(getVibeMemoryCatalogPath({ durableRoot })).isFile(), true);
	assert.strictEqual(statSync(getVibeLogCatalogPath({ durableRoot })).isFile(), true);
	assert.strictEqual(statSync(getVibeTrackerCatalogPath({ durableRoot })).isFile(), true);

	const reloadedArtifacts = new ArtifactCatalogService({ durableRoot });
	const reloadedMemory = new MemoryStoreService({ durableRoot });
	const reloadedLogs = new LogCatalogService({ durableRoot });
	const reloadedInventory = new WorkbenchInventoryService(reloadedArtifacts, reloadedMemory, reloadedLogs, { durableRoot });
	assert.strictEqual(reloadedArtifacts.list().length, 1);
	assert.strictEqual(reloadedMemory.list()[0]?.threadId, "thread-7");
	assert.strictEqual(reloadedLogs.list()[0]?.waveNumber, 2);
	assert.ok(reloadedInventory.getInventory().orchestrationDocuments.length >= 3);
});

test("Vibe durable storage bootstraps the full private directory tree", () => {
	const durableRoot = path.join(tempRoot, "durable-root");
	const tree = ensureVibeDurableStorage({ durableRoot });

	assert.deepStrictEqual(readdirSync(durableRoot).sort(), ["artifacts", "auth", "checkpoints", "config", "logs", "memory", "plans", "research", "roadmaps", "sessions", "tracker"].sort());
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


test("Local Orc checkpoint store persists manifests and tracker snapshots by stable IDs", async () => {
	const durableRoot = path.join(tempRoot, "orc-checkpoint-root");
	const checkpoints = new LocalFileOrcCheckpointStore({ durableRoot });
	const tracker = new FileSystemOrcTracker(checkpoints, { durableRoot });
	const state = {
		threadId: "thread:alpha",
		checkpointId: "checkpoint:001",
		phase: "checkpointed",
		project: { projectId: "proj-1", projectRoot: "/workspace/demo", projectName: "Demo" },
		messages: [],
		workerResults: [],
		verificationErrors: [],
		lastUpdatedAt: "2026-03-22T00:00:00.000Z",
	} satisfies import("../src/orchestration/orc-state.js").OrcControlPlaneState;

	await tracker.save(state);
	const manifest = await checkpoints.saveCheckpoint({
		metadata: {
			checkpointId: state.checkpointId,
			thread: { threadId: state.threadId, projectId: state.project.projectId, runtimeId: "orc", sessionId: "session-42" },
			sequenceNumber: 1,
			phase: state.phase,
			createdAt: state.lastUpdatedAt,
			trackerStateId: `${state.threadId}:${state.checkpointId}`,
			resumeData: { phase: state.phase, workerIds: [], instructions: "resume from checkpoint" },
			stateSnapshot: {
				snapshotId: "snapshot-1",
				trackerStateId: `${state.threadId}:${state.checkpointId}`,
				storageKey: "thread:alpha/checkpoint:001",
				format: "control-plane-state",
				capturedAt: state.lastUpdatedAt,
			},
			artifactBundleIds: ["bundle-1"],
			rewindTargetIds: [state.checkpointId],
		},
	});

	assert.strictEqual(manifest.latestCheckpointId, state.checkpointId);
	assert.deepStrictEqual(manifest.checkpointHistory, [state.checkpointId]);
	assert.deepStrictEqual(manifest.rewindTargetIds, [state.checkpointId]);
	assert.deepStrictEqual(manifest.artifactBundleIds, ["bundle-1"]);
	assert.strictEqual((await checkpoints.loadCheckpoint({ threadId: state.threadId }))?.stateSnapshot.storageKey, "thread:alpha/checkpoint:001");
	assert.strictEqual((await tracker.load(state.threadId, state.checkpointId))?.threadId, state.threadId);
});

test("AppConfig persists orchestration security settings for main and worker Orc sessions", () => {
	const configPath = path.join(tempRoot, "orc-security-config.json");
	AppConfigStore.save(
		{
			setupComplete: true,
			orchestration: {
				sessionKind: "main-app",
				allowedWorkingDirectories: ["/workspace/Vibe_Agent"],
				maximumConcurrency: 3,
				humanEscalationThresholds: {
					requiresApprovalAfter: 2,
					reasons: ["destructive-command", "network-access"],
				},
				workerSandbox: {
					workspaceRoot: "/workspace/Vibe_Agent",
					durableRoot: "/tmp/vibe-durable",
					writeAllowedPaths: ["/workspace/Vibe_Agent", "/tmp/vibe-durable"],
					blockedCommandPatterns: ["rm -rf /", "sudo rm"],
				},
			},
		},
		configPath,
	);

	const loaded = AppConfigStore.load(configPath);
	assert.deepStrictEqual(loaded.orchestration, {
		sessionKind: "main-app",
		allowedWorkingDirectories: ["/workspace/Vibe_Agent"],
		maximumConcurrency: 3,
		humanEscalationThresholds: {
			requiresApprovalAfter: 2,
			reasons: ["destructive-command", "network-access"],
		},
		workerSandbox: {
			workspaceRoot: "/workspace/Vibe_Agent",
			durableRoot: "/tmp/vibe-durable",
			writeAllowedPaths: ["/workspace/Vibe_Agent", "/tmp/vibe-durable"],
			blockedCommandPatterns: ["rm -rf /", "sudo rm"],
		},
	});
});

test("Orc runtime threads merged security policy and UI status text through the session factory", async () => {
	let sessionSecurity = createDefaultOrcSecurityPolicy({
		orchestration: {
			sessionKind: "main-app",
			workerSandbox: {
				workspaceRoot: "/workspace/Vibe_Agent",
				durableRoot: "/tmp/vibe-durable",
				writeAllowedPaths: ["/workspace/Vibe_Agent"],
				blockedCommandPatterns: ["rm -rf /"],
			},
		},
	});
	const runtime = new OrcRuntimeSkeleton(
		{},
		{
			securityPolicy: sessionSecurity,
			sessionFactory: {
				createSession: (_request, securityPolicy) => {
					sessionSecurity = securityPolicy;
					return {
						threadId: "thread-1",
						checkpointId: "checkpoint-1",
						securityPolicy,
						getState: () => undefined,
					};
				},
			},
		},
	);

	await assert.rejects(
		runtime.launch({
			project: { projectId: "proj-1", projectRoot: "/workspace/Vibe_Agent" },
			prompt: "launch",
			securityPolicyOverrides: {
				sessionKind: "ephemeral-worker",
				maximumConcurrency: 4,
				allowedWorkingDirectories: ["/workspace/Vibe_Agent", "/tmp/vibe-durable"],
			},
		}),
		/not implemented yet/,
	);

	assert.strictEqual(sessionSecurity.sessionKind, "ephemeral-worker");
	assert.strictEqual(sessionSecurity.maximumConcurrency, 4);
	assert.deepStrictEqual(sessionSecurity.allowedWorkingDirectories, ["/workspace/Vibe_Agent", "/tmp/vibe-durable"]);
	assert.strictEqual(ORC_SECURITY_STATUS_TEXT["approval-required"], "Approval required");
	assert.strictEqual(ORC_SECURITY_STATUS_TEXT["blocked-command"], "Blocked command");
});
