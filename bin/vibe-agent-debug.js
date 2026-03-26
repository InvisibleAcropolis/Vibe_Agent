#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const binDir = path.dirname(fileURLToPath(import.meta.url));
process.env.PI_MONO_APP_DEBUG_BUNDLE ??= path.join(binDir, "..", ".debug", "live");
const entry = path.join(binDir, "..", "src", "launcher", "psmux-launcher.ts");

const child = spawn(process.execPath, ["--import", "tsx", entry, ...process.argv.slice(2)], {
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
