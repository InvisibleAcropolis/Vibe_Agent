import assert from "node:assert";
import { describe, it } from "node:test";
import {
	TerminalSessionManager,
	type SessionCommandResult,
	type SessionManagerCommandRunner,
} from "../src/orchestration/terminal/session_manager.js";

class FakeRunner implements SessionManagerCommandRunner {
	readonly calls: Array<{ command: string; args: string[] }> = [];
	private sessionExists = false;

	async run(command: string, args: string[]): Promise<SessionCommandResult> {
		this.calls.push({ command, args });
		if (command !== "psmux") {
			return { ok: false, exitCode: 1, stdout: "", stderr: "unexpected command" };
		}
		if (args[0] === "has-session") {
			return { ok: this.sessionExists, exitCode: this.sessionExists ? 0 : 1, stdout: "", stderr: "" };
		}
		if (args[0] === "new-session") {
			this.sessionExists = true;
			return { ok: true, exitCode: 0, stdout: "", stderr: "" };
		}
		if (args[0] === "attach") {
			return { ok: this.sessionExists, exitCode: this.sessionExists ? 0 : 1, stdout: "", stderr: this.sessionExists ? "" : "missing" };
		}
		if (args[0] === "kill-session") {
			const hadSession = this.sessionExists;
			this.sessionExists = false;
			return { ok: hadSession, exitCode: hadSession ? 0 : 1, stdout: "", stderr: hadSession ? "" : "missing" };
		}
		return { ok: false, exitCode: 1, stdout: "", stderr: "unsupported" };
	}
}

describe("TerminalSessionManager", () => {
	it("creates the detached core session once and remains idempotent", async () => {
		const runner = new FakeRunner();
		const manager = new TerminalSessionManager({ runner, sessionName: "vibe_core" });
		const first = await manager.ensureCoreSessionDetached();
		const second = await manager.ensureCoreSessionDetached();
		assert.deepStrictEqual(first, { created: true });
		assert.deepStrictEqual(second, { created: false });
		assert.equal(
			runner.calls.some((call) => call.args.join(" ") === "new-session -d -s vibe_core"),
			true,
		);
	});

	it("runs recover attach flow and graceful shutdown through one API", async () => {
		const runner = new FakeRunner();
		const manager = new TerminalSessionManager({ runner, sessionName: "vibe_core" });
		const recovered = await manager.recoverCoreSession();
		assert.deepStrictEqual(recovered, { attached: true, created: true });
		const shutdown = await manager.shutdownCoreSession();
		assert.deepStrictEqual(shutdown, { terminated: true });
	});
});
