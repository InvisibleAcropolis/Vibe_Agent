import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RpcEventCurator, parseCuratorRpcEvent } from "../src/orchestration/bridge/curator.js";

test("RpcEventCurator tracks state per agent and pane with accumulated deltas", () => {
	let now = 1_710_000_000_000;
	const curator = new RpcEventCurator({ now: () => now, watchdogMs: 1_000 });

	curator.handleRpcEvent({ type: "agent_start", agentId: "orc", paneId: "left", taskId: "task-1" });
	now += 20;
	curator.handleRpcEvent({ type: "turn_start", agentId: "orc", paneId: "left", turnId: "turn-1" });
	now += 20;
	curator.handleRpcEvent({
		type: "message_update",
		agentId: "orc",
		paneId: "left",
		messageId: "msg-1",
		delta: { text: "Hello ", thinking: "plan", toolCall: { id: "call-1", name: "read", argumentsDelta: "{\"path\":\"" } },
	});
	curator.handleRpcEvent({
		type: "message_update",
		agentId: "orc",
		paneId: "left",
		delta: { text: "world", toolCall: { id: "call-1", argumentsDelta: "README.md\"}" } },
	});
	curator.handleRpcEvent({
		type: "tool_execution_update",
		agentId: "orc",
		paneId: "left",
		toolCallId: "call-1",
		toolName: "read",
		status: "running",
		partialOutput: "chunk-1",
	});
	curator.handleRpcEvent({
		type: "tool_execution_update",
		agentId: "orc",
		paneId: "left",
		toolCallId: "call-1",
		status: "completed",
		partialOutput: "final-output",
	});
	now += 60;
	const final = curator.handleRpcEvent({
		type: "agent_end",
		agentId: "orc",
		paneId: "left",
		finishReason: "completed",
	});

	assert.equal(final.status, "ended");
	assert.equal(final.finishReason, "completed");
	assert.equal(final.message.text, "Hello world");
	assert.equal(final.message.thinking, "plan");
	assert.equal(final.message.toolCalls.length, 1);
	assert.equal(final.message.toolCalls[0]?.arguments, "{\"path\":\"README.md\"}");
	assert.equal(final.toolExecutions.length, 1);
	assert.equal(final.toolExecutions[0]?.output, "final-output");
	assert.equal(final.toolExecutions[0]?.status, "completed");
	assert.equal(final.timing.taskDurationMs, 100);
	assert.equal(final.timing.lastTurnDurationMs, 80);
	assert.equal(final.signal.key, "water:completed");
});

test("RpcEventCurator keeps agent/pane state isolated", () => {
	let now = 100;
	const curator = new RpcEventCurator({ now: () => now, watchdogMs: 10_000 });
	curator.handleRpcEvent({ type: "agent_start", agentId: "orc", paneId: "left" });
	curator.handleRpcEvent({ type: "agent_start", agentId: "orc", paneId: "right" });
	curator.handleRpcEvent({ type: "message_update", agentId: "orc", paneId: "left", delta: { text: "L" } });
	curator.handleRpcEvent({ type: "message_update", agentId: "orc", paneId: "right", delta: { text: "R" } });
	now += 5;
	curator.handleRpcEvent({ type: "agent_end", agentId: "orc", paneId: "right", reason: "cancelled" });

	const left = curator.getPaneSnapshot("orc", "left");
	const right = curator.getPaneSnapshot("orc", "right");
	assert.equal(left?.status, "running");
	assert.equal(left?.message.text, "L");
	assert.equal(right?.status, "ended");
	assert.equal(right?.message.text, "R");
	assert.equal(right?.finishReason, "cancelled");
	assert.equal(right?.signal.key, "water:cancelled");
});

test("RpcEventCurator watchdog marks timed out panes and emits snapshot", async () => {
	const emitted: string[] = [];
	const diagnostics: Record<string, unknown>[] = [];
	const curator = new RpcEventCurator({
		watchdogMs: 20,
		now: () => Date.now(),
		onSnapshot: (snapshot) => emitted.push(snapshot.status),
		onDiagnostic: (entry) => diagnostics.push(entry),
	});

	curator.handleRpcEvent({ type: "agent_start", agentId: "orc", paneId: "left", graphNodeId: "graph-node-1", processPid: 4411, correlationId: "corr-1" });
	await new Promise((resolve) => setTimeout(resolve, 30));

	const snapshot = curator.getPaneSnapshot("orc", "left");
	assert.equal(snapshot?.status, "timed_out");
	assert.equal(snapshot?.finishReason, "timeout");
	assert.equal(snapshot?.timing.timedOut, true);
	assert.equal(snapshot?.graphNodeId, "graph-node-1");
	assert.equal(snapshot?.processPid, 4411);
	assert.equal(snapshot?.correlationId, "corr-1");
	assert.ok(emitted.includes("timed_out"));
	assert.equal(diagnostics.some((entry) => entry.kind === "stalled_tool_watchdog"), true);
	curator.dispose();
});

