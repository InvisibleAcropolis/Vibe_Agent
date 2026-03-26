import assert from "node:assert";
import { describe, it } from "node:test";
import type { RpcAgentRuntimeState, RpcAgentRole, RpcProcessLauncher, RpcTelemetryEnvelope } from "../src/orchestration/bridge/rpc_launcher.js";
import type { TerminalPaneMetadata, TerminalPaneOrchestrator } from "../src/orchestration/terminal/pane_orchestrator.js";
import {
	ALCHEMIST_SUBAGENT_CONFIG,
	ARCHITECT_SUBAGENT_CONFIG,
	classifyToolDomain,
	evaluateToolPolicyViolation,
	INQUISITOR_SUBAGENT_CONFIG,
	MECHANIC_SUBAGENT_CONFIG,
	ORC_SUBAGENT_TOOL_POLICY_MAP,
	ORC_GUILD_SUBAGENT_REGISTRY,
	ORC_GUILD_SUBAGENT_REGISTRY_ENTRIES,
	OrcMalformedSubagentTaskRequestError,
	OrcSubagentRouter,
	OrcSubagentToolPolicyViolationError,
	OrcUnknownSubagentError,
	validateSubagentToolPolicyRegistry,
	VIBE_CURATOR_SUBAGENT_CONFIG,
} from "../src/orchestration/graph/subagents/index.js";

class FakeRpcLauncher implements Pick<RpcProcessLauncher, "startAgent" | "getAgentState"> {
	readonly startCalls: RpcAgentRole[] = [];
	private readonly states = new Map<RpcAgentRole, RpcAgentRuntimeState>();

	constructor() {
		this.states.set("inquisitor", this.createState("inquisitor", "inquisitor-main", "inq-instance"));
		this.states.set("scout", this.createState("scout", "scout-main", "sct-instance"));
		this.states.set("alchemist", this.createState("alchemist", "alchemist-main", "alc-instance"));
		this.states.set("architect", this.createState("architect", "architect-main", "arc-instance"));
		this.states.set("mechanic", this.createState("mechanic", "mechanic-main", "mec-instance"));
	}

	startAgent(role: RpcAgentRole): RpcAgentRuntimeState {
		this.startCalls.push(role);
		const state = this.states.get(role);
		if (!state) {
			throw new Error(`missing state for ${role}`);
		}
		return state;
	}

	getAgentState(role: RpcAgentRole): RpcAgentRuntimeState {
		const state = this.states.get(role);
		if (!state) {
			throw new Error(`missing state for ${role}`);
		}
		return state;
	}

	private createState(role: RpcAgentRole, agentId: string, instanceId: string): RpcAgentRuntimeState {
		return {
			identity: {
				agentRole: role,
				agentId,
				instanceId,
				launchAttempt: 0,
				pid: 2101,
			},
			status: "running",
			restartCount: 0,
		};
	}
}

class FakePaneOrchestrator implements Pick<TerminalPaneOrchestrator, "splitVertical"> {
	readonly calls: Array<{ role: string; agentId: string | null }> = [];

	async splitVertical(role: "primary" | "secondary" | "observer" | "custom", agentBinding: { agentId: string } | null = null): Promise<TerminalPaneMetadata> {
		this.calls.push({ role, agentId: agentBinding?.agentId ?? null });
		return {
			paneId: "%router-pane",
			role,
			createdAt: new Date("2026-03-26T00:00:00.000Z"),
			agentBinding: agentBinding ? { agentId: agentBinding.agentId, boundAt: new Date("2026-03-26T00:00:00.000Z") } : null,
		};
	}
}

describe("subagent configs", () => {
	it("defines explicit guild registry entries and dedicated prompts/toolsets", () => {
		assert.equal(ORC_GUILD_SUBAGENT_REGISTRY_ENTRIES.length, 9);
		assert.deepEqual(INQUISITOR_SUBAGENT_CONFIG.toolset, ["write", "execute"]);
		assert.deepEqual(INQUISITOR_SUBAGENT_CONFIG.taskTypes, ["execution"]);
		assert.deepEqual(ALCHEMIST_SUBAGENT_CONFIG.toolset, ["read", "refactor"]);
		assert.deepEqual(ARCHITECT_SUBAGENT_CONFIG.toolset, ["read", "search", "write", "scaffold", "typegen"]);
		assert.match(ARCHITECT_SUBAGENT_CONFIG.prompt.system, /emit only valid StructuralBlueprint contracts/i);
		assert.match(MECHANIC_SUBAGENT_CONFIG.prompt.system, /reliability engineer/i);
		assert.equal(VIBE_CURATOR_SUBAGENT_CONFIG.displayName, "Vibe Curator");
	});

	it("validates policy map as pure data and classifies tool domains deterministically", () => {
		validateSubagentToolPolicyRegistry(ORC_GUILD_SUBAGENT_REGISTRY);
		assert.deepEqual(ORC_SUBAGENT_TOOL_POLICY_MAP.scout.allowedDomains, ["read", "recon", "lsp"]);
		assert.deepEqual(ORC_SUBAGENT_TOOL_POLICY_MAP.architect.allowedDomains, ["read", "recon", "lsp", "scaffold", "typegen"]);
		assert.deepEqual(ORC_SUBAGENT_TOOL_POLICY_MAP.alchemist.allowedDomains, ["read", "recon", "lsp", "refactor"]);
		assert.equal(classifyToolDomain("lsp_hover"), "lsp");
		assert.equal(classifyToolDomain("scaffold_directory_tree"), "scaffold");
		assert.equal(classifyToolDomain("create_type_definitions"), "typegen");
		assert.equal(classifyToolDomain("vitest"), "test");
		assert.equal(classifyToolDomain("totally_unknown_tool"), undefined);
		assert.equal(
			evaluateToolPolicyViolation({ role: "scout", toolName: "vitest" })?.detectedDomain,
			"test",
		);
		assert.equal(
			evaluateToolPolicyViolation({ role: "architect", toolName: "edit_file_lines" })?.detectedDomain,
			"edit",
		);
		assert.equal(evaluateToolPolicyViolation({ role: "scout", toolName: "grep" }), undefined);
		assert.equal(evaluateToolPolicyViolation({ role: "scout", toolName: "edit_file_lines" })?.detectedDomain, "edit");
		assert.equal(evaluateToolPolicyViolation({ role: "scout", toolName: "lsp_hover" }), undefined);
		assert.equal(evaluateToolPolicyViolation({ role: "architect", toolName: "scaffold_directory_tree" }), undefined);
	});
});

