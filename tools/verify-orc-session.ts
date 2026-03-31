import { spawn } from "node:child_process";
import path from "node:path";
import { AppConfigRepository } from "../src/app/app-config-repository.js";
import { AuthStorage, ModelRegistry } from "../src/local-coding-agent.js";
import { getVibeConfigPath, getVibeDurableRoot } from "../src/durable/durable-paths.js";
import { OrcExternalSessionLauncher } from "../src/orchestration/orc-session-launcher.js";
import { buildOrcPythonEnv, getOrcRepoRoot, resolvePreferredPythonInvocation, verifyPythonModules, type OrcPythonInvocation } from "../src/orchestration/orc-python-environment.js";
import { OrcSharedLaunchContextResolver, type OrcResolvedLaunchContext } from "../src/orchestration/orc-shared-launch-context.js";

async function main(): Promise<void> {
	const args = new Set(process.argv.slice(2));
	const workspaceRoot = path.resolve(getArgValue("--workspace-root") ?? process.cwd());
	const launch = args.has("--launch");

	const configRepository = new AppConfigRepository(getVibeConfigPath("vibe-agent-config.json", { durableRoot: getVibeDurableRoot() }));
	const authStorage = AuthStorage.create();
	const modelRegistry = new ModelRegistry(authStorage);
	const resolver = new OrcSharedLaunchContextResolver(configRepository, authStorage, modelRegistry);
	const selection = await resolver.resolveSavedSelection();
	const python = await resolvePreferredPythonInvocation();
	const env = buildOrcPythonEnv({
		[selection.apiKeyEnvVar]: selection.apiKey,
		ORC_PROVIDER_ID: selection.providerId,
		ORC_MODEL_ID: selection.modelId,
		ORC_MODEL_SPEC: selection.modelSpec,
	});

	await verifyPythonModules(python, env, selection.requiredPythonModules);
	const smoke = await runRunnerSmokeTest({ workspaceRoot, python, env, selection });

	console.log(JSON.stringify({
		selection: {
			providerId: selection.providerId,
			modelId: selection.modelId,
			modelSpec: selection.modelSpec,
		},
		python: python.label,
		smoke,
	}, null, 2));

	if (launch) {
		const launcher = new OrcExternalSessionLauncher({
			configRepository,
			authStorage,
			modelRegistry,
			workspaceRoot,
		});
		const result = await launcher.launchOrAttach();
		console.log(JSON.stringify({ launch: result }, null, 2));
	}
}

async function runRunnerSmokeTest(input: {
	workspaceRoot: string;
	python: OrcPythonInvocation;
	env: NodeJS.ProcessEnv;
	selection: OrcResolvedLaunchContext;
}): Promise<{ ok: true; graphCompleted: boolean; agentMessage: boolean }> {
	const payload = {
		threadId: `orc-smoke-${Date.now()}`,
		projectRoot: input.workspaceRoot,
		workspaceRoot: input.workspaceRoot,
		prompt: "State the selected provider and model in one concise sentence.",
		phaseIntent: "launch:bootstrapping",
		securityPolicy: {
			allowedWorkingDirectories: [input.workspaceRoot],
			blockedCommandPatterns: [],
			maximumConcurrency: 1,
			humanEscalationThresholds: {
				requiresApprovalAfter: 1,
				reasons: [],
			},
			workerSandbox: {
				workspaceRoot: input.workspaceRoot,
				durableRoot: getVibeDurableRoot(),
				writeAllowedPaths: [input.workspaceRoot],
				blockedCommandPatterns: [],
			},
			sessionKind: "main-app",
		},
		resume: {
			metadata: {},
		},
		graphName: "orc_langgraph",
		selectedProviderId: input.selection.providerId,
		selectedModelId: input.selection.modelId,
		modelSpec: input.selection.modelSpec,
		metadata: {
			projectId: path.basename(input.workspaceRoot) || "workspace",
		},
	};

	return await new Promise((resolve, reject) => {
		const child = spawn(input.python.command, [...input.python.args, "-m", "src.orchestration.python.orc_runner"], {
			cwd: getOrcRepoRoot(),
			env: input.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error("Runner smoke test timed out after 120 seconds."));
		}, 120_000);

		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		child.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once("exit", (exitCode) => {
			clearTimeout(timeout);
			if (exitCode !== 0) {
				reject(new Error(stderr.trim() || stdout.trim() || `Runner smoke test exited with code ${exitCode ?? "unknown"}.`));
				return;
			}
			const lines = stdout
				.split(/\r?\n/u)
				.map((line) => line.trim())
				.filter(Boolean);
			const envelopes = lines.map((line) => JSON.parse(line) as { what?: { category?: string; name?: string; status?: string } });
			const graphCompleted = envelopes.some((event) => event.what?.category === "lifecycle" && event.what?.name === "graph_completed");
			const agentMessage = envelopes.some((event) => event.what?.category === "agent_message");
			if (!graphCompleted || !agentMessage) {
				reject(new Error("Runner smoke test completed without the expected Orc lifecycle/message envelopes."));
				return;
			}
			resolve({ ok: true, graphCompleted, agentMessage });
		});

		child.stdin.write(`${JSON.stringify(payload)}\n`);
		child.stdin.end();
	});
}

function getArgValue(name: string): string | undefined {
	const arg = process.argv.slice(2).find((entry) => entry.startsWith(`${name}=`));
	return arg ? arg.slice(name.length + 1) : undefined;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});

