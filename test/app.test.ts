import assert from "node:assert";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
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
import { OrcDebugArtifactsWriter } from "../src/orchestration/orc-debug.js";
import { OrcAsyncEventBus } from "../src/orchestration/orc-event-bus.js";
import { attachOrcDurableEventLogWriter, getOrcEventLogLocation } from "../src/orchestration/orc-event-log.js";
import {
	ORC_FAILURE_DISPOSITIONS,
	createInitialCheckpointMetadataSummary,
	createInitialReducedTransportHealth,
	createInitialTerminalStateSummary,
	isCheckpointWorthyOrcEvent,
	reduceOrcControlPlaneEvent,
	type OrcBusEvent,
} from "../src/orchestration/orc-events.js";
import type { OrcCanonicalEventEnvelope } from "../src/orchestration/orc-io.js";
import type {
	OrcPythonTransport,
	OrcPythonTransportDiagnosticEvent,
	OrcPythonTransportHealth,
	OrcPythonTransportLifecycleEvent,
} from "../src/orchestration/orc-python-transport.js";
import {
	DEFAULT_FATAL_PARSE_FAILURE_COUNT,
	evaluateParseFailurePolicy,
	evaluateTransportTimeoutPolicy,
	OrcPythonChildProcessTransport,
} from "../src/orchestration/orc-python-transport.js";
import {
	createDefaultOrcSecurityPolicy,
	mapCommandInterceptorResultToOrcSecurityEvent,
	ORC_SECURITY_STATUS_TEXT,
} from "../src/orchestration/orc-security.js";
import { OrcRuntimeSkeleton } from "../src/orchestration/orc-runtime.js";
import { build_orc_graph, type OrcMasterState } from "../src/orchestration/orc-graph.js";
import { OrcSessionHandle } from "../src/orchestration/orc-session.js";
import { presentOrcEventSummary, presentOrcTrackerSummary } from "../src/orchestration/orc-presentation.js";
import { FileSystemOrcTracker, createOrcTrackerDashboardViewModel } from "../src/orchestration/orc-tracker.js";
import { createOrcTuiTelemetrySubscriber } from "../src/orchestration/orc-tui-subscriber.js";
import type { OrcControlPlaneState } from "../src/orchestration/orc-state.js";
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

class StubOrcPythonTransport implements OrcPythonTransport {
	health: OrcPythonTransportHealth = {
		stage: "idle",
		status: "idle",
		args: [],
		stdoutLines: 0,
		stderrLines: 0,
		stdoutBufferedBytes: 0,
		stderrBufferedBytes: 0,
		diagnosticsDropped: 0,
		warningEvents: 0,
		faultEvents: 0,
		parseFailures: 0,
		consecutiveParseFailures: 0,
		timeouts: { idleWarningMs: 5_000, stallTimeoutMs: 15_000, readyTimeoutMs: 10_000 },
	};
	lifecycleListeners: Array<(event: OrcPythonTransportLifecycleEvent) => void> = [];
	envelopeListeners: Array<(envelope: OrcCanonicalEventEnvelope) => void> = [];
	diagnosticListeners: Array<(event: OrcPythonTransportDiagnosticEvent) => void> = [];
	launchInputs: unknown[] = [];
	resumeInputs: unknown[] = [];
	cancelReasons: string[] = [];
	shutdownReasons: string[] = [];

	async launch(input: any): Promise<void> {
		this.launchInputs.push(input);
		this.health = { ...this.health, threadId: input.threadId, runCorrelationId: input.runCorrelationId, stage: "ready", status: "healthy" };
		this.emitLifecycle({ stage: "spawned", at: new Date().toISOString(), threadId: input.threadId, runCorrelationId: input.runCorrelationId, pid: 101 });
		this.emitLifecycle({ stage: "ready", at: new Date().toISOString(), threadId: input.threadId, runCorrelationId: input.runCorrelationId, pid: 101 });
	}

	async resume(input: any): Promise<void> {
		this.resumeInputs.push(input);
		await this.launch(input);
	}

	async cancel(reason = "cancel_requested"): Promise<void> {
		this.cancelReasons.push(reason);
		this.health = { ...this.health, stage: "terminated", status: "offline" };
		this.emitLifecycle({ stage: "terminated", at: new Date().toISOString(), threadId: this.health.threadId, runCorrelationId: this.health.runCorrelationId, reason });
	}

	async shutdown(reason = "shutdown_requested"): Promise<void> {
		this.shutdownReasons.push(reason);
		this.health = { ...this.health, stage: "exited", status: "offline", lastExitCode: 0 };
		this.emitLifecycle({ stage: "exit", at: new Date().toISOString(), threadId: this.health.threadId, runCorrelationId: this.health.runCorrelationId, exitCode: 0, reason });
	}

	getHealth(): OrcPythonTransportHealth {
		return { ...this.health, args: [...this.health.args], timeouts: { ...this.health.timeouts } };
	}

	onLifecycle(listener: (event: OrcPythonTransportLifecycleEvent) => void): () => void {
		this.lifecycleListeners.push(listener);
		return () => undefined;
	}

	onEnvelope(listener: (envelope: OrcCanonicalEventEnvelope) => void): () => void {
		this.envelopeListeners.push(listener);
		return () => undefined;
	}

	onDiagnostic(listener: (event: OrcPythonTransportDiagnosticEvent) => void): () => void {
		this.diagnosticListeners.push(listener);
		return () => undefined;
	}

	async dispose(): Promise<void> {}

	emitLifecycleEvent(event: OrcPythonTransportLifecycleEvent): void {
		for (const listener of this.lifecycleListeners) {
			listener(event);
		}
	}

	emitEnvelopeEvent(envelope: OrcCanonicalEventEnvelope): void {
		for (const listener of this.envelopeListeners) {
			listener(envelope);
		}
	}

