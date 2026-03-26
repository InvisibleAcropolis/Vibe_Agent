import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { JsonLfStreamParser } from "./stream_parser.js";

export type RpcAgentRole = "orc" | "inquisitor" | "alchemist";

export type RpcCommandKind = "initialize" | "execute" | "cancel" | "shutdown" | (string & {});
export type RpcTelemetryKind = "ready" | "progress" | "result" | "fault" | "heartbeat" | (string & {});

export interface RpcAgentProcessIdentity {
	agentRole: RpcAgentRole;
	agentId: string;
	instanceId: string;
	launchAttempt: number;
	pid?: number;
}

export interface RpcCommandEnvelope<TPayload = Record<string, unknown>> {
	schema: "pi.rpc.command.v1";
	requestId: string;
	issuedAt: string;
	target: RpcAgentProcessIdentity;
	command: {
		kind: RpcCommandKind;
		payload: TPayload;
	};
	metadata?: Record<string, unknown>;
}

export type RpcTelemetrySeverity = "debug" | "info" | "warning" | "error";

export interface RpcTelemetryEnvelope<TPayload = Record<string, unknown>> {
	schema: "pi.rpc.telemetry.v1";
	eventId: string;
	emittedAt: string;
	source: RpcAgentProcessIdentity;
	telemetry: {
		kind: RpcTelemetryKind;
		severity: RpcTelemetrySeverity;
		payload: TPayload;
	};
}

export interface RpcLauncherAgentConfig {
	role: RpcAgentRole;
	agentId: string;
	command?: string;
	args?: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
}

export interface RpcRestartPolicy {
	enabled: boolean;
	maxRestarts: number;
	restartDelayMs: number;
	shouldRestart?: (context: { role: RpcAgentRole; code: number | null; signal: NodeJS.Signals | null; restartsSoFar: number }) => boolean;
}

export interface RpcAgentRuntimeState {
	identity: RpcAgentProcessIdentity;
	status: "idle" | "starting" | "running" | "stopped";
	restartCount: number;
	lastExit?: {
		code: number | null;
		signal: NodeJS.Signals | null;
		at: string;
	};
}

export interface RpcLauncherOptions {
	agents?: RpcLauncherAgentConfig[];
	restartPolicy?: Partial<RpcRestartPolicy>;
	spawnFn?: (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
	onTelemetry?: (envelope: RpcTelemetryEnvelope) => void;
	onStderr?: (role: RpcAgentRole, chunk: string) => void;
	onLifecycle?: (role: RpcAgentRole, state: RpcAgentRuntimeState) => void;
}

interface AgentProcessHandle {
	config: RpcLauncherAgentConfig;
	identity: RpcAgentProcessIdentity;
	child?: ChildProcessWithoutNullStreams;
	restartCount: number;
	status: RpcAgentRuntimeState["status"];
	lastExit?: RpcAgentRuntimeState["lastExit"];
	stdoutParser: JsonLfStreamParser<RpcTelemetryEnvelope>;
	stopRequested: boolean;
}

const DEFAULT_AGENT_CWD = resolve(process.cwd(), "resources", "pi-mono-main");

const DEFAULT_AGENT_CONFIGS: RpcLauncherAgentConfig[] = [
	{ role: "orc", agentId: "orc-main" },
	{ role: "inquisitor", agentId: "inquisitor-main" },
	{ role: "alchemist", agentId: "alchemist-main" },
];

const DEFAULT_RESTART_POLICY: RpcRestartPolicy = {
	enabled: true,
	maxRestarts: 3,
	restartDelayMs: 500,
	shouldRestart: ({ code, restartsSoFar }) => code !== 0 && restartsSoFar < 3,
};

export class RpcProcessLauncher {
	private readonly agents = new Map<RpcAgentRole, AgentProcessHandle>();
	private readonly restartPolicy: RpcRestartPolicy;
	private readonly spawnFn: (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
	private readonly onTelemetry?: RpcLauncherOptions["onTelemetry"];
	private readonly onStderr?: RpcLauncherOptions["onStderr"];
	private readonly onLifecycle?: RpcLauncherOptions["onLifecycle"];

	constructor(options: RpcLauncherOptions = {}) {
		const configs = options.agents ?? DEFAULT_AGENT_CONFIGS;
		for (const config of configs) {
			this.agents.set(config.role, {
				config,
				identity: createIdentity(config.role, config.agentId, 0),
				restartCount: 0,
				status: "idle",
				stdoutParser: createTelemetryParser(),
				stopRequested: false,
			});
		}
		this.restartPolicy = {
			...DEFAULT_RESTART_POLICY,
			...options.restartPolicy,
			shouldRestart: options.restartPolicy?.shouldRestart ?? DEFAULT_RESTART_POLICY.shouldRestart,
		};
		this.spawnFn = options.spawnFn ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions));
		this.onTelemetry = options.onTelemetry;
		this.onStderr = options.onStderr;
		this.onLifecycle = options.onLifecycle;
	}

	async startAll(): Promise<void> {
		for (const role of this.agents.keys()) {
			this.startAgent(role);
		}
	}