test("parseCuratorRpcEvent validates required routing keys", () => {
	assert.equal(parseCuratorRpcEvent({ type: "agent_start", agentId: "a", paneId: "p" })?.type, "agent_start");
	assert.equal(parseCuratorRpcEvent({ type: "auto_retry_start", agentId: "a", paneId: "p", attempt: 1, maxAttempts: 3 })?.type, "auto_retry_start");
	assert.equal(parseCuratorRpcEvent({ type: "agent_start", paneId: "p" }), undefined);
	assert.equal(parseCuratorRpcEvent({ type: "other", agentId: "a", paneId: "p" }), undefined);
	assert.equal(parseCuratorRpcEvent({ type: "auto_retry_end", agentId: "a", paneId: "p", success: "yes" }), undefined);
});

test("RpcEventCurator persists and consumes memory artifacts on agent_end", () => {
	const memoryRootDir = mkdtempSync(join(tmpdir(), "orc-memory-"));
	let now = 1_710_100_000_000;
	const curator = new RpcEventCurator({ now: () => now, watchdogMs: 5_000, memoryRootDir });

	curator.handleRpcEvent({ type: "agent_start", agentId: "orc", paneId: "planner", taskId: "thread-1" });
	curator.handleRpcEvent({ type: "message_update", agentId: "orc", paneId: "planner", messageId: "msg-1", delta: { text: "Finished planning." } });
	curator.handleRpcEvent({
		type: "tool_execution_update",
		agentId: "orc",
		paneId: "planner",
		toolCallId: "call-1",
		toolName: "write_file",
		status: "completed",
		partialOutput: "created plan.md",
	});
	now += 10;
	const snapshot = curator.handleRpcEvent({ type: "agent_end", agentId: "orc", paneId: "planner", finishReason: "completed" });

	assert.equal(snapshot.globalPlanState?.status, "completed");
	assert.equal(snapshot.globalPlanState?.completed.includes("planner"), true);
	assert.equal(snapshot.globalPlanState?.summary, "Finished planning.");
});

test("RpcEventCurator maps retry and recovery events to deterministic signals", () => {
	const curator = new RpcEventCurator({ now: () => 1_710_000_000_000, watchdogMs: 1_000 });
	curator.handleRpcEvent({ type: "agent_start", agentId: "orc", paneId: "left" });
	const retrying = curator.handleRpcEvent({
		type: "auto_retry_start",
		agentId: "orc",
		paneId: "left",
		attempt: 1,
		maxAttempts: 3,
		errorMessage: "overloaded",
	});
	assert.equal(retrying.signal.key, "fire:retrying");
	assert.equal(retrying.signal.retryAttempt, 1);

	const recovering = curator.handleRpcEvent({
		type: "auto_retry_end",
		agentId: "orc",
		paneId: "left",
		success: true,
		attempt: 1,
	});
	assert.equal(recovering.signal.key, "water:recovering");
	assert.equal(recovering.signal.failureActive, false);
});

test("RpcEventCurator enqueueRpcEvent ingests stream events without blocking caller", async () => {
	const snapshots: string[] = [];
	const curator = new RpcEventCurator({
		now: () => 1_710_000_000_000,
		watchdogMs: 1_000,
		onSnapshot: (snapshot) => snapshots.push(snapshot.signal.key),
	});
	curator.enqueueRpcEvent({ type: "agent_start", agentId: "orc", paneId: "left" });
	curator.enqueueRpcEvent({ type: "auto_retry_start", agentId: "orc", paneId: "left", attempt: 1 });
	assert.equal(snapshots.length, 0);

	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(snapshots.length, 2);
	assert.deepEqual(snapshots, ["water:active", "fire:retrying"]);
});