	private emitLifecycle(event: OrcPythonTransportLifecycleEvent): void {
		this.emitLifecycleEvent(event);
	}
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

test("VibeAgentApp can instantiate both legacy and next shell implementations", async () => {
	const createApp = (shellImplementation: "legacy" | "next") => {
		const host = new FakeAgentHost();
		const app = new VibeAgentApp({
			terminal: new VirtualTerminal(100, 30),
			host,
			shellImplementation,
			configPath: path.join(tempRoot, `shell-${shellImplementation}-config.json`),
			durableRootPath: path.join(tempRoot, `shell-${shellImplementation}-durable-root`),
			getEnvApiKey: (providerId) => (providerId === "openai" ? "test-key" : undefined),
		});
		return { app, host };
	};

	const legacy = createApp("legacy");
	legacy.app.start();
	await flushAsyncWork();
	assert.strictEqual(legacy.host.startCount, 1);
	legacy.app.stop();
	await flushAsyncWork();

	const next = createApp("next");
	next.app.start();
	await flushAsyncWork();
	assert.strictEqual(next.host.startCount, 1);
	next.app.stop();
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
		checkpointMetadata: {
			...createInitialCheckpointMetadataSummary(),
			transportRunCorrelationId: "run-cp-1",
			latestDurableEventOffset: { eventId: "evt-0", runCorrelationId: "run-cp-1", streamSequence: 4, eventLogGlobalIndex: 4, recordedAt: "2026-03-22T00:00:00.000Z" },
			checkpointBoundary: { eventId: "evt-0", eventKind: "checkpoint.status", status: "captured", threadId: "thread:alpha", runCorrelationId: "run-cp-1", recordedAt: "2026-03-22T00:00:00.000Z" },
		},
		transportHealth: createInitialReducedTransportHealth(),
		terminalState: createInitialTerminalStateSummary(),
		lastUpdatedAt: "2026-03-22T00:00:00.000Z",
	} satisfies import("../src/orchestration/orc-state.js").OrcControlPlaneState;

	await tracker.save(state);
	const manifest = await checkpoints.saveCheckpoint({
		metadata: {
			checkpointId: state.checkpointId!,
			thread: { threadId: state.threadId, projectId: state.project.projectId, runtimeId: "orc", sessionId: "session-42" },
			sequenceNumber: 1,
			phase: state.phase,
			createdAt: state.lastUpdatedAt,
			trackerStateId: `${state.threadId}:${state.checkpointId}`,
			resumeData: { phase: state.phase, workerIds: [], instructions: "resume from checkpoint", transportRunCorrelationId: "run-cp-1", latestDurableEventOffset: state.checkpointMetadata.latestDurableEventOffset, checkpointBoundary: state.checkpointMetadata.checkpointBoundary },
			stateSnapshot: {
				snapshotId: "snapshot-1",
				trackerStateId: `${state.threadId}:${state.checkpointId}`,
				storageKey: "thread:alpha/checkpoint:001",
				format: "control-plane-state",
				capturedAt: state.lastUpdatedAt,
			},
			artifactBundleIds: ["bundle-1"],
			rewindTargetIds: [state.checkpointId!],
			transportRunCorrelationId: "run-cp-1",
			latestDurableEventOffset: state.checkpointMetadata.latestDurableEventOffset,
			checkpointBoundary: state.checkpointMetadata.checkpointBoundary,
		},
	});

	assert.strictEqual(manifest.latestCheckpointId, state.checkpointId);
	assert.deepStrictEqual(manifest.checkpointHistory, [state.checkpointId]);
	assert.deepStrictEqual(manifest.rewindTargetIds, [state.checkpointId]);
	assert.deepStrictEqual(manifest.artifactBundleIds, ["bundle-1"]);
	assert.strictEqual((await checkpoints.loadCheckpoint({ threadId: state.threadId }))?.stateSnapshot.storageKey, "thread:alpha/checkpoint:001");
	assert.strictEqual((await tracker.load(state.threadId, state.checkpointId))?.threadId, state.threadId);
	assert.strictEqual((await tracker.load(state.threadId, state.checkpointId))?.checkpointMetadata.transportRunCorrelationId, "run-cp-1");
	assert.strictEqual((await checkpoints.loadCheckpoint({ threadId: state.threadId }))?.latestDurableEventOffset?.eventLogGlobalIndex, 4);
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
	const transport = new StubOrcPythonTransport();
	const runtime = new OrcRuntimeSkeleton(
		{ createPythonTransport: () => transport },
		{
			securityPolicy: sessionSecurity,
			sessionFactory: {
				createSession: ({ securityPolicy, threadId, checkpointId, runCorrelationId, state }) => {
					sessionSecurity = securityPolicy;
					return {
						threadId,
						checkpointId: checkpointId ?? "checkpoint-1",
						securityPolicy,
						runCorrelationId,
						getState: () => state,
						updateState: () => undefined,
						getRuntimeHooks: () => undefined,
						attachRuntimeHooks: () => undefined,
					};
				},
			},
		},
	);

	const response = await runtime.launch({
		project: { projectId: "proj-1", projectRoot: "/workspace/Vibe_Agent" },
		prompt: "launch",
		securityPolicyOverrides: {
			sessionKind: "ephemeral-worker",
			maximumConcurrency: 4,
			allowedWorkingDirectories: ["/workspace/Vibe_Agent", "/tmp/vibe-durable"],
		},
	});

	assert.strictEqual(sessionSecurity.sessionKind, "ephemeral-worker");
	assert.strictEqual(sessionSecurity.maximumConcurrency, 4);
	assert.deepStrictEqual(sessionSecurity.allowedWorkingDirectories, ["/workspace/Vibe_Agent", "/tmp/vibe-durable"]);
	assert.strictEqual(response.state.securityPolicy?.sessionKind, "ephemeral-worker");
	assert.strictEqual(transport.launchInputs.length, 1);
	assert.strictEqual(ORC_SECURITY_STATUS_TEXT["approval-required"], "Approval required");
	assert.strictEqual(ORC_SECURITY_STATUS_TEXT["blocked-command"], "Blocked command");
});

test("Orc runtime resumes tracker/checkpoint state and exposes stable session hooks", async () => {
	const durableRoot = path.join(tempRoot, "orc-runtime-resume");
	const checkpoints = new LocalFileOrcCheckpointStore({ durableRoot });
	const tracker = new FileSystemOrcTracker(checkpoints, { durableRoot });
	const state: OrcControlPlaneState = {
		threadId: "thread-resume-1",
		checkpointId: "checkpoint-resume-1",
		phase: "checkpointed",
		project: { projectId: "proj-1", projectRoot: "/workspace/Vibe_Agent", projectName: "Vibe Agent" },
		securityPolicy: createDefaultOrcSecurityPolicy(),
		messages: [],
		workerResults: [],
		verificationErrors: [],
		checkpointMetadata: createInitialCheckpointMetadataSummary(),
		transportHealth: createInitialReducedTransportHealth(),
		terminalState: createInitialTerminalStateSummary(),
		lastUpdatedAt: new Date().toISOString(),
	};
	await tracker.save(state);
	await checkpoints.saveCheckpoint({
		metadata: {
			checkpointId: state.checkpointId!,
			thread: { threadId: state.threadId, projectId: state.project.projectId },
			sequenceNumber: 1,
			phase: state.phase,
			createdAt: state.lastUpdatedAt,
			trackerStateId: `${state.threadId}:${state.checkpointId}`,
			resumeData: { phase: "checkpointed", workerIds: [], instructions: "resume checkpointed thread", activeWaveId: "wave-1" },
			stateSnapshot: {
				snapshotId: "snapshot-1",
				trackerStateId: `${state.threadId}:${state.checkpointId}`,
				storageKey: "thread-resume-1/checkpoint-resume-1",
				format: "control-plane-state",
				capturedAt: state.lastUpdatedAt,
			},
			artifactBundleIds: [],
			rewindTargetIds: [state.checkpointId!],
		},
	});

	const transport = new StubOrcPythonTransport();
	const runtime = new OrcRuntimeSkeleton(
		{ createPythonTransport: () => transport },
		{ tracker, checkpointStore: checkpoints },
	);

	const response = await runtime.resumeThread({ threadId: state.threadId, checkpointId: state.checkpointId });
	assert.strictEqual(response.threadId, state.threadId);
	assert.strictEqual(response.checkpointId, state.checkpointId);
	assert.strictEqual(response.state?.project.projectName, "Vibe Agent");
	assert.strictEqual(transport.resumeInputs.length, 1);

	const session = runtime.getSession(state.threadId);
	assert.ok(session);
	assert.ok(session?.getRuntimeHooks());
	assert.strictEqual(session?.getRuntimeHooks()?.getTransportHealth()?.threadId, state.threadId);
	assert.strictEqual((await runtime.loadTrackerState({ threadId: state.threadId })).found, true);

	await session?.getRuntimeHooks()?.shutdown("test_shutdown");
	assert.strictEqual(runtime.getSession(state.threadId), undefined);
});