describe("OrcSubagentRouter", () => {
	it("routes through one dispatch path and returns structured outputs", async () => {
		const rpcLauncher = new FakeRpcLauncher();
		const paneOrchestrator = new FakePaneOrchestrator();
		const router = new OrcSubagentRouter({
			rpcLauncher,
			paneOrchestrator,
			routerNow: () => new Date("2026-03-26T01:02:03.000Z"),
		});

		const readSession = await router.routeTask({ taskId: "task-read", taskType: "semantic_search" });
		const executeResult = await router.invokeSpawnTask({
			taskId: "task-exec",
			taskType: "execution",
			subagentName: "inquisitor",
		});

		assert.equal(readSession.subagentRole, "scout");
		assert.equal(executeResult.session.subagentRole, "inquisitor");
		assert.equal(executeResult.structuredOutput.kind, "subagent_dispatch_v1");
		assert.deepEqual(rpcLauncher.startCalls, ["scout", "inquisitor"]);
		assert.deepEqual(router.getMiddlewareOrder(), ["request_validation", "registry_guard", "structured_output"]);
		assert.deepEqual(paneOrchestrator.calls, [
			{ role: "secondary", agentId: "scout-main" },
			{ role: "secondary", agentId: "inquisitor-main" },
		]);
	});

	it("rejects unknown subagent names and malformed spawn requests before execution", async () => {
		const rpcLauncher = new FakeRpcLauncher();
		const router = new OrcSubagentRouter({
			rpcLauncher,
			paneOrchestrator: new FakePaneOrchestrator(),
			routerNow: () => new Date("2026-03-26T01:02:03.000Z"),
		});

		await assert.rejects(
			() =>
				router.invokeSpawnTask({
					taskId: "task-unknown",
					taskType: "general",
					subagentName: "unknown" as never,
				}),
			(error: unknown) => error instanceof OrcUnknownSubagentError,
		);
		await assert.rejects(
			() =>
				router.invokeSpawnTask({
					taskId: "",
					taskType: "general",
					subagentName: "inquisitor",
				}),
			(error: unknown) => error instanceof OrcMalformedSubagentTaskRequestError,
		);
		assert.equal(rpcLauncher.startCalls.length, 0);
	});

	it("binds telemetry streams using subagent identity", async () => {
		const router = new OrcSubagentRouter({
			rpcLauncher: new FakeRpcLauncher(),
			paneOrchestrator: new FakePaneOrchestrator(),
			routerNow: () => new Date("2026-03-26T01:02:03.000Z"),
		});

		const session = await router.routeTask({ taskId: "task-read", taskType: "repo_index" });
		const telemetry: RpcTelemetryEnvelope = {
			schema: "pi.rpc.telemetry.v1",
			eventId: "evt-1",
			emittedAt: "2026-03-26T01:02:04.000Z",
			source: {
				agentRole: "scout",
				agentId: "scout-main",
				instanceId: "sct-instance",
				launchAttempt: 0,
			},
			telemetry: {
				kind: "progress",
				severity: "info",
				payload: { step: "indexed" },
			},
		};

		const bound = router.bindTelemetry(telemetry);
		assert.equal(bound?.session.sessionId, session.sessionId);
	});

	it("rejects disallowed runtime tool calls with explicit policy errors", async () => {
		const diagnostics: Record<string, unknown>[] = [];
		const router = new OrcSubagentRouter({
			rpcLauncher: new FakeRpcLauncher(),
			paneOrchestrator: new FakePaneOrchestrator(),
			onDiagnostic(entry) {
				diagnostics.push(entry);
			},
			routerNow: () => new Date("2026-03-26T01:02:03.000Z"),
		});

		await router.routeTask({ taskId: "task-scout", taskType: "repo_index" });
		const violatingToolCall: RpcTelemetryEnvelope = {
			schema: "pi.rpc.telemetry.v1",
			eventId: "evt-tool-1",
			emittedAt: "2026-03-26T01:02:05.000Z",
			source: {
				agentRole: "scout",
				agentId: "scout-main",
				instanceId: "sct-instance",
				launchAttempt: 0,
			},
			telemetry: {
				kind: "tool_call",
				severity: "warning",
				payload: {
					toolName: "npm install",
				},
			},
		};

		assert.throws(
			() => router.bindTelemetry(violatingToolCall),
			(error: unknown) => error instanceof OrcSubagentToolPolicyViolationError,
		);
		assert.equal(diagnostics.some((entry) => entry.event === "subagent.policy_violation"), true);
	});
});