	startAgent(role: RpcAgentRole): RpcAgentRuntimeState {
		const handle = this.requireHandle(role);
		if (handle.child && (handle.status === "starting" || handle.status === "running")) {
			return this.snapshot(handle);
		}
		handle.stopRequested = false;
		handle.identity = createIdentity(role, handle.config.agentId, handle.restartCount);
		handle.stdoutParser = createTelemetryParser();
		handle.status = "starting";
		this.emitLifecycle(handle);

		const child = this.spawnFn(handle.config.command ?? "node", buildArgs(handle.config), {
			cwd: handle.config.cwd ?? DEFAULT_AGENT_CWD,
			env: { ...process.env, ...handle.config.env },
			stdio: "pipe",
		});

		handle.child = child;
		handle.identity.pid = child.pid;
		handle.status = "running";
		this.emitLifecycle(handle);
		this.bindStreams(handle);
		return this.snapshot(handle);
	}

	sendCommand<TPayload>(role: RpcAgentRole, envelope: RpcCommandEnvelope<TPayload>): void {
		const handle = this.requireHandle(role);
		if (!handle.child || handle.status !== "running") {
			throw new Error(`Agent ${role} is not running; cannot send RPC command.`);
		}
		handle.child.stdin.write(`${JSON.stringify(envelope)}\n`, "utf8");
	}

	stopAgent(role: RpcAgentRole): void {
		const handle = this.requireHandle(role);
		handle.stopRequested = true;
		if (!handle.child) {
			handle.status = "stopped";
			this.emitLifecycle(handle);
			return;
		}
		handle.child.kill("SIGTERM");
	}

	stopAll(): void {
		for (const role of this.agents.keys()) {
			this.stopAgent(role);
		}
	}

	getAgentState(role: RpcAgentRole): RpcAgentRuntimeState {
		return this.snapshot(this.requireHandle(role));
	}

	private bindStreams(handle: AgentProcessHandle): void {
		const child = handle.child;
		if (!child) {
			return;
		}
		child.stdout.on("data", (chunk: Buffer) => {
			const drained = handle.stdoutParser.pushChunk(chunk);
			for (const envelope of drained.parsed) {
				this.onTelemetry?.(envelope);
			}
			for (const quarantined of drained.quarantined) {
				this.onStderr?.(
					handle.config.role,
					`Telemetry frame quarantined (${quarantined.reason}): ${quarantined.detail}. Raw frame: ${quarantined.rawFrame}`
				);
			}
		});
		child.stderr.on("data", (chunk: Buffer) => {
			this.onStderr?.(handle.config.role, chunk.toString("utf8"));
		});
		child.once("exit", (code, signal) => {
			const finalDrain = handle.stdoutParser.finish();
			for (const envelope of finalDrain.parsed) {
				this.onTelemetry?.(envelope);
			}
			for (const quarantined of finalDrain.quarantined) {
				this.onStderr?.(
					handle.config.role,
					`Telemetry frame quarantined (${quarantined.reason}): ${quarantined.detail}. Raw frame: ${quarantined.rawFrame}`
				);
			}
			handle.lastExit = {
				code,
				signal,
				at: new Date().toISOString(),
			};
			handle.child = undefined;
			handle.status = "stopped";
			this.emitLifecycle(handle);
			if (!handle.stopRequested) {
				this.maybeRestart(handle, code, signal);
			}
		});
	}

	private maybeRestart(handle: AgentProcessHandle, code: number | null, signal: NodeJS.Signals | null): void {
		if (!this.restartPolicy.enabled) {
			return;
		}
		const shouldRestart = this.restartPolicy.shouldRestart?.({
			role: handle.config.role,
			code,
			signal,
			restartsSoFar: handle.restartCount,
		}) ?? false;
		if (!shouldRestart || handle.restartCount >= this.restartPolicy.maxRestarts) {
			return;
		}
		handle.restartCount += 1;
		setTimeout(() => {
			if (!handle.stopRequested) {
				this.startAgent(handle.config.role);
			}
		}, this.restartPolicy.restartDelayMs);
	}

	private requireHandle(role: RpcAgentRole): AgentProcessHandle {
		const handle = this.agents.get(role);
		if (!handle) {
			throw new Error(`No RPC launcher agent registered for role '${role}'.`);
		}
		return handle;
	}

	private emitLifecycle(handle: AgentProcessHandle): void {
		this.onLifecycle?.(handle.config.role, this.snapshot(handle));
	}

	private snapshot(handle: AgentProcessHandle): RpcAgentRuntimeState {
		return {
			identity: { ...handle.identity },
			status: handle.status,
			restartCount: handle.restartCount,
			lastExit: handle.lastExit ? { ...handle.lastExit } : undefined,
		};
	}
}

function createIdentity(role: RpcAgentRole, agentId: string, launchAttempt: number): RpcAgentProcessIdentity {
	return {
		agentRole: role,
		agentId,
		instanceId: `${role}-${randomUUID()}`,
		launchAttempt,
	};
}

function buildArgs(config: RpcLauncherAgentConfig): string[] {
	if (config.args && config.args.length > 0) {
		return [...config.args];
	}
	return ["src/cli.ts", "--mode", "rpc", "--agent", config.role];
}

function isTelemetryEnvelope(value: unknown): value is RpcTelemetryEnvelope {
	if (!value || typeof value !== "object") {
		return false;
	}
	const candidate = value as Partial<RpcTelemetryEnvelope>;
	return candidate.schema === "pi.rpc.telemetry.v1"
		&& typeof candidate.eventId === "string"
		&& typeof candidate.emittedAt === "string"
		&& !!candidate.source
		&& !!candidate.telemetry;
}

function createTelemetryParser(): JsonLfStreamParser<RpcTelemetryEnvelope> {
	return new JsonLfStreamParser<RpcTelemetryEnvelope>({ validate: isTelemetryEnvelope });
}