function createBusEvent(index: number, runCorrelationId = "run-1"): OrcBusEvent {
	const emittedAt = new Date(2026, 2, 22, 0, 0, index).toISOString();
	return {
		kind: "agent.message",
		envelope: {
			origin: {
				runCorrelationId,
				eventId: `event-${index}`,
				streamSequence: index,
				emittedAt,
				source: "orc_runtime",
				threadId: "thread-1",
			},
			who: { kind: "agent", id: "agent-1", label: "Agent 1" },
			what: {
				category: "agent_message",
				name: "agent_message",
				description: `message-${index}`,
				severity: "info",
				status: "streaming",
			},
			how: {
				channel: "event_bus",
				interactionTarget: "user",
				environment: "transport",
				transport: "in_process",
			},
			when: emittedAt,
		},
		payload: {
			messageId: `message-${index}`,
			content: `message-${index}`,
			agentId: "agent-1",
			streamState: "final",
		},
		interaction: {
			target: "user",
			lane: "agent_interacting_with_user",
			isUserFacing: true,
			isComputerFacing: false,
		},
		debug: {
			normalizedFrom: "test:createBusEvent",
		},
	};
}

test("OrcAsyncEventBus preserves publish ordering independently per subscriber", async () => {
	const bus = new OrcAsyncEventBus({ component: "test" });
	const fast: number[] = [];
	const slow: number[] = [];

	bus.subscribe(async (event) => {
		fast.push(event.envelope.origin.streamSequence);
	}, { label: "fast-subscriber", handlerKind: "test-fast" });

	bus.subscribe(async (event) => {
		await new Promise((resolve) => setTimeout(resolve, 5));
		slow.push(event.envelope.origin.streamSequence);
	}, { label: "slow-subscriber", handlerKind: "test-slow" });

	for (const index of [1, 2, 3]) {
		bus.publish(createBusEvent(index));
	}

	await new Promise((resolve) => setTimeout(resolve, 150));
	assert.deepStrictEqual(fast, [1, 2, 3]);
	assert.deepStrictEqual(slow, [1, 2, 3]);
	bus.dispose();
});

test("OrcAsyncEventBus bounds slow subscriber queues and surfaces overflow warnings", async () => {
	const bus = new OrcAsyncEventBus({ component: "test" });
	const receivedKinds: string[] = [];
	const receivedSequences: number[] = [];

	bus.subscribe(async (event) => {
		await new Promise((resolve) => setTimeout(resolve, 10));
		receivedKinds.push(event.kind);
		if (event.kind === "agent.message") {
			receivedSequences.push(event.envelope.origin.streamSequence);
		}
	}, { label: "bounded-subscriber", handlerKind: "test-bounded", maxQueueSize: 2 });

	for (const index of [1, 2, 3, 4, 5]) {
		bus.publish(createBusEvent(index));
	}

	await new Promise((resolve) => setTimeout(resolve, 120));
	assert.ok(receivedKinds.includes("stream.warning"));
	assert.deepStrictEqual(receivedSequences, [4, 5]);
	assert.strictEqual(bus.getSnapshot().totalDroppedDeliveries >= 3, true);
	bus.dispose();
});

test("OrcAsyncEventBus enforces run ownership reset and disposal semantics", async () => {
	const bus = new OrcAsyncEventBus({ component: "test" });
	bus.publish(createBusEvent(1, "run-a"));
	assert.throws(() => bus.publish(createBusEvent(2, "run-b")), /reset before publishing run run-b/);
	bus.reset({ nextRunCorrelationId: "run-b", reason: "next run" });
	assert.deepStrictEqual(bus.getReplayPolicy(), { available: false, reason: "post_reset" });
	bus.publish(createBusEvent(3, "run-b"));
	bus.dispose();
	assert.throws(() => bus.publish(createBusEvent(4, "run-b")), /already been disposed/);
});


