import { spawn } from "node:child_process";
import { UnifiedOrchestrationError, createCorrelationContext } from "../errors/unified-error.js";

export const ORC_CORE_SESSION_NAME = "vibe_core";
const DEFAULT_INTERACTIVE_GEOMETRY = { width: 240, height: 60 };
const WINDOWS_INTERRUPT_EXIT_CODE = 3221225786;
const WINDOWS_INTERRUPT_EXIT_CODE_SIGNED = -1073741510;

export interface SessionCommandResult {
	ok: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export interface SessionManagerCommandRunner {
	run(command: string, args: string[]): Promise<SessionCommandResult>;
}

export interface InteractiveSessionCommandRunner extends SessionManagerCommandRunner {
	runInteractive(command: string, args: string[]): Promise<SessionCommandResult>;
}

class PsmuxCommandRunner implements SessionManagerCommandRunner {
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

	async runInteractive(command: string, args: string[]): Promise<SessionCommandResult> {
		if (process.platform === "win32") {
			return await this.runInteractiveViaPowerShell(command, args);
		}
		return await new Promise<SessionCommandResult>((resolve) => {
			const child = spawn(command, args, {
				stdio: "inherit",
			});
			child.once("error", (error) => {
				resolve({
					ok: false,
					exitCode: null,
					stdout: "",
					stderr: error.message,
				});
			});
			child.once("exit", (exitCode) => {
				resolve({
					ok: exitCode === 0,
					exitCode,
					stdout: "",
					stderr: exitCode === 0 ? "" : `interactive command exited with code ${exitCode ?? "unknown"}`,
				});
			});
		});
	}

	private async runInteractiveViaPowerShell(command: string, args: string[]): Promise<SessionCommandResult> {
		const attachCommand = [
			`mode con: cols=${DEFAULT_INTERACTIVE_GEOMETRY.width} lines=${DEFAULT_INTERACTIVE_GEOMETRY.height}`,
			[quoteForCmd(command), ...args.map((arg) => quoteForCmd(arg))].join(" "),
		].join(" && ");
		const script = [
			`$proc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', ${quoteForPowerShell(attachCommand)}) -Wait -PassThru`,
			"exit $proc.ExitCode",
		].join("; ");

		return await new Promise<SessionCommandResult>((resolve) => {
			const child = spawn("pwsh.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
				stdio: "inherit",
			});
			child.once("error", (error) => {
				resolve({
					ok: false,
					exitCode: null,
					stdout: "",
					stderr: error.message,
				});
			});
			child.once("exit", (exitCode) => {
				resolve({
					ok: exitCode === 0,
					exitCode,
					stdout: "",
					stderr: exitCode === 0 ? "" : `interactive command exited with code ${exitCode ?? "unknown"}`,
				});
			});
		});
	}
}

export interface TerminalSessionLifecycle {
	ensureDetachedSession(options?: DetachedSessionOptions): Promise<{ created: boolean }>;
	recreateDetachedSession(options?: DetachedSessionOptions): Promise<{ created: boolean }>;
	attachInteractiveSession(): Promise<{ attached: boolean; closedByUser?: boolean }>;
	shutdownSession(): Promise<{ terminated: boolean }>;
	sessionExists(): Promise<boolean>;
}

export interface TerminalSessionManagerOptions {
	runner?: SessionManagerCommandRunner;
	sessionName?: string;
	onDiagnostic?: (entry: Record<string, unknown>) => void;
}

export interface DetachedSessionOptions {
	width?: number;
	height?: number;
	cwd?: string;
	shellCommand?: string[];
}

export class TerminalSessionManager implements TerminalSessionLifecycle {
	private readonly runner: SessionManagerCommandRunner;
	private readonly sessionName: string;
	private readonly onDiagnostic?: (entry: Record<string, unknown>) => void;

	constructor(options: TerminalSessionManagerOptions = {}) {
		this.runner = options.runner ?? new PsmuxCommandRunner();
		this.sessionName = options.sessionName ?? ORC_CORE_SESSION_NAME;
		this.onDiagnostic = options.onDiagnostic;
	}

	async ensureDetachedSession(options: DetachedSessionOptions = {}): Promise<{ created: boolean }> {
		if (await this.sessionExists()) {
			return { created: false };
		}
		const args = ["new-session", "-d", "-s", this.sessionName];
		if (typeof options.width === "number") {
			args.push("-x", String(options.width));
		}
		if (typeof options.height === "number") {
			args.push("-y", String(options.height));
		}
		if (options.cwd) {
			args.push("-c", options.cwd);
		}
		if (options.shellCommand && options.shellCommand.length > 0) {
			args.push("--", ...options.shellCommand);
		}
		const result = await this.runner.run("psmux", args);
		if (result.ok) {
			return { created: true };
		}
		if (await this.sessionExists()) {
			return { created: false };
		}
		throw new Error(`Unable to create detached psmux session '${this.sessionName}': ${result.stderr || "command failed"}`);
	}

