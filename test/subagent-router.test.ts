import assert from "node:assert";
import { describe, it } from "node:test";
import type { RpcAgentRuntimeState, RpcAgentRole, RpcProcessLauncher, RpcTelemetryEnvelope } from "../src/orchestration/bridge/rpc_launcher.js";
import type { TerminalPaneMetadata, TerminalPaneOrchestrator } from "../src/orchestration/terminal/pane_orchestrator.js";
import { ALCHEMIST_SUBAGENT_CONFIG, INQUISITOR_SUBAGENT_CONFIG, OrcSubagentRouter } from "../src/orchestration/graph/subagents/index.js";

class FakeRpcLauncher implements Pick<RpcProcessLauncher, "startAgent" | "getAgentState"> {
	readonly startCalls: RpcAgentRole[] = [];
	private readonly states = new Map<RpcAgentRole, RpcAgentRuntimeState>();

	constructor() {
		this.states.set("inquisitor", this.createState("inquisitor", "inquisitor-main", "inq-instance"));
		this.states.set("alchemist", this.createState("alchemist", "alchemist-main", "alc-instance"));
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
				pid: role === "inquisitor" ? 2101 : 2102,
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
	it("defines dedicated prompts and toolsets for Inquisitor and Alchemist", () => {
		assert.deepEqual(INQUISITOR_SUBAGENT_CONFIG.toolset, ["index", "search", "read"]);
		assert.deepEqual(ALCHEMIST_SUBAGENT_CONFIG.toolset, ["write", "refactor", "execute"]);
		assert.match(INQUISITOR_SUBAGENT_CONFIG.prompt.system, /repository intelligence/i);
		assert.match(ALCHEMIST_SUBAGENT_CONFIG.prompt.system, /transformation specialist/i);
	});
});

describe("OrcSubagentRouter", () => {
	it("routes read-heavy task types to Inquisitor and execute-heavy task types to Alchemist", async () => {
		const rpcLauncher = new FakeRpcLauncher();
		const paneOrchestrator = new FakePaneOrchestrator();
		const router = new OrcSubagentRouter({
			rpcLauncher,
			paneOrchestrator,
			routerNow: () => new Date("2026-03-26T01:02:03.000Z"),
		});

		const readSession = await router.routeTask({ taskId: "task-read", taskType: "semantic_search" });
		const writeSession = await router.routeTask({ taskId: "task-write", taskType: "execution" });

		assert.equal(readSession.subagentRole, "inquisitor");
		assert.equal(writeSession.subagentRole, "alchemist");
		assert.deepEqual(rpcLauncher.startCalls, ["inquisitor", "alchemist"]);
		assert.deepEqual(paneOrchestrator.calls, [
			{ role: "secondary", agentId: "inquisitor-main" },
			{ role: "secondary", agentId: "alchemist-main" },
		]);
		assert.equal(typeof readSession.correlationId, "string");
		assert.equal(readSession.processPid, 2101);
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
				agentRole: "inquisitor",
				agentId: "inquisitor-main",
				instanceId: "inq-instance",
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
		assert.equal(bound?.session.paneId, "%router-pane");

		const unrelated = router.bindTelemetry({
			...telemetry,
			source: {
				...telemetry.source,
				agentId: "unexpected",
				instanceId: "unknown-instance",
			},
		});
		assert.equal(unrelated, undefined);
	});
});