test("attachOrcDurableEventLogWriter persists normalized events using segmented JSONL logs", async () => {
	const durableRoot = mkdtempSync(path.join(tempRoot, "orc-event-log-"));
	const bus = new OrcAsyncEventBus({ component: "test" });
	const threadId = "thread-1";
	const runCorrelationId = "run-log-1";
	const { writer } = attachOrcDurableEventLogWriter(bus, {
		durableRoot,
		threadId,
		runCorrelationId,
		maxEventsPerSegment: 2,
	});

	for (const index of [1, 2, 3]) {
		bus.publish(createBusEvent(index, runCorrelationId));
	}

	await new Promise((resolve) => setTimeout(resolve, 50));
	const location = getOrcEventLogLocation({ threadId, runCorrelationId }, { durableRoot });
	const manifest = JSON.parse(readFileSync(path.join(location.runDirPath, "manifest.json"), "utf8"));
	assert.strictEqual(manifest.format, "jsonl");
	assert.strictEqual(manifest.failurePolicy, "best_effort_non_fatal");
	assert.strictEqual(manifest.segments.length, 2);
	assert.strictEqual(manifest.segments[0].eventCount, 2);
	assert.strictEqual(manifest.segments[1].eventCount, 1);
	const firstSegmentLines = readFileSync(path.join(location.segmentDirPath, "segment-000001.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
	const secondSegmentLines = readFileSync(path.join(location.segmentDirPath, "segment-000002.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
	assert.deepStrictEqual(firstSegmentLines.map((line) => line.eventId), ["event-1", "event-2"]);
	assert.deepStrictEqual(secondSegmentLines.map((line) => line.eventId), ["event-3"]);
	assert.deepStrictEqual(secondSegmentLines[0].correlation, { threadId: "thread-1", runCorrelationId });
	assert.strictEqual(secondSegmentLines[0].sequence.segmentIndex, 2);
	assert.strictEqual(secondSegmentLines[0].sequence.globalEventIndex, 3);
	assert.strictEqual(secondSegmentLines[0].eventType, "agent.message");
	assert.strictEqual(writer.getSnapshot().failedWrites, 0);
	bus.dispose();
});

test("attachOrcDurableEventLogWriter keeps persistence failures non-fatal to the bus", async () => {
	const durableRoot = mkdtempSync(path.join(tempRoot, "orc-event-log-failure-"));
	const bus = new OrcAsyncEventBus({ component: "test" });
	const threadId = "thread-1";
	const runCorrelationId = "run-log-2";
	const { writer } = attachOrcDurableEventLogWriter(bus, {
		durableRoot,
		threadId,
		runCorrelationId,
		maxEventsPerSegment: 1,
	});
	const location = getOrcEventLogLocation({ threadId, runCorrelationId }, { durableRoot });
	rmSync(path.join(location.runDirPath, "manifest.json"), { force: true });
	rmSync(location.segmentDirPath, { recursive: true, force: true });
	bus.publish(createBusEvent(1, runCorrelationId));
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.strictEqual(writer.getSnapshot().writtenEvents, 0);
	assert.strictEqual(writer.getSnapshot().failedWrites, 1);
	assert.match(writer.getSnapshot().lastFailure?.message ?? "", /no such file|ENOENT/i);
	assert.strictEqual(bus.getSnapshot().publishedEvents, 1);
	bus.dispose();
});



test("evaluateParseFailurePolicy escalates repeated parse noise into a restart-requesting fault", () => {
	const policy = evaluateParseFailurePolicy({
		message: "Failed to parse stdout JSONL line 3.",
		line: "{not-json}",
		byteLength: 10,
		detail: "Unexpected token n in JSON",
		lineSequence: 3,
		consecutiveParseFailures: DEFAULT_FATAL_PARSE_FAILURE_COUNT,
		fatalParseFailureCount: DEFAULT_FATAL_PARSE_FAILURE_COUNT,
		stdoutBufferedBytes: 10,
		lastStdoutSequence: 2,
		recentStderr: [{ at: "2026-03-23T00:00:00.000Z", line: "stderr hint", truncated: false }],
	});

	assert.strictEqual(policy.action, "restart");
	assert.strictEqual(policy.emissions[0]?.kind, "warning");
	assert.strictEqual(policy.emissions[1]?.kind, "fault");
	assert.strictEqual(policy.emissions[1]?.code, "transport_corrupt_stream");
});

test("evaluateTransportTimeoutPolicy emits recoverable idle warnings before fatal stall faults", () => {
	const idleHealth: OrcPythonTransportHealth = {
		threadId: "thread-timeout",
		runCorrelationId: "run-timeout",
		stage: "spawned",
		status: "healthy",
		args: [],
		spawnedAt: "2026-03-23T00:00:00.000Z",
		stdoutLines: 0,
		stderrLines: 0,
		stdoutBufferedBytes: 0,
		stderrBufferedBytes: 0,
		diagnosticsDropped: 0,
		warningEvents: 0,
		faultEvents: 0,
		parseFailures: 0,
		consecutiveParseFailures: 0,
		timeouts: {
			idleWarningMs: 5_000,
			stallTimeoutMs: 15_000,
			readyTimeoutMs: 10_000,
			lastProgressAt: "2026-03-23T00:00:00.000Z",
		},
	};
	const idlePolicy = evaluateTransportTimeoutPolicy({
		health: idleHealth,
		recentStderr: [],
		idleWarningMs: 5_000,
		stallTimeoutMs: 15_000,
		readyTimeoutMs: 10_000,
		now: Date.parse("2026-03-23T00:00:06.000Z"),
	});
	assert.strictEqual(idlePolicy.action, "continue");
	assert.strictEqual(idlePolicy.emissions[0]?.code, "transport_idle_timeout");

	const stallPolicy = evaluateTransportTimeoutPolicy({
		health: idleHealth,
		recentStderr: [],
		idleWarningMs: 5_000,
		stallTimeoutMs: 15_000,
		readyTimeoutMs: 10_000,
		now: Date.parse("2026-03-23T00:00:16.000Z"),
	});
	assert.strictEqual(stallPolicy.action, "restart");
	assert.ok(stallPolicy.emissions.some((emission) => emission.kind === "fault" && emission.code === "transport_stall_timeout"));
});
test("OrcPythonChildProcessTransport writes opt-in debug artifacts for stderr, raw-event mirrors, parser warnings, and transport diagnostics", async () => {
	const durableRoot = mkdtempSync(path.join(tempRoot, "orc-debug-"));
	const threadId = "thread-debug";
	const runCorrelationId = "run-debug";
	const debugWriter = new OrcDebugArtifactsWriter(threadId, runCorrelationId, { durableRoot });
	const transport = new OrcPythonChildProcessTransport({
		debugArtifactsWriter: debugWriter,
		buildSpawnContract: (input) => ({
			command: "node",
			args: [
				"--input-type=module",
				"--eval",
				[
					"import process from 'node:process';",
					"let stdin='';",
					"process.stdin.setEncoding('utf8');",
					"process.stdin.on('data', (chunk) => { stdin += chunk; });",
					"process.stdin.on('end', () => {",
					"  const payload = JSON.parse(stdin.trim());",
					"  process.stdout.write('not-json\\n');",
					"  process.stderr.write('runner stderr line\\n');",
					"  process.stdout.write(JSON.stringify({",
					"    origin: { runCorrelationId: payload.runCorrelationId, eventId: 'evt-1', streamSequence: 1, emittedAt: '2026-03-23T00:00:00.000Z', source: 'python_runner', threadId: payload.threadId },",
					"    who: { kind: 'agent', id: 'orc-runner', label: 'Orc Runner' },",
					"    what: { category: 'lifecycle', name: 'graph_ready', severity: 'info', status: 'started' },",
					"    how: { channel: 'stdout_jsonl', interactionTarget: 'computer', environment: 'transport', transport: 'python_child_process' },",
					"    when: '2026-03-23T00:00:00.000Z'",
					"  }) + '\\n');",
					"});",
				].join(""),
			],
			cwd: input.workspaceRoot,
			stdinPayload: input,
			stdoutProtocol: "jsonl",
			stderrProtocol: "diagnostic_text",
		}),
	});
	const lifecycleStages: string[] = [];
	transport.onLifecycle((event) => lifecycleStages.push(event.stage));
	const exitSeen = new Promise<void>((resolve) => {
		transport.onLifecycle((event) => {
			if (event.stage === "exit") {
				resolve();
			}
		});
	});

	await transport.launch({
		threadId,
		projectRoot: durableRoot,
		workspaceRoot: durableRoot,
		prompt: "debug transport smoke",
		phaseIntent: "debug-test",
		securityPolicy: createDefaultOrcSecurityPolicy(),
		resume: {},
		runCorrelationId,
	});
	await exitSeen;

	const parserWarnings = readFileSync(debugWriter.location.parserWarningsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
	const stderrLines = readFileSync(debugWriter.location.pythonStderrPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
	const rawMirrors = readFileSync(debugWriter.location.rawEventMirrorPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
	const transportDiagnostics = readFileSync(debugWriter.location.transportDiagnosticsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));

	assert.ok(lifecycleStages.includes("spawned"));
	assert.ok(lifecycleStages.includes("ready"));
	assert.ok(lifecycleStages.includes("exit"));
	assert.strictEqual(parserWarnings[0]?.code, "transport_parse_noise");
	assert.match(stderrLines[0]?.line ?? "", /runner stderr line/);
	assert.strictEqual(rawMirrors[0]?.origin?.eventId, "evt-1");
	assert.ok(transportDiagnostics.some((entry) => entry.type === "warning"));
	assert.ok(transportDiagnostics.some((entry) => entry.type === "lifecycle"));

	await transport.dispose();
});


test("reduceOrcControlPlaneEvent folds durable summary state and keeps ambiguous terminal outcomes explicit", () => {
	const baseState: OrcControlPlaneState = {
		threadId: "thread-reducer",
		phase: "bootstrapping",
		project: { projectId: "proj", projectRoot: "/tmp/project" },
		messages: [],
		workerResults: [],
		verificationErrors: [],
		checkpointMetadata: createInitialCheckpointMetadataSummary(),
		transportHealth: createInitialReducedTransportHealth(),
		terminalState: createInitialTerminalStateSummary(),
		lastUpdatedAt: "2026-03-22T00:00:00.000Z",
	};
	const mkEvent = (event: Partial<OrcBusEvent> & Pick<OrcBusEvent, "kind" | "payload">, id: string, when: string): OrcBusEvent => ({
		kind: event.kind,
		payload: event.payload as any,
		envelope: {
			origin: { eventId: id, emittedAt: when, threadId: "thread-reducer", runCorrelationId: "run-1", streamSequence: 1, source: "future_replay", workerId: "worker-1", waveId: "wave-1" },
			who: { id: "agent-1", kind: "agent", label: "Worker 1", workerId: "worker-1" },
			what: { category: "lifecycle", name: id, status: "started", severity: "notice", description: id },
			how: { channel: "stdout_jsonl", interactionTarget: "user", environment: "worker" },
			when,
		} as OrcCanonicalEventEnvelope,
		interaction: { target: "user", lane: "agent_interacting_with_user", isUserFacing: true, isComputerFacing: false },
		debug: { normalizedFrom: "test" },
	});
	let state = reduceOrcControlPlaneEvent(baseState, mkEvent({ kind: "worker.status", payload: { workerId: "worker-1", waveId: "wave-1", status: "queued", summary: "Queue worker" } }, "worker-queued", "2026-03-22T00:00:01.000Z"));
	state = reduceOrcControlPlaneEvent(state, mkEvent({ kind: "agent.message", payload: { messageId: "msg-1", content: "Working", workerId: "worker-1", agentId: "agent-1", streamState: "final" } }, "agent-message", "2026-03-22T00:00:02.000Z"));
	state = reduceOrcControlPlaneEvent(state, mkEvent({ kind: "tool.result", payload: { callId: "call-1", toolName: "npm test", status: "failed", workerId: "worker-1", errorText: "tests failed" } }, "tool-failed", "2026-03-22T00:00:03.000Z"));
	state = reduceOrcControlPlaneEvent(state, mkEvent({ kind: "worker.status", payload: { workerId: "worker-1", waveId: "wave-1", status: "completed", summary: "Recovered after retry" } }, "worker-completed", "2026-03-22T00:00:04.000Z"));
	state = reduceOrcControlPlaneEvent(state, mkEvent({ kind: "checkpoint.status", payload: { status: "captured", checkpointId: "cp-1", threadId: "thread-reducer", waveId: "wave-1", artifactBundleIds: ["artifact-1"], rewindTargetIds: ["rewind-1"], message: "checkpoint saved" } }, "checkpoint-captured", "2026-03-22T00:00:05.000Z"));
	state = reduceOrcControlPlaneEvent(state, mkEvent({ kind: "process.lifecycle", payload: { stage: "exited", exitCode: 0 } }, "process-exited", "2026-03-22T00:00:06.000Z"));
	state = reduceOrcControlPlaneEvent(state, mkEvent({ kind: "graph.lifecycle", payload: { graphId: "g-1", stage: "cancelled", reason: "late cancel" } }, "graph-cancelled", "2026-03-22T00:00:07.000Z"));

	assert.equal(state.phase, "cancelled");
	assert.equal(state.workerResults[0]?.status, "cancelled");
	assert.equal(state.messages.at(-1)?.content, "Working");
	assert.equal(state.checkpointMetadata.checkpointId, "cp-1");
	assert.equal(state.checkpointMetadata.transportRunCorrelationId, "run-1");
	assert.equal(state.checkpointMetadata.latestDurableEventOffset?.eventId, "graph-cancelled");
	assert.equal(state.checkpointMetadata.checkpointBoundary?.eventId, "graph-cancelled");
	assert.equal(isCheckpointWorthyOrcEvent(mkEvent({ kind: "worker.status", payload: { workerId: "worker-1", waveId: "wave-1", status: "queued", summary: "Queue worker" } }, "worker-queued-2", "2026-03-22T00:00:08.000Z")), false);
	assert.equal(state.transportHealth.status, "healthy");
	assert.equal(state.terminalState.status, "ambiguous");
	assert.match(state.terminalState.reason ?? "", /Conflicting terminal signals/);
	assert.equal(state.verificationErrors.length, 1);
});


test("presentation helpers generate concise summaries and degrade gracefully when metadata is missing", () => {
	const workerEvent: OrcBusEvent = {
		kind: "worker.status",
		payload: { workerId: "worker-9", status: "completed", summary: "Patched the runtime" },
		envelope: {
			origin: { eventId: "worker-complete", emittedAt: "2026-03-22T01:00:00.000Z", threadId: "thread-1", runCorrelationId: "run-1", streamSequence: 1 , source: "future_replay" },
			who: { id: "agent-1", kind: "agent", label: "Worker Agent" },
			what: { category: "lifecycle", name: "worker_completed", status: "succeeded", severity: "notice" },
			how: { channel: "stdout_jsonl", interactionTarget: "computer", environment: "worker" },
			when: "2026-03-22T01:00:00.000Z",
		},
		interaction: { target: "computer", lane: "agent_interacting_with_computer", isUserFacing: false, isComputerFacing: true },
		debug: { normalizedFrom: "test" },
	};
	const toolEvent: OrcBusEvent = {
		kind: "tool.call",
		payload: { callId: "call-1", toolName: "npm test" },
		envelope: {
			origin: { eventId: "tool-call", emittedAt: "2026-03-22T01:00:01.000Z", threadId: "thread-1", runCorrelationId: "run-1", streamSequence: 2 , source: "future_replay" },
			who: { id: "agent-1", kind: "agent", label: "Worker Agent" },
			what: { category: "tool_call", name: "tool_call", status: "started", severity: "info" },
			how: { channel: "stdout_jsonl", interactionTarget: "computer", environment: "worker", toolName: "npm test" },
			when: "2026-03-22T01:00:01.000Z",
		},
		interaction: { target: "computer", lane: "agent_interacting_with_computer", isUserFacing: false, isComputerFacing: true },
		debug: { normalizedFrom: "test" },
	};
	const degradedTransportEvent: OrcBusEvent = {
		kind: "transport.fault",
		payload: { faultCode: "transport_idle_timeout", message: "stdout stalled", status: "degraded" },
		envelope: {
			origin: { eventId: "transport-degraded", emittedAt: "2026-03-22T01:00:02.000Z", threadId: "thread-1", runCorrelationId: "run-1", streamSequence: 3 , source: "future_replay" },
			who: { id: "transport-1", kind: "transport", label: "Python Runner" },
			what: { category: "transport", name: "transport_fault", status: "failed", severity: "warning" },
			how: { channel: "event_bus", interactionTarget: "computer", environment: "transport" },
			when: "2026-03-22T01:00:02.000Z",
		},
		interaction: { target: "computer", lane: "system_support", isUserFacing: false, isComputerFacing: false },
		debug: { normalizedFrom: "test" },
	};
	const recoveredTransportEvent: OrcBusEvent = {
		kind: "process.lifecycle",
		payload: { stage: "ready" },
		envelope: {
			origin: { eventId: "transport-ready", emittedAt: "2026-03-22T01:00:03.000Z", threadId: "thread-1", runCorrelationId: "run-1", streamSequence: 4 , source: "future_replay" },
			who: { id: "transport-1", kind: "transport", label: "Python Runner" },
			what: { category: "transport", name: "process_ready", status: "succeeded", severity: "info" },
			how: { channel: "event_bus", interactionTarget: "computer", environment: "transport" },
			when: "2026-03-22T01:00:03.000Z",
		},
		interaction: { target: "computer", lane: "system_support", isUserFacing: false, isComputerFacing: false },
		debug: { normalizedFrom: "test" },
	};
	const userMessageEvent: OrcBusEvent = {
		kind: "agent.message",
		payload: { messageId: "msg-1", content: "I updated the user.", agentId: "agent-1" },
		envelope: {
			origin: { eventId: "message", emittedAt: "2026-03-22T01:00:04.000Z", threadId: "thread-1", runCorrelationId: "run-1", streamSequence: 5 , source: "future_replay" },
			who: { id: "agent-1", kind: "agent", label: "Worker Agent" },
			what: { category: "agent_message", name: "user_message", status: "succeeded", severity: "notice" },
			how: { channel: "stdout_jsonl", interactionTarget: "user", environment: "worker" },
			when: "2026-03-22T01:00:04.000Z",
		},
		interaction: { target: "user", lane: "agent_interacting_with_user", isUserFacing: true, isComputerFacing: false },
		debug: { normalizedFrom: "test" },
	};

	assert.equal(presentOrcEventSummary(userMessageEvent).label, "Agent responded to the user");
	assert.equal(presentOrcEventSummary(toolEvent).label, "Tool action started");
	assert.equal(presentOrcEventSummary(workerEvent).label, "Worker completed");
	assert.equal(presentOrcEventSummary(degradedTransportEvent).label, "Transport degraded");
	assert.equal(presentOrcEventSummary(recoveredTransportEvent).label, "Transport recovered");
	assert.match(presentOrcEventSummary(toolEvent).detail, /Agent started npm test\./);

	const state: OrcControlPlaneState = {
		threadId: "thread-1",
		checkpointId: "cp-7",
		phase: "checkpointed",
		project: { projectId: "proj-1", projectRoot: "/tmp/project", projectName: "Project One" },
		messages: [],
		securityEvents: [{ kind: "approval-required", statusText: "Approval required", detail: "Need approval for deploy", createdAt: "2026-03-22T01:00:05.000Z", telemetryDisposition: "approval-required", requiresOperatorAction: true, blocksExecution: true }],
		activeWave: { waveId: "wave-4", phase: "executing", startedAt: "2026-03-22T01:00:00.000Z", workerCount: 1, workerIds: [], goal: "Verify patch" },
		workerResults: [
			{ workerId: "worker-1", waveId: "wave-4", status: "completed", artifactIds: [], logIds: [] },
			{ workerId: "worker-2", waveId: "wave-4", status: "failed", artifactIds: [], logIds: [] },
		],
		verificationErrors: [],
		checkpointMetadata: { ...createInitialCheckpointMetadataSummary(), checkpointId: "cp-7", status: "captured", message: "checkpoint saved" },
		transportHealth: { ...createInitialReducedTransportHealth(), status: "healthy", lastMessage: "Runner is ready again." },
		terminalState: createInitialTerminalStateSummary(),
		lastUpdatedAt: "2026-03-22T01:00:06.000Z",
	};

	const trackerSummary = presentOrcTrackerSummary(state);
	assert.equal(trackerSummary.completedTasks.label, "1");
	assert.equal(trackerSummary.blockedTasks.label, "2");
	assert.equal(trackerSummary.signOff.label, "Blocked");
	assert.ok(trackerSummary.highlights.includes("Transport healthy"));

	const dashboard = createOrcTrackerDashboardViewModel(state);
	assert.equal(dashboard.fields.trackerSignOffStatus.value, "Blocked");
	assert.equal(dashboard.fields.blockedTasks.value, "2");
});


test("createOrcTuiTelemetrySubscriber batches bursty event-bus updates into TUI-friendly slices", async () => {
	const bus = new OrcAsyncEventBus({ component: "test-tui" });
	const subscriber = createOrcTuiTelemetrySubscriber({
		threadId: "thread-tui",
		batchWindowMs: 5,
		project: { projectId: "proj-tui", projectRoot: "/tmp/project" },
	});
	subscriber.attach(bus, { threadId: "thread-tui" });
	const notifications: string[] = [];
	const unsubscribe = subscriber.subscribe((state) => {
		notifications.push(`${state.controlPlane.phase}:${state.eventLogTail.length}`);
	});

	const mkEvent = (sequence: number, kind: OrcBusEvent["kind"], payload: Record<string, unknown>, status: OrcCanonicalEventEnvelope["what"]["status"] = "started"): OrcBusEvent => ({
		kind,
		payload: payload as any,
		envelope: {
			origin: { eventId: `tui-${sequence}`, emittedAt: `2026-03-22T02:00:0${sequence}.000Z`, threadId: "thread-tui", runCorrelationId: "run-tui", streamSequence: sequence, source: "future_replay", workerId: "worker-1", waveId: "wave-1" },
			who: { id: "agent-1", kind: kind === "transport.fault" ? "transport" : "agent", label: "Agent 1", workerId: "worker-1" },
			what: { category: "lifecycle", name: `event-${sequence}`, status, severity: kind === "transport.fault" ? "warning" : "notice", description: `event-${sequence}` },
			how: { channel: kind === "transport.fault" ? "event_bus" : "stdout_jsonl", interactionTarget: kind === "agent.message" ? "user" : "computer", environment: kind === "transport.fault" ? "transport" : "worker" },
			when: `2026-03-22T02:00:0${sequence}.000Z`,
		},
		interaction: { target: kind === "agent.message" ? "user" : "computer", lane: kind === "agent.message" ? "agent_interacting_with_user" : "agent_interacting_with_computer", isUserFacing: kind === "agent.message", isComputerFacing: kind !== "agent.message" },
		debug: { normalizedFrom: "test" },
	});

	bus.publish(mkEvent(1, "worker.status", { workerId: "worker-1", waveId: "wave-1", status: "running", summary: "Worker started" }));
	bus.publish(mkEvent(2, "agent.message", { messageId: "msg-1", content: "Progress update", workerId: "worker-1", agentId: "agent-1" }, "succeeded"));
	bus.publish(mkEvent(3, "transport.fault", { faultCode: "transport_idle_timeout", message: "Runner quiet", status: "degraded" }, "failed"));
	await new Promise((resolve) => setTimeout(resolve, 20));

	const state = subscriber.getState();
	assert.equal(notifications.length, 2);
	assert.equal(state.dashboard.fields.activeThread.value, "thread-tui");
	assert.equal(state.subagentActivity[0]?.agentId, "agent-1");
	assert.equal(state.subagentSurfaces.entries[0]?.identity.surfaceKey, "subagent:run-tui:wave-1:agent-1:worker-1");
	assert.equal(state.subagentSurfaces.focusedSurfaceKey, "subagent:run-tui:wave-1:agent-1:worker-1");
	assert.equal(state.transportHealth.status, "degraded");
	assert.deepStrictEqual(state.eventLogTail.map((entry) => entry.eventId), ["tui-3", "tui-2", "tui-1"]);
	assert.equal(state.recentErrors[0]?.eventId, "tui-3");

	unsubscribe();
	subscriber.dispose();
	bus.dispose();
});



test("createOrcTuiTelemetrySubscriber retains backgrounded subagent surfaces, collapses terminal ones, and closes deterministically", async () => {
	const bus = new OrcAsyncEventBus({ component: "test-tui-surfaces" });
	const subscriber = createOrcTuiTelemetrySubscriber({
		threadId: "thread-surfaces",
		batchWindowMs: 0,
		project: { projectId: "proj-surfaces", projectRoot: "/tmp/project-surfaces" },
	});
	subscriber.attach(bus, { threadId: "thread-surfaces" });

	const mkWorkerEvent = (sequence: number, workerId: string, agentId: string, waveId: string, status: "queued" | "running" | "completed" | "failed"): OrcBusEvent => ({
		kind: "worker.status",
		payload: { workerId, waveId, status, summary: `${workerId}-${status}` },
		envelope: {
			origin: { eventId: `surface-${sequence}`, emittedAt: `2026-03-22T04:00:0${sequence}.000Z`, threadId: "thread-surfaces", runCorrelationId: "run-surfaces", streamSequence: sequence, source: "future_replay", workerId, waveId },
			who: { id: agentId, kind: "agent", label: `Agent ${agentId}`, workerId },
			what: { category: "lifecycle", name: `worker-${status}`, status: status === "failed" ? "failed" : status === "completed" ? "succeeded" : "started", severity: status === "failed" ? "error" : "notice", description: `${workerId} ${status}` },
			how: { channel: "stdout_jsonl", interactionTarget: "computer", environment: "worker" },
			when: `2026-03-22T04:00:0${sequence}.000Z`,
		},
		interaction: { target: "computer", lane: "agent_interacting_with_computer", isUserFacing: false, isComputerFacing: true },
		debug: { normalizedFrom: "test" },
	});

	bus.publish(mkWorkerEvent(1, "worker-1", "agent-1", "wave-1", "queued"));
	bus.publish(mkWorkerEvent(2, "worker-2", "agent-2", "wave-1", "running"));
	await new Promise((resolve) => setTimeout(resolve, 5));

	let state = subscriber.getState();
	assert.deepStrictEqual(state.subagentSurfaces.stackedSurfaceKeys, [
		"subagent:run-surfaces:wave-1:agent-1:worker-1",
		"subagent:run-surfaces:wave-1:agent-2:worker-2",
	]);
	assert.equal(state.subagentSurfaces.focusedSurfaceKey, "subagent:run-surfaces:wave-1:agent-2:worker-2");

	subscriber.focusSubagentSurface("subagent:run-surfaces:wave-1:agent-1:worker-1");
	state = subscriber.getState();
	assert.equal(state.subagentSurfaces.focusedSurfaceKey, "subagent:run-surfaces:wave-1:agent-1:worker-1");
	assert.deepStrictEqual(state.subagentSurfaces.stackedSurfaceKeys, [
		"subagent:run-surfaces:wave-1:agent-2:worker-2",
		"subagent:run-surfaces:wave-1:agent-1:worker-1",
	]);

	bus.publish(mkWorkerEvent(3, "worker-2", "agent-2", "wave-1", "completed"));
	await new Promise((resolve) => setTimeout(resolve, 5));
	state = subscriber.getState();
	const completed = state.subagentSurfaces.entries.find((entry) => entry.identity.workerId === "worker-2");
	assert.equal(completed?.retention, "collapsed-summary");
	assert.ok(state.subagentSurfaces.summaryRowKeys.includes("subagent:run-surfaces:wave-1:agent-2:worker-2"));

	bus.publish(mkWorkerEvent(4, "worker-1", "agent-1", "wave-1", "failed"));
	await new Promise((resolve) => setTimeout(resolve, 5));
	state = subscriber.getState();
	const failed = state.subagentSurfaces.entries.find((entry) => entry.identity.workerId === "worker-1");
	assert.equal(failed?.retention, "background");
	assert.equal(failed?.status, "failed");

	subscriber.closeSubagentSurface("subagent:run-surfaces:wave-1:agent-1:worker-1");
	state = subscriber.getState();
	assert.equal(state.subagentSurfaces.focusedSurfaceKey, undefined);
	assert.deepStrictEqual(state.subagentSurfaces.stackedSurfaceKeys, []);
	assert.equal(state.subagentSurfaces.entries.find((entry) => entry.identity.workerId === "worker-1")?.retention, "closed");

	subscriber.dispose();
	bus.dispose();
});

test("createOrcTuiTelemetrySubscriber resets transient overlays and tails when the operator switches threads", async () => {
	const bus = new OrcAsyncEventBus({ component: "test-tui-switch" });
	const subscriber = createOrcTuiTelemetrySubscriber({
		threadId: "thread-a",
		batchWindowMs: 0,
		project: { projectId: "proj-a", projectRoot: "/tmp/project-a" },
	});
	subscriber.attach(bus, { threadId: "thread-a" });

	bus.publish({
		kind: "tool.call",
		payload: { callId: "call-1", toolName: "npm test", workerId: "worker-a", agentId: "agent-a" },
		envelope: {
			origin: { eventId: "call-1", emittedAt: "2026-03-22T03:00:00.000Z", threadId: "thread-a", runCorrelationId: "run-a", streamSequence: 1, source: "future_replay", workerId: "worker-a", waveId: "wave-a" },
			who: { id: "agent-a", kind: "agent", label: "Agent A", workerId: "worker-a" },
			what: { category: "tool_call", name: "tool_call", status: "started", severity: "info", description: "tool call" },
			how: { channel: "stdout_jsonl", interactionTarget: "computer", environment: "worker", toolName: "npm test", toolCallId: "call-1" },
			when: "2026-03-22T03:00:00.000Z",
		},
		interaction: { target: "computer", lane: "agent_interacting_with_computer", isUserFacing: false, isComputerFacing: true },
		debug: { normalizedFrom: "test" },
	});
	await new Promise((resolve) => setTimeout(resolve, 10));

	assert.equal(subscriber.getState().eventLogTail.length, 1);
	assert.equal(subscriber.getState().transportHealth.status, "unknown");

	subscriber.switchThread("thread-b", {
		threadId: "thread-b",
		phase: "bootstrapping",
		project: { projectId: "proj-b", projectRoot: "/tmp/project-b" },
		messages: [],
		securityEvents: [],
		workerResults: [],
		verificationErrors: [],
		checkpointMetadata: createInitialCheckpointMetadataSummary(),
		transportHealth: createInitialReducedTransportHealth(),
		terminalState: createInitialTerminalStateSummary(),
		lastUpdatedAt: "2026-03-22T03:00:01.000Z",
	});

	const state = subscriber.getState();
	assert.equal(state.threadId, "thread-b");
	assert.equal(state.eventLogTail.length, 0);
	assert.equal(state.overlays.visibleEntries.length, 0);
	assert.equal(state.controlPlane.phase, "bootstrapping");

	subscriber.dispose();
	bus.dispose();
});


test("runtime publishes canonical terminal events once and keeps tracker state converged for cancellation/disconnect classes", async () => {
	const transport = new StubOrcPythonTransport();
	const runtime = new OrcRuntimeSkeleton({ createPythonTransport: () => transport });
	const launched = await runtime.launch({
		project: { projectId: "proj-runtime", projectRoot: "/tmp/project-runtime" },
		prompt: "test convergence",
	});
	const session = runtime.getSession(launched.threadId) as OrcSessionHandle;
	const busSnapshotBefore = session.getRuntimeHooks()?.getEventBusSnapshot();
	assert.equal(busSnapshotBefore?.publishedEvents, 2);

	transport.emitLifecycleEvent({
		stage: "terminated",
		at: "2026-03-22T06:00:00.000Z",
		threadId: launched.threadId,
		runCorrelationId: transport.health.runCorrelationId,
		signal: "SIGTERM",
		reason: "cancel_requested_by_user",
	});
	transport.emitLifecycleEvent({
		stage: "terminated",
		at: "2026-03-22T06:00:00.000Z",
		threadId: launched.threadId,
		runCorrelationId: transport.health.runCorrelationId,
		signal: "SIGTERM",
		reason: "cancel_requested_by_user",
	});
	await flushAsyncWork();

	const finalState = session.getState();
	assert.equal(finalState?.terminalState.status, "cancelled");
	assert.equal(finalState?.terminalState.failureCode, "transport_user_cancellation");
	assert.equal(finalState?.transportHealth.status, "healthy");
	assert.equal(finalState?.terminalState.retryability, ORC_FAILURE_DISPOSITIONS.transport_user_cancellation.retryability);

	const busSnapshotAfter = session.getRuntimeHooks()?.getEventBusSnapshot();
	assert.equal(busSnapshotAfter?.publishedEvents, 3);

	await runtime.dispose();
});

test("failure disposition matrix records Phase 2 retryability decisions for terminal fault classes", () => {
	assert.equal(ORC_FAILURE_DISPOSITIONS.transport_startup_failure.retryability, "phase_2_retryable");
	assert.equal(ORC_FAILURE_DISPOSITIONS.transport_disconnect.retryability, "phase_3_recovery");
	assert.equal(ORC_FAILURE_DISPOSITIONS.transport_non_zero_exit.retryability, "phase_3_recovery");
	assert.equal(ORC_FAILURE_DISPOSITIONS.transport_user_cancellation.retryability, "phase_2_retryable");
	assert.equal(ORC_FAILURE_DISPOSITIONS.transport_ambiguous_terminal_state.retryability, "phase_3_recovery");
	assert.match(ORC_FAILURE_DISPOSITIONS.transport_broken_pipe.remediationHint, /pipe/i);
});


test("security telemetry distinguishes informational notices from approval and blocked policy states", () => {
	const notice = mapCommandInterceptorResultToOrcSecurityEvent({
		decision: "allow_with_notice",
		message: "Command is allowed but leaves the workspace sandbox.",
		command: "git status",
		workerId: "worker-sec",
		createdAt: "2026-03-23T01:00:00.000Z",
	});
	const approval = mapCommandInterceptorResultToOrcSecurityEvent({
		decision: "require_approval",
		message: "Approval is required before running npm publish.",
		command: "npm publish",
		workerId: "worker-sec",
		createdAt: "2026-03-23T01:00:01.000Z",
	});
	const blocked = mapCommandInterceptorResultToOrcSecurityEvent({
		decision: "block",
		message: "Blocked rm -rf / by policy.",
		command: "rm -rf /",
		workerId: "worker-sec",
		createdAt: "2026-03-23T01:00:02.000Z",
	});

	assert.equal(notice.kind, "informational-notice");
	assert.equal(notice.blocksExecution, false);
	assert.equal(approval.kind, "approval-required");
	assert.equal(approval.blocksExecution, true);
	assert.equal(blocked.kind, "blocked-command");
	assert.equal(blocked.telemetryDisposition, "blocked");

	const state: OrcControlPlaneState = {
		threadId: "thread-sec",
		phase: "executing",
		project: { projectId: "proj-sec", projectRoot: "/tmp/project-sec" },
		messages: [],
		securityEvents: [notice, approval, blocked],
		workerResults: [],
		verificationErrors: [],
		checkpointMetadata: createInitialCheckpointMetadataSummary(),
		transportHealth: createInitialReducedTransportHealth(),
		terminalState: createInitialTerminalStateSummary(),
		lastUpdatedAt: "2026-03-23T01:00:03.000Z",
	};
	const summary = presentOrcTrackerSummary(state);
	assert.equal(summary.blockedTasks.label, "2");
	assert.equal(summary.signOff.label, "Blocked");
	assert.equal(summary.phase.label, "Blocked By Policy");
	assert.match(presentOrcEventSummary({
		kind: "security.approval",
		payload: { event: notice },
		envelope: {
			origin: { eventId: "notice-1", emittedAt: notice.createdAt, threadId: "thread-sec", runCorrelationId: "run-sec", streamSequence: 1, source: "future_replay" },
			who: { id: "agent-sec", kind: "agent", label: "Security Agent", workerId: "worker-sec" },
			what: { category: "security", name: "security_notice", status: "succeeded", severity: "notice" },
			how: { channel: "event_bus", interactionTarget: "computer", environment: "worker" },
			when: notice.createdAt,
		},
		interaction: { target: "computer", lane: "agent_interacting_with_computer", isUserFacing: false, isComputerFacing: true },
		debug: { normalizedFrom: "test" },
	} as OrcBusEvent).label, /Security notice/);
});


test("orc graph routes malformed StructuralBlueprint payloads to contract_error and records validation issues", async () => {
	const saved: OrcMasterState[] = [];
	const graph = build_orc_graph({
		checkpointer: {
			async save(state) {
				saved.push({ ...state });
			},
		},
		storeHooks: {
			async onContractError(state) {
				saved.push({ ...state });
			},
		},
		executors: {
			async route() {
				return {
					targetGuildMember: "architect",
					reason: "needs planning",
					decision: "dispatch" as const,
					activeGuildMember: {
						memberId: "guild-1",
						role: "architect",
						sessionId: "session-1",
						activatedAt: "2026-03-25T00:00:00.000Z",
					},
					contractPayload: {
						contractId: "StructuralBlueprint" as const,
						taskId: "task-1",
						handoffToken: "token-1",
						payload: {
							objective: "",
							scope: ["repo"],
							constraints: ["read-only"],
							deliverables: ["plan"],
						},
					},
				};
			},
			async dispatch() {
				throw new Error("dispatch should not execute when route contract fails");
			},
			async verify() {
				throw new Error("verify should not execute");
			},
			async complete() {
				return { summary: "done" };
			},
		},
	});

	const initial: OrcMasterState = {
		threadId: "thread-contract-1",
		runCorrelationId: "run-contract-1",
		next: "route",
		memoryRoute: { mode: "filesystem" },
		routing: { taskType: "general", requestedBy: "orc", chainOfCustody: [] },
		retries: { attempt: 0, maxAttempts: 1 },
	};

	const next = await graph.step(initial);
	assert.equal(next.next, "contract_error");
	assert.equal(next.contractValidationFailure?.contractId, "StructuralBlueprint");
	assert.equal(next.contractValidationFailure?.node, "route");
	assert.ok((next.contractValidationFailure?.issues.length ?? 0) > 0);
	assert.match(next.failureSummary ?? "", /Contract validation failed/);
	assert.ok(saved.length >= 1);
});

test("orc graph prevents verify transition when ReconReport contract is invalid", async () => {
	let verifyCalls = 0;
	const graph = build_orc_graph({
		checkpointer: { async save() {} },
		executors: {
			async route() {
				return {
					targetGuildMember: "architect",
					reason: "normal flow",
					decision: "dispatch" as const,
					activeGuildMember: {
						memberId: "guild-2",
						role: "architect",
						sessionId: "session-2",
						activatedAt: "2026-03-25T01:00:00.000Z",
					},
					contractPayload: {
						contractId: "StructuralBlueprint" as const,
						taskId: "task-2",
						handoffToken: "token-2",
						payload: {
							objective: "produce report",
							scope: ["module"],
							constraints: ["strict"],
							deliverables: ["recon"],
						},
					},
				};
			},
			async dispatch() {
				return {
					notes: "dispatched",
					reconReport: {
						summary: "",
						findings: ["f1"],
						recommendations: ["r1"],
					},
				};
			},
			async verify() {
				verifyCalls += 1;
				return { decision: "complete" as const, notes: "ok" };
			},
			async complete() {
				return { summary: "done" };
			},
		},
	});

	const routed = await graph.step({
		threadId: "thread-contract-2",
		runCorrelationId: "run-contract-2",
		next: "route",
		memoryRoute: { mode: "filesystem" },
		routing: { taskType: "general", requestedBy: "orc", chainOfCustody: [] },
		retries: { attempt: 0, maxAttempts: 1 },
	});
	assert.equal(routed.next, "dispatch");

	const dispatched = await graph.step(routed);
	assert.equal(dispatched.next, "contract_error");
	assert.equal(dispatched.contractValidationFailure?.contractId, "ReconReport");
	assert.equal(verifyCalls, 0);
});