	async recreateDetachedSession(options: DetachedSessionOptions = {}): Promise<{ created: boolean }> {
		if (await this.sessionExists()) {
			await this.shutdownSession();
		}
		return await this.ensureDetachedSession(options);
	}

	async attachInteractiveSession(): Promise<{ attached: boolean; closedByUser?: boolean }> {
		if (!(await this.sessionExists())) {
			throw new Error(`Unable to attach to psmux session '${this.sessionName}': session does not exist.`);
		}
		const attachResult = await this.runAttachCommand(["attach", "-t", this.sessionName]);
		if (attachResult.ok) {
			return { attached: true };
		}
		if (isNormalInteractiveClose(attachResult.exitCode)) {
			return { attached: false, closedByUser: true };
		}
		this.emitDeadSessionDiagnostic("attach.failed", attachResult.stderr, "abort");
		throw new Error(`Unable to attach to psmux session '${this.sessionName}': ${attachResult.stderr || "command failed"}`);
	}

	async shutdownSession(): Promise<{ terminated: boolean }> {
		if (!(await this.sessionExists())) {
			return { terminated: false };
		}
		const result = await this.runner.run("psmux", ["kill-session", "-t", this.sessionName]);
		if (result.ok) {
			return { terminated: true };
		}
		if (!(await this.sessionExists())) {
			return { terminated: true };
		}
		throw new Error(`Unable to terminate psmux session '${this.sessionName}': ${result.stderr || "command failed"}`);
	}

	async sessionExists(): Promise<boolean> {
		const result = await this.runner.run("psmux", ["has-session", "-t", this.sessionName]);
		return result.ok;
	}

	async ensureCoreSessionDetached(): Promise<{ created: boolean }> {
		return await this.ensureDetachedSession();
	}

	async recoverCoreSession(): Promise<{ attached: boolean; created: boolean; closedByUser?: boolean }> {
		const ensureResult = await this.ensureDetachedSession();
		const attachResult = await this.runAttachCommand(["attach", "-t", this.sessionName]);
		if (attachResult.ok) {
			return { attached: true, created: ensureResult.created };
		}
		if (isNormalInteractiveClose(attachResult.exitCode)) {
			return { attached: false, created: ensureResult.created, closedByUser: true };
		}
		const sessionMissing = !(await this.sessionExists());
		if (sessionMissing) {
			this.emitDeadSessionDiagnostic("recover.attach_missing_session", attachResult.stderr, "retry");
			const recreated = await this.recreateDetachedSession();
			const retryAttachResult = await this.runAttachCommand(["attach", "-t", this.sessionName]);
			if (retryAttachResult.ok) {
				return { attached: true, created: ensureResult.created || recreated.created };
			}
			if (isNormalInteractiveClose(retryAttachResult.exitCode)) {
				return { attached: false, created: ensureResult.created || recreated.created, closedByUser: true };
			}
			this.emitDeadSessionDiagnostic("recover.attach_retry_failed", retryAttachResult.stderr, "abort");
		} else {
			this.emitDeadSessionDiagnostic("recover.attach_failed", attachResult.stderr, "abort");
		}
		throw new Error(`Unable to attach to psmux session '${this.sessionName}': ${attachResult.stderr || "command failed"}`);
	}

	async shutdownCoreSession(): Promise<{ terminated: boolean }> {
		return await this.shutdownSession();
	}

	async coreSessionExists(): Promise<boolean> {
		return await this.sessionExists();
	}

	private async runAttachCommand(args: string[]): Promise<SessionCommandResult> {
		const interactiveRunner = this.runner as InteractiveSessionCommandRunner;
		if (typeof interactiveRunner.runInteractive === "function") {
			return await interactiveRunner.runInteractive("psmux", args);
		}
		return await this.runner.run("psmux", args);
	}

	private emitDeadSessionDiagnostic(event: string, stderr: string, recoveryAction: "retry" | "abort"): void {
		if (!this.onDiagnostic) {
			return;
		}
		const error = new UnifiedOrchestrationError({
			kind: "dead_psmux_session",
			message: `psmux session '${this.sessionName}' became unavailable during attach flow`,
			recoveryAction,
			context: createCorrelationContext({ paneId: this.sessionName }),
			detail: {
				sessionName: this.sessionName,
				stderr,
			},
		});
		this.onDiagnostic(error.toStructuredLog(event));
	}
}

let singletonSessionManager: TerminalSessionManager | undefined;

export function getTerminalSessionManager(): TerminalSessionManager {
	singletonSessionManager ??= new TerminalSessionManager();
	return singletonSessionManager;
}

function quoteForPowerShell(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function quoteForCmd(value: string): string {
	if (/^[A-Za-z0-9_./:%-]+$/.test(value)) {
		return value;
	}
	return `"${value.replaceAll("\"", "\"\"")}"`;
}

function isNormalInteractiveClose(exitCode: number | null): boolean {
	return exitCode === WINDOWS_INTERRUPT_EXIT_CODE || exitCode === WINDOWS_INTERRUPT_EXIT_CODE_SIGNED;
}
