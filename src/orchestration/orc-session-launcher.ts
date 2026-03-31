import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfigRepository } from "../app/app-config-repository.js";
import { ModelRegistry, AuthStorage } from "../local-coding-agent.js";
import { TerminalPaneOrchestrator } from "./terminal/pane_orchestrator.js";
import { TerminalSessionManager } from "./terminal/session_manager.js";
import { buildOrcPythonEnv, resolvePreferredPythonInvocation, runCommand, verifyPythonModules } from "./orc-python-environment.js";
import { OrcSharedLaunchContextResolver } from "./orc-shared-launch-context.js";
import { PSMUX_CHILD_ENV, PSMUX_CHILD_FLAG, PSMUX_ROLE_ENV, PSMUX_SESSION_ENV } from "../psmux-runtime-context.js";
import { VIBE_APP_MODE_ENV } from "../app-mode.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const attachWrapperPath = path.join(repoRoot, "tools", "attach-psmux-session.ps1");
const launcherEntry = path.join(repoRoot, "src", "launcher", "psmux-launcher.ts");
const DEFAULT_SESSION_SHELL = ["pwsh.exe", "-NoLogo"];
const DEFAULT_SESSION_GEOMETRY = { width: 220, height: 55 };

export interface OrcExternalSessionLauncherOptions {
	configRepository: AppConfigRepository;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	workspaceRoot?: string;
	execPath?: string;
}

export interface OrcExternalSessionLaunchResult {
	sessionName: string;
	created: boolean;
	providerId: string;
	modelId: string;
}

export class OrcExternalSessionLauncher {
	private readonly workspaceRoot: string;
	private readonly execPath: string;
	private readonly selectionResolver: OrcSharedLaunchContextResolver;

	constructor(private readonly options: OrcExternalSessionLauncherOptions) {
		this.workspaceRoot = options.workspaceRoot ?? process.cwd();
		this.execPath = options.execPath ?? process.execPath;
		this.selectionResolver = new OrcSharedLaunchContextResolver(
			options.configRepository,
			options.authStorage,
			options.modelRegistry,
		);
	}

	async launchOrAttach(): Promise<OrcExternalSessionLaunchResult> {
		await this.assertPsmuxAvailable();
		const selection = await this.selectionResolver.resolveSavedSelection();
		const python = await resolvePreferredPythonInvocation();
		await verifyPythonModules(
			python,
			buildOrcPythonEnv({
				[selection.apiKeyEnvVar]: selection.apiKey,
			}),
			selection.requiredPythonModules,
		);

		const sessionName = createWorkspaceScopedOrcSessionName(this.workspaceRoot);
		const sessionManager = new TerminalSessionManager({ sessionName });
		const paneOrchestrator = new TerminalPaneOrchestrator({ target: sessionName });
		let created = false;

		if (!(await sessionManager.sessionExists())) {
			created = (await sessionManager.ensureDetachedSession({
				width: DEFAULT_SESSION_GEOMETRY.width,
				height: DEFAULT_SESSION_GEOMETRY.height,
				cwd: this.workspaceRoot,
				shellCommand: DEFAULT_SESSION_SHELL,
			})).created;
			if (created) {
				const paneId = await paneOrchestrator.capturePaneId(sessionName);
				await paneOrchestrator.injectCommand(
					paneId,
					buildDetachedOrcChildCommand({
						cwd: this.workspaceRoot,
						execPath: this.execPath,
						sessionName,
					}),
				);
			}
		}

		this.openDetachedAttachWindow(sessionName);
		return {
			sessionName,
			created,
			providerId: selection.providerId,
			modelId: selection.modelId,
		};
	}

	private async assertPsmuxAvailable(): Promise<void> {
		const result = await runCommand("where.exe", ["psmux"], { cwd: this.workspaceRoot, env: process.env });
		if (result.ok) {
			return;
		}
		throw new Error("psmux is required before Orc can open its dedicated external session.");
	}

	private openDetachedAttachWindow(sessionName: string): void {
		if (process.platform !== "win32") {
			throw new Error("External Orc session launch is currently implemented for Windows only.");
		}
		const script = [
			"Start-Process",
			"-FilePath 'pwsh.exe'",
			"-ArgumentList @(",
			"'-NoLogo',",
			"'-NoProfile',",
			"'-ExecutionPolicy',",
			"'Bypass',",
			"'-File',",
			quoteForPowerShell(attachWrapperPath) + ",",
			"'-SessionName',",
			quoteForPowerShell(sessionName),
			")",
		].join(" ");
		const child = spawn("pwsh.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
			detached: true,
			stdio: "ignore",
		});
		child.unref();
	}
}

export function createWorkspaceScopedOrcSessionName(workspaceRoot: string): string {
	const slug = path.basename(workspaceRoot).replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "workspace";
	const digest = createHash("sha1").update(path.resolve(workspaceRoot).toLowerCase()).digest("hex").slice(0, 8);
	return `vibe_orc_${slug.slice(0, 24)}_${digest}`;
}

function buildDetachedOrcChildCommand(input: {
	cwd: string;
	execPath: string;
	sessionName: string;
}): string {
	const launcherArgs = [
		quoteForPowerShell(input.execPath),
		quoteForPowerShell("--import"),
		quoteForPowerShell("tsx"),
		quoteForPowerShell(launcherEntry),
		quoteForPowerShell(PSMUX_CHILD_FLAG),
		quoteForPowerShell("--app-mode=orc"),
	].join(" ");
	return [
		`Set-Location -LiteralPath ${quoteForPowerShell(input.cwd)}`,
		`$env:${PSMUX_CHILD_ENV}='1'`,
		`$env:${PSMUX_ROLE_ENV}='primary'`,
		`$env:${PSMUX_SESSION_ENV}='${escapePowerShellLiteral(input.sessionName)}'`,
		`$env:${VIBE_APP_MODE_ENV}='orc'`,
		`& ${launcherArgs}`,
	].join("; ");
}

function quoteForPowerShell(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function escapePowerShellLiteral(value: string): string {
	return value.replaceAll("'", "''");
}
