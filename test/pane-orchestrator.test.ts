import assert from "node:assert";
import { describe, it } from "node:test";
import {
	TerminalPaneOrchestrator,
	type TerminalPaneAgentBinding,
	type TerminalPaneRole,
} from "../src/orchestration/terminal/pane_orchestrator.js";
import type { SessionCommandResult, SessionManagerCommandRunner } from "../src/orchestration/terminal/session_manager.js";

class FakePaneRunner implements SessionManagerCommandRunner {
	readonly calls: Array<{ command: string; args: string[] }> = [];
	private paneSequence = ["%1", "%2", "%3"];

	async run(command: string, args: string[]): Promise<SessionCommandResult> {
		this.calls.push({ command, args });
		if (command !== "psmux") {
			return { ok: false, exitCode: 1, stdout: "", stderr: "unexpected command" };
		}
		if (args[0] === "split-window") {
			return { ok: true, exitCode: 0, stdout: "", stderr: "" };
		}
		if (args[0] === "display-message") {
			return { ok: true, exitCode: 0, stdout: `${this.paneSequence.shift() ?? "%x"}\n`, stderr: "" };
		}
		if (args[0] === "send-keys") {
			return { ok: true, exitCode: 0, stdout: "", stderr: "" };
		}
		return { ok: false, exitCode: 1, stdout: "", stderr: "unsupported" };
	}
}

describe("TerminalPaneOrchestrator", () => {
	it("splits horizontally and returns typed metadata", async () => {
		const runner = new FakePaneRunner();
		const binding: TerminalPaneAgentBinding = {
			agentId: "agent-alpha",
			boundAt: new Date("2026-01-01T00:00:00.000Z"),
		};
		const orchestrator = new TerminalPaneOrchestrator({ runner, target: "vibe_core" });

		const metadata = await orchestrator.splitHorizontal("secondary", binding);
		assert.equal(metadata.paneId, "%1");
		assert.equal(metadata.role, "secondary" satisfies TerminalPaneRole);
		assert.equal(metadata.agentBinding?.agentId, "agent-alpha");
		assert.equal(metadata.createdAt instanceof Date, true);
		assert.equal(
			runner.calls.some((call) => call.args.join(" ") === "split-window -h -t vibe_core"),
			true,
		);
	});

	it("splits vertically and injects commands with Enter", async () => {
		const runner = new FakePaneRunner();
		const orchestrator = new TerminalPaneOrchestrator({ runner, target: "vibe_core" });

		const pane = await orchestrator.splitVertical("observer");
		await orchestrator.injectCommand(pane.paneId, "npm run test");

		assert.equal(
			runner.calls.some((call) => call.args.join(" ") === "split-window -v -t vibe_core"),
			true,
		);
		assert.equal(
			runner.calls.some((call) => call.args.join(" ") === "send-keys -t %1 npm run test Enter"),
			true,
		);
	});
});
