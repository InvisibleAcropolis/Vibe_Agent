#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const binDir = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(binDir, "..", "src", "launcher", "psmux-launcher.ts");
const selectedShell = process.env.VIBE_MAIN_SHELL?.toLowerCase() ?? "opentui";
const useBunRuntime = selectedShell === "opentui";

const child = spawn(useBunRuntime ? "bun" : process.execPath, useBunRuntime ? [entry, ...process.argv.slice(2)] : ["--import", "tsx", entry, ...process.argv.slice(2)], {
	stdio: "inherit",
	env: process.env,
});

child.on("error", (error) => {
	console.error(error);
	process.exit(1);
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 0);
});
