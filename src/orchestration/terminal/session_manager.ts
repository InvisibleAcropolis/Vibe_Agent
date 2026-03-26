import { spawn } from "node:child_process";
import { UnifiedOrchestrationError, createCorrelationContext } from "../errors/unified-error.js";

export const ORC_CORE_SESSION_NAME = "vibe_core";

export interface SessionCommandResult {
	ok: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export interface SessionManagerCommandRunner {
	run(command: string, args: string[]): Promise<SessionCommandResult>;
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
}

export interface TerminalSessionLifecycle {
	ensureCoreSessionDetached(): Promise<{ created: boolean }>;
	recoverCoreSession(): Promise<{ attached: boolean; created: boolean }>;
	shutdownCoreSession(): Promise<{ terminated: boolean }>;
	coreSessionExists(): Promise<boolean>;
}

export interface TerminalSessionManagerOptions {
	runner?: SessionManagerCommandRunner;
	sessionName?: string;
	onDiagnostic?: (entry: Record<string, unknown>) => void;
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

	async ensureCoreSessionDetached(): Promise<{ created: boolean }> {
		if (await this.coreSessionExists()) {
			return { created: false };
		}
		const result = await this.runner.run("psmux", ["new-session", "-d", "-s", this.sessionName]);
		if (result.ok) {
			return { created: true };
		}
		if (await this.coreSessionExists()) {
			return { created: false };
		}
		throw new Error(`Unable to create detached psmux session '${this.sessionName}': ${result.stderr || "command failed"}`);
	}

	async recoverCoreSession(): Promise<{ attached: boolean; created: boolean }> {
		const ensureResult = await this.ensureCoreSessionDetached();
		const attachResult = await this.runner.run("psmux", ["attach", "-t", this.sessionName]);
		if (attachResult.ok) {
			return { attached: true, created: ensureResult.created };
		}
		const sessionMissing = !(await this.coreSessionExists());
		if (sessionMissing) {
			this.emitDeadSessionDiagnostic("recover.attach_missing_session", attachResult.stderr, "retry");
			const recreated = await this.ensureCoreSessionDetached();
			const retryAttachResult = await this.runner.run("psmux", ["attach", "-t", this.sessionName]);
			if (retryAttachResult.ok) {
				return { attached: true, created: ensureResult.created || recreated.created };
			}
			this.emitDeadSessionDiagnostic("recover.attach_retry_failed", retryAttachResult.stderr, "abort");
		} else {
			this.emitDeadSessionDiagnostic("recover.attach_failed", attachResult.stderr, "abort");
		}
		throw new Error(`Unable to attach to psmux session '${this.sessionName}': ${attachResult.stderr || "command failed"}`);
	}

	async shutdownCoreSession(): Promise<{ terminated: boolean }> {
		if (!(await this.coreSessionExists())) {
			return { terminated: false };
		}
		const result = await this.runner.run("psmux", ["kill-session", "-t", this.sessionName]);
		if (result.ok) {
			return { terminated: true };
		}
		if (!(await this.coreSessionExists())) {
			return { terminated: true };
		}
		throw new Error(`Unable to terminate psmux session '${this.sessionName}': ${result.stderr || "command failed"}`);
	}

	async coreSessionExists(): Promise<boolean> {
		const result = await this.runner.run("psmux", ["has-session", "-t", this.sessionName]);
		return result.ok;
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
