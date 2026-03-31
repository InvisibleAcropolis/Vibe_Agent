import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

export interface OrcPythonInvocation {
	command: string;
	args: string[];
	label: string;
}

export interface CommandExecutionResult {
	ok: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export function getOrcRepoRoot(): string {
	return repoRoot;
}

export function buildOrcPythonPath(existingPath?: string): string {
	const entries = [
		repoRoot,
		path.join(repoRoot, "resources", "deepagents-main", "libs", "deepagents"),
		path.join(repoRoot, "resources", "langgraph-main", "libs", "langgraph"),
		path.join(repoRoot, "resources", "langgraph-main", "libs", "checkpoint"),
		path.join(repoRoot, "resources", "langgraph-main", "libs", "checkpoint-sqlite"),
		existingPath,
	].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
	return entries.join(path.delimiter);
}

export function buildOrcPythonEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
	const nextEnv: NodeJS.ProcessEnv = {
		...process.env,
		...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)) as Record<string, string>,
		PYTHONPATH: buildOrcPythonPath(process.env.PYTHONPATH),
		PYTHONUNBUFFERED: "1",
	};
	return nextEnv;
}

export async function resolvePreferredPythonInvocation(): Promise<OrcPythonInvocation> {
	const candidates: OrcPythonInvocation[] = [
		{ command: "py", args: ["-3.11"], label: "py -3.11" },
		{ command: "python", args: [], label: "python" },
	];
	for (const candidate of candidates) {
		const result = await runCommand(candidate.command, [...candidate.args, "-c", "import sys; print(sys.executable)"], {
			cwd: repoRoot,
			env: process.env,
		});
		if (result.ok) {
			return candidate;
		}
	}
	throw new Error("Unable to resolve a Python interpreter for Orc. Expected 'py -3.11' or 'python' to be available.");
}

export async function verifyPythonModules(
	invocation: OrcPythonInvocation,
	env: NodeJS.ProcessEnv,
	modules: readonly string[],
): Promise<void> {
	if (modules.length === 0) {
		return;
	}
	const code = [
		"import importlib",
		`mods = ${JSON.stringify([...modules])}`,
		"missing = []",
		"for name in mods:",
		"    try:",
		"        importlib.import_module(name)",
		"    except Exception as exc:",
		"        missing.append(f'{name}: {exc}')",
		"if missing:",
		"    raise SystemExit('Missing Python modules: ' + ', '.join(missing))",
	].join("\n");
	const result = await runCommand(invocation.command, [...invocation.args, "-c", code], { cwd: repoRoot, env });
	if (result.ok) {
		return;
	}
	const message = result.stderr.trim() || result.stdout.trim() || "Unknown Python dependency error.";
	throw new Error(message);
}

export async function runCommand(
	command: string,
	args: readonly string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandExecutionResult> {
	return await new Promise<CommandExecutionResult>((resolve) => {
		const child = spawn(command, [...args], {
			cwd: options.cwd,
			env: options.env,
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
