import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	ORC_CORE_SESSION_NAME,
	TerminalSessionManager,
	type SessionManagerCommandRunner,
	type SessionCommandResult,
} from "../orchestration/terminal/session_manager.js";
import { TerminalPaneOrchestrator } from "../orchestration/terminal/pane_orchestrator.js";
import {
	PSMUX_CHILD_ENV,
	PSMUX_CHILD_FLAG,
	PSMUX_ROLE_ENV,
	PSMUX_SESSION_ENV,
	readPsmuxRuntimeContext,
	stripPsmuxChildFlag,
	type PsmuxRuntimeRole,
} from "../psmux-runtime-context.js";
import { startVibeAgentApp } from "../run-app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const launcherEntry = path.join(repoRoot, "src", "launcher", "psmux-launcher.ts");
const DEFAULT_SESSION_GEOMETRY = { width: 120, height: 30 };
const DEFAULT_SESSION_SHELL = ["pwsh.exe", "-NoLogo"];

class ProcessCommandRunner implements SessionManagerCommandRunner {
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

export interface PsmuxLauncherDependencies {
	runner?: SessionManagerCommandRunner;
	sessionManager?: TerminalSessionManager;
	paneOrchestrator?: TerminalPaneOrchestrator;
	attach?: boolean;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	argv?: readonly string[];
	execPath?: string;
	writeError?: (message: string) => void;
}

export async function launchVibeAgentWithPsmux(dependencies: PsmuxLauncherDependencies = {}): Promise<void> {
	const env = dependencies.env ?? process.env;
	const argv = [...(dependencies.argv ?? process.argv.slice(2))];
	const runtimeContext = readPsmuxRuntimeContext(env, argv);

	if (runtimeContext.isChild) {
		startVibeAgentApp();
		return;
	}

	const runner = dependencies.runner ?? new ProcessCommandRunner();
	const sessionName = normalizeSessionName(env[PSMUX_SESSION_ENV]) ?? ORC_CORE_SESSION_NAME;
	const sessionManager = dependencies.sessionManager ?? new TerminalSessionManager({ runner, sessionName });
	const paneOrchestrator = dependencies.paneOrchestrator ?? new TerminalPaneOrchestrator({ runner, target: sessionName });
	const attach = dependencies.attach ?? true;
	const writeError = dependencies.writeError ?? ((message: string) => console.error(message));
	const cwd = dependencies.cwd ?? process.cwd();
	const execPath = dependencies.execPath ?? process.execPath;
	const childArgs = stripPsmuxChildFlag(argv);

	await assertPsmuxAvailable(runner, writeError);

	if (await sessionManager.sessionExists()) {
		if (attach) {
			await sessionManager.attachInteractiveSession();
		}
		return;
	}

	await sessionManager.ensureDetachedSession({
		width: DEFAULT_SESSION_GEOMETRY.width,
		height: DEFAULT_SESSION_GEOMETRY.height,
		cwd,
		shellCommand: DEFAULT_SESSION_SHELL,
	});

	const primaryPaneId = await paneOrchestrator.capturePaneId(sessionName);
	const secondaryPane = await paneOrchestrator.splitHorizontal("secondary");
	const primaryCommand = buildPsmuxChildCommand({
		cwd,
		execPath,
		args: childArgs,
		role: "primary",
		sessionName,
	});
	const secondaryCommand = buildPsmuxChildCommand({
		cwd,
		execPath,
		args: childArgs,
		role: "secondary",
		sessionName,
	});

	await paneOrchestrator.injectCommand(primaryPaneId, primaryCommand);
	await paneOrchestrator.injectCommand(secondaryPane.paneId, secondaryCommand);

	if (attach) {
		await sessionManager.attachInteractiveSession();
	}
}

export function buildPsmuxChildCommand(input: {
	cwd: string;
	execPath: string;
	args: readonly string[];
	role: PsmuxRuntimeRole;
	sessionName: string;
}): string {
	const launcherArgs = [
		quoteForPowerShell(input.execPath),
		quoteForPowerShell("--import"),
		quoteForPowerShell("tsx"),
		quoteForPowerShell(launcherEntry),
		quoteForPowerShell(PSMUX_CHILD_FLAG),
		...input.args.map((arg) => quoteForPowerShell(arg)),
	].join(" ");

	return [
		`Set-Location -LiteralPath ${quoteForPowerShell(input.cwd)}`,
		`$env:${PSMUX_CHILD_ENV}='1'`,
		`$env:${PSMUX_ROLE_ENV}='${input.role}'`,
		`$env:${PSMUX_SESSION_ENV}='${escapePowerShellLiteral(input.sessionName)}'`,
		`& ${launcherArgs}`,
	].join("; ");
}

export async function assertPsmuxAvailable(
	runner: SessionManagerCommandRunner,
	writeError: (message: string) => void = (message) => console.error(message),
): Promise<void> {
	const result = await runner.run("where.exe", ["psmux"]);
	if (result.ok) {
		return;
	}
	writeError([
		"psmux is required to start Vibe Agent.",
		`Install it with PowerShell using '${path.join(repoRoot, "src", "orchestration", "bootstrap.ps1")}'.`,
		"Startup aborted because no non-psmux fallback remains.",
	].join("\n"));
	// Match prior launcher behavior: throw so the caller exits non-zero.
	throw new Error(result.stderr || "Unable to resolve psmux on PATH.");
}

function normalizeSessionName(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function quoteForPowerShell(value: string): string {
	return `'${escapePowerShellLiteral(value)}'`;
}

function escapePowerShellLiteral(value: string): string {
	return value.replaceAll("'", "''");
}

const invokedAsEntrypoint = process.argv[1]
	? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
	: false;

if (invokedAsEntrypoint) {
	void launchVibeAgentWithPsmux();
}
