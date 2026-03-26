import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
	RpcProcessLauncher,
	type RpcTelemetryEnvelope,
	type RpcAgentRole,
} from "../src/orchestration/bridge/rpc_launcher.js";

class FakeChildProcess extends EventEmitter {
	stdin = new PassThrough();
	stdout = new PassThrough();
	stderr = new PassThrough();
	pid?: number;
	killed = false;

	constructor(pid: number) {
		super();
		this.pid = pid;
	}

	kill(signal?: NodeJS.Signals): boolean {
		this.killed = true;
		this.emit("exit", signal === "SIGTERM" ? 0 : 1, signal ?? null);
		return true;
	}
}

test("RpcProcessLauncher starts agents in rpc mode from pi-mono-main and preserves per-agent identity", async () => {
	const spawnCalls: Array<{ command: string; args: string[]; cwd?: string }> = [];
	let pid = 100;
	const launcher = new RpcProcessLauncher({
		spawnFn: ((command, args, options) => {
			spawnCalls.push({ command, args, cwd: options.cwd as string | undefined });
			return new FakeChildProcess(++pid) as unknown as ChildProcessWithoutNullStreams;
		}),
	});

	await launcher.startAll();
	assert.equal(spawnCalls.length, 3);
	for (const call of spawnCalls) {
		assert.equal(call.command, "node");
		assert.deepEqual(call.args.slice(0, 3), ["src/cli.ts", "--mode", "rpc"]);
		assert.match(call.cwd ?? "", /resources[/\\]pi-mono-main$/);
	}

	const orcIdentity = launcher.getAgentState("orc").identity;
	const inquisitorIdentity = launcher.getAgentState("inquisitor").identity;
	assert.notEqual(orcIdentity.instanceId, inquisitorIdentity.instanceId);
	assert.equal(orcIdentity.agentRole, "orc");
	assert.equal(inquisitorIdentity.agentRole, "inquisitor");
});

test("RpcProcessLauncher writes typed stdin envelopes and parses typed telemetry envelopes", async () => {
	const telemetry: RpcTelemetryEnvelope[] = [];
	let orcChild: FakeChildProcess | undefined;
	const launcher = new RpcProcessLauncher({
		agents: [{ role: "orc", agentId: "orc-main" }],
		onTelemetry: (event) => telemetry.push(event),
		spawnFn: (() => {
			orcChild = new FakeChildProcess(201);
			return orcChild as unknown as ChildProcessWithoutNullStreams;
		}),
	});

	launcher.startAgent("orc");
	const commandWrites: Buffer[] = [];
	orcChild!.stdin.on("data", (chunk) => commandWrites.push(Buffer.from(chunk)));

	launcher.sendCommand("orc", {
		schema: "pi.rpc.command.v1",
		requestId: "req-1",
		issuedAt: "2026-03-26T00:00:00.000Z",
		target: launcher.getAgentState("orc").identity,
		command: { kind: "execute", payload: { task: "index repo" } },
	});

	assert.equal(commandWrites.length, 1);
	const writtenPayload = commandWrites[0]!.toString("utf8").trim();
	assert.match(writtenPayload, /"schema":"pi.rpc.command.v1"/);
	assert.match(writtenPayload, /"kind":"execute"/);

	orcChild!.stdout.write(`${JSON.stringify({
		schema: "pi.rpc.telemetry.v1",
		eventId: "evt-1",
		emittedAt: "2026-03-26T00:00:01.000Z",
		source: launcher.getAgentState("orc").identity,
		telemetry: { kind: "ready", severity: "info", payload: { ok: true } },
	})}\n`);

	assert.equal(telemetry.length, 1);
	assert.equal(telemetry[0]?.telemetry.kind, "ready");
});

test("RpcProcessLauncher quarantines malformed telemetry frames and only parses after LF", () => {
	const telemetry: RpcTelemetryEnvelope[] = [];
	const stderr: string[] = [];
	let orcChild: FakeChildProcess | undefined;
	const launcher = new RpcProcessLauncher({
		agents: [{ role: "orc", agentId: "orc-main" }],
		onTelemetry: (event) => telemetry.push(event),
		onStderr: (_role, chunk) => stderr.push(chunk),
		spawnFn: (() => {
			orcChild = new FakeChildProcess(202);
			return orcChild as unknown as ChildProcessWithoutNullStreams;
		}),
	});

	launcher.startAgent("orc");
	orcChild!.stdout.write("{\"schema\":\"pi.rpc.telemetry.v1\",\"eventId\":\"evt-partial\"");
	assert.equal(telemetry.length, 0);

	orcChild!.stdout.write(",\"emittedAt\":\"2026-03-26T00:00:01.000Z\",\"source\":{\"agentRole\":\"orc\",\"agentId\":\"orc-main\",\"instanceId\":\"i\",\"launchAttempt\":0},\"telemetry\":{\"kind\":\"ready\",\"severity\":\"info\",\"payload\":{\"text\":\"a\\u2028b\\u2029c\"}}}\n");
	assert.equal(telemetry.length, 1);
	assert.equal((telemetry[0]?.telemetry.payload as { text: string }).text, "a\u2028b\u2029c");

	orcChild!.stdout.write("{not-json}\n");
	assert.equal(stderr.length, 1);
	assert.match(stderr[0] ?? "", /Telemetry frame quarantined \(json_parse_error\)/);
});

test("RpcProcessLauncher enforces independent restart policy per agent role", async () => {
	const childrenByRole = new Map<RpcAgentRole, FakeChildProcess[]>();
	const launchSequence: RpcAgentRole[] = [];

	const launcher = new RpcProcessLauncher({
		restartPolicy: { enabled: true, maxRestarts: 2, restartDelayMs: 0 },
		spawnFn: ((_, args) => {
			const role = args[4] as RpcAgentRole;
			launchSequence.push(role);
			const child = new FakeChildProcess(300 + launchSequence.length);
			childrenByRole.set(role, [...(childrenByRole.get(role) ?? []), child]);
			return child as unknown as ChildProcessWithoutNullStreams;
		}),
	});

	launcher.startAgent("orc");
	launcher.startAgent("inquisitor");
	childrenByRole.get("orc")?.[0]?.emit("exit", 1, null);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assert.equal((childrenByRole.get("orc") ?? []).length, 2);
	assert.equal((childrenByRole.get("inquisitor") ?? []).length, 1);
	assert.equal(launcher.getAgentState("orc").restartCount, 1);
	assert.equal(launcher.getAgentState("inquisitor").restartCount, 0);
});
