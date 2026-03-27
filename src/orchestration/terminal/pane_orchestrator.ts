import { spawn } from "node:child_process";
import type { SessionCommandResult, SessionManagerCommandRunner } from "./session_manager.js";

export const ORC_CORE_TARGET = "vibe_core";

export type TerminalPaneRole = "primary" | "secondary" | "observer" | "custom";

export interface TerminalPaneAgentBinding {
	agentId: string;
	boundAt: Date;
}

export interface TerminalPaneMetadata {
	paneId: string;
	role: TerminalPaneRole;
	createdAt: Date;
	agentBinding: TerminalPaneAgentBinding | null;
}

export interface PaneOrchestratorOptions {
	runner?: SessionManagerCommandRunner;
	target?: string;
}

export interface SplitPaneOptions {
	percentage?: number;
	size?: number;
	detached?: boolean;
}

class PsmuxPaneRunner implements SessionManagerCommandRunner {
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

export class TerminalPaneOrchestrator {
	private readonly runner: SessionManagerCommandRunner;
	private readonly target: string;

	constructor(options: PaneOrchestratorOptions = {}) {
		this.runner = options.runner ?? new PsmuxPaneRunner();
		this.target = options.target ?? ORC_CORE_TARGET;
	}

	async splitHorizontal(
		role: TerminalPaneRole,
		agentBinding: TerminalPaneAgentBinding | null = null,
		options: SplitPaneOptions = {},
	): Promise<TerminalPaneMetadata> {
		return await this.splitPane("-h", role, agentBinding, options);
	}

	async splitVertical(
		role: TerminalPaneRole,
		agentBinding: TerminalPaneAgentBinding | null = null,
		options: SplitPaneOptions = {},
	): Promise<TerminalPaneMetadata> {
		return await this.splitPane("-v", role, agentBinding, options);
	}

	async capturePaneId(target: string = this.target): Promise<string> {
		const result = await this.runner.run("psmux", ["display-message", "-p", "#{pane_id}", "-t", target]);
		if (!result.ok) {
			throw new Error(`Unable to capture pane id via psmux display-message: ${result.stderr || "command failed"}`);
		}
		const paneId = result.stdout.trim();
		if (paneId.length === 0) {
			throw new Error("Unable to capture pane id via psmux display-message: pane id was empty");
		}
		return paneId;
	}

	async injectCommand(paneId: string, command: string): Promise<void> {
		if (paneId.trim().length === 0) {
			throw new Error("Pane id is required for send-keys");
		}
		const result = await this.runner.run("psmux", ["send-keys", "-t", this.resolvePaneTarget(paneId), command, "Enter"]);
		if (!result.ok) {
			throw new Error(`Unable to inject command via psmux send-keys for pane '${paneId}': ${result.stderr || "command failed"}`);
		}
	}

	private async splitPane(
		directionFlag: "-h" | "-v",
		role: TerminalPaneRole,
		agentBinding: TerminalPaneAgentBinding | null,
		options: SplitPaneOptions,
	): Promise<TerminalPaneMetadata> {
		const args = ["split-window", directionFlag, "-P", "-F", "#{pane_id}"];
		if (options.detached) {
			args.push("-d");
		}
		if (typeof options.percentage === "number") {
			args.push("-p", String(options.percentage));
		} else if (typeof options.size === "number") {
			args.push("-l", String(options.size));
		}
		args.push("-t", this.target);

		const splitResult = await this.runner.run("psmux", args);
		if (!splitResult.ok) {
			throw new Error(`Unable to split pane with '${directionFlag}' on target '${this.target}': ${splitResult.stderr || "command failed"}`);
		}
		const paneId = splitResult.stdout.trim();
		if (paneId.length === 0) {
			throw new Error(`Unable to split pane with '${directionFlag}' on target '${this.target}': pane id was empty`);
		}
		return {
			paneId,
			role,
			createdAt: new Date(),
			agentBinding,
		};
	}

	private resolvePaneTarget(paneId: string): string {
		return paneId.startsWith("%") ? `${this.target}:${paneId}` : paneId;
	}
}

let singletonPaneOrchestrator: TerminalPaneOrchestrator | undefined;

export function getTerminalPaneOrchestrator(): TerminalPaneOrchestrator {
	singletonPaneOrchestrator ??= new TerminalPaneOrchestrator();
	return singletonPaneOrchestrator;
}
