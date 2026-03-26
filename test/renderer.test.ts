import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CuratorDashboardOutput, renderCuratorDashboardFrame } from "../src/orchestration/bridge/renderer.js";
import type { CuratorSnapshot } from "../src/orchestration/bridge/curator.js";

function createSnapshot(overrides: Partial<CuratorSnapshot> = {}): CuratorSnapshot {
	return {
		agentId: "orc",
		paneId: "%10",
		status: "running",
		taskId: "task-1",
		turnId: "turn-1",
		messageId: "msg-1",
		lastEventType: "message_update",
		lastEventAt: "2026-03-26T00:00:00.000Z",
		finishReason: undefined,
		timing: {
			taskDurationMs: 100,
			currentTurnDurationMs: 50,
			lastTurnDurationMs: undefined,
			timedOut: false,
		},
		message: {
			text: "hello",
			thinking: "think",
			toolCalls: [],
		},
		toolExecutions: [
			{ toolCallId: "t-1", toolName: "read", status: "running", output: "", updatedAt: "2026-03-26T00:00:00.000Z" },
		],
		...overrides,
	};
}

test("renderCuratorDashboardFrame renders deterministic ASCII rows with compaction alert", () => {
	const frame = renderCuratorDashboardFrame(
		{
			snapshots: [createSnapshot(), createSnapshot({ agentId: "alchemist", paneId: "%11", turnId: undefined, status: "idle", toolExecutions: [] })],
			compaction: { active: true, pendingMessages: 3, reason: "context budget" },
		},
		{ now: () => Date.parse("2026-03-26T02:00:00.000Z") },
	);

	assert.match(frame.body, /CURATOR DASHBOARD/);
	assert.match(frame.body, /agent=alchemist pane=%11/);
	assert.match(frame.body, /agent=orc pane=%10/);
	assert.match(frame.body, /tools=read:running/);
	assert.match(frame.body, /COMPACTION ALERT pending=3 reason=context budget/);
});

test("CuratorDashboardOutput refuses non-dashboard pane and routes via psmux send-keys", async () => {
	const calls: Array<{ command: string; args: string[] }> = [];
	const output = new CuratorDashboardOutput({
		dashboardPaneId: "%42",
		transport: {
			type: "psmux-send-keys",
			runner: {
				async run(command, args) {
					calls.push({ command, args });
					return { ok: true, stderr: "" };
				},
			},
		},
		forbiddenPaneIds: ["%9", "%10"],
	});

	await assert.rejects(() => output.sendFrame({ generatedAt: "", body: "frame" }, "%9"));
	await output.sendFrame({ generatedAt: "", body: "line-1\nline-2" });

	assert.equal(calls.length, 2);
	assert.deepEqual(calls[0], { command: "psmux", args: ["send-keys", "-t", "%42", "line-1", "Enter"] });
	assert.deepEqual(calls[1], { command: "psmux", args: ["send-keys", "-t", "%42", "line-2", "Enter"] });
});

test("CuratorDashboardOutput writes full frame body to named pipe transport", async () => {
	const tmpDir = mkdtempSync(path.join(os.tmpdir(), "curator-render-"));
	const fakePipe = path.join(tmpDir, "curator.pipe");
	try {
		const output = new CuratorDashboardOutput({
			dashboardPaneId: "%42",
			transport: { type: "named-pipe", pipePath: fakePipe },
		});
		await output.sendFrame({ generatedAt: "", body: "A\nB" });
		assert.equal(readFileSync(fakePipe, "utf8"), "A\nB\n");
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});
