import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import test from "node:test";
import {
	assertPsmuxAvailable,
	launchVibeAgentWithPsmux,
} from "../src/launcher/psmux-launcher.js";
import {
	PSMUX_SESSION_ENV,
	type PsmuxRuntimeRole,
} from "../src/psmux-runtime-context.js";
import type {
	SessionCommandResult,
	SessionManagerCommandRunner,
} from "../src/orchestration/terminal/session_manager.js";

class ProcessRunner implements SessionManagerCommandRunner {
	async run(command: string, args: string[]): Promise<SessionCommandResult> {
		return await new Promise<SessionCommandResult>((resolve) => {
			const child = spawn(command, args, {
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString("utf8");
			});
			child.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString("utf8");
			});
			child.once("error", (error) => {
				resolve({
					ok: false,
					exitCode: null,
					stdout,
					stderr: `${stderr}${error.message}`,
				});
			});
			child.once("exit", (exitCode) => {
				resolve({
					ok: exitCode === 0,
					exitCode,
					stdout,
					stderr,
				});
			});
		});
	}
}

const runner = new ProcessRunner();

test("psmux availability check fails fast when PATH cannot resolve the binary", async () => {
	const errors: string[] = [];
	const originalPath = process.env.Path;
	const originalUpperPath = process.env.PATH;
	process.env.Path = "C:\\Windows\\System32";
	process.env.PATH = "C:\\Windows\\System32";

	try {
		await assert.rejects(
			async () => {
				await assertPsmuxAvailable(runner, (message) => errors.push(message));
			},
			(error: unknown) => error instanceof Error,
		);
		assert.equal(errors.length, 1);
		assert.match(errors[0] ?? "", /bootstrap\.ps1/);
	} finally {
		process.env.Path = originalPath;
		process.env.PATH = originalUpperPath;
	}
});

test("launcher creates a two-pane detached session and reuses it without duplicating panes", async (t) => {
	const sessionName = `vibeagent-real-${randomUUID().slice(0, 8)}`;
	t.after(async () => {
		await runner.run("psmux", ["kill-session", "-t", sessionName]);
	});

	await launchVibeAgentWithPsmux({
		attach: false,
		env: {
			...process.env,
			[PSMUX_SESSION_ENV]: sessionName,
		},
		argv: [],
		cwd: process.cwd(),
		execPath: process.execPath,
	});

	await waitFor(async () => {
		const paneCount = await runner.run("psmux", ["display-message", "-p", "#{window_panes}", "-t", sessionName]);
		return paneCount.stdout.trim() === "2";
	});

	const firstPaneCount = await runner.run("psmux", ["display-message", "-p", "#{window_panes}", "-t", sessionName]);
	assert.equal(firstPaneCount.stdout.trim(), "2");

	const sessionGeometry = await runner.run("psmux", [
		"display-message",
		"-p",
		"#{window_width}x#{window_height}",
		"-t",
		sessionName,
	]);
	assert.equal(sessionGeometry.stdout.trim(), "240x60");

	const paneGeometry = await runner.run("psmux", [
		"list-panes",
		"-t",
		sessionName,
		"-F",
		"#{pane_width}x#{pane_height}",
	]);
	const paneSizes = paneGeometry.stdout
		.trim()
		.split(/\r?\n/)
		.filter((line) => line.length > 0);
	assert.deepStrictEqual(paneSizes.sort(), ["119x60", "120x60"]);

	await waitFor(async () => {
		const capture = await runner.run("psmux", ["capture-pane", "-p", "-t", sessionName]);
		return capture.stdout.includes("Agent ready.");
	}, 10000);

	await launchVibeAgentWithPsmux({
		attach: false,
		env: {
			...process.env,
			[PSMUX_SESSION_ENV]: sessionName,
		},
		argv: [],
		cwd: process.cwd(),
		execPath: process.execPath,
	});

	const secondPaneCount = await runner.run("psmux", ["display-message", "-p", "#{window_panes}", "-t", sessionName]);
	assert.equal(secondPaneCount.stdout.trim(), "2");

	const paneList = await runner.run("psmux", ["list-panes", "-t", sessionName, "-F", "#{pane_id}:#{pane_active}"]);
	assert.match(paneList.stdout, /%/);
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Timed out after ${timeoutMs}ms waiting for condition.`);
}
