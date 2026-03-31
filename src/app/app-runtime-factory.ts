import { getEnvApiKey, stream, streamSimple, supportsXhigh, type ProviderStreamOptions } from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { PiMonoAppDebugger } from "../app-debugger.js";
import type { AppConfigRepository } from "./app-config-repository.js";
import type { AgentHost } from "../agent-host.js";
import type { VibeAppMode } from "../app-mode.js";
import { createDefaultAgentHost } from "../debug-agent-host.js";
import {
	AuthStorage,
	ModelRegistry,
	type AgentSession,
} from "../local-coding-agent.js";
import { createOrcAgentHost } from "../orchestration/orc-agent-host.js";
import { CompatAgentRuntime } from "../runtime/compat-agent-runtime.js";
import { CoordinatedAgentHost } from "../runtime/coordinated-agent-host.js";
import { RuntimeCoordinator } from "../runtime/runtime-coordinator.js";
import { createWebTools } from "../tools/web-tools.js";
import type { VibeAgentAppOptions } from "../types.js";

const OPENAI_REASONING_APIS = new Set(["openai-responses", "azure-openai-responses", "openai-codex-responses"]);

function createOpenAIReasoningSummaryStreamFn(): StreamFn {
	return (model, context, options) => {
		if (!OPENAI_REASONING_APIS.has(model.api) || !model.reasoning || !options?.reasoning) {
			return streamSimple(model, context, options);
		}

		const reasoningEffort =
			options.reasoning === "xhigh" && !supportsXhigh(model)
				? "high"
				: options.reasoning;

		const providerOptions: ProviderStreamOptions = {
			...options,
			reasoning: undefined,
			reasoningEffort,
			reasoningSummary: "detailed",
		};
		return stream(model, context, providerOptions);
	};
}

export interface AppRuntimeFactoryResult {
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	runtimeCoordinator: RuntimeCoordinator;
	host: AgentHost;
}

export function createAppRuntimeFactory(
	options: Pick<VibeAgentAppOptions, "host" | "runtimes" | "runtimeCoordinator" | "authStorage" | "getEnvApiKey"> & {
		debuggerSink: PiMonoAppDebugger;
		durableRootPath: string;
		appMode: VibeAppMode;
		configRepository: AppConfigRepository;
		onSessionReady: (session: AgentSession) => Promise<void>;
	},
): AppRuntimeFactoryResult {
	const authStorage = options.authStorage ?? AuthStorage.create();
	const modelRegistry = new ModelRegistry(authStorage);
	const streamFn = createOpenAIReasoningSummaryStreamFn();
	const customTools = createWebTools();

	const innerHost =
		options.host
		?? (options.appMode === "orc"
			? createOrcAgentHost({
				configRepository: options.configRepository,
				authStorage,
				modelRegistry,
				durableRootPath: options.durableRootPath,
			})
			: createDefaultAgentHost(options.debuggerSink, {
				createOptions: {
					authStorage,
					modelRegistry,
					streamFn,
					customTools,
				},
				onSessionReady: async (session) => {
					await options.onSessionReady(session);
				},
			}));

	const runtimeCoordinator =
		options.runtimeCoordinator ??
		new RuntimeCoordinator(
			options.runtimes ?? [
				new CompatAgentRuntime(
					options.appMode === "orc"
						? {
							id: "orc",
							kind: "orchestration",
							displayName: "Orc Deepagent",
							capabilities: ["interactive-prompt", "planning", "checkpoint-visibility", "orchestration-status"],
							primary: true,
						}
						: {
							id: "coding",
							kind: "coding",
							displayName: "Coding Runtime",
							capabilities: ["interactive-prompt", "session-management", "model-selection", "artifact-source", "log-source"],
							primary: true,
						},
					innerHost,
				),
			],
			{
				onRuntimeError: (runtimeId, phase, error) => {
					options.debuggerSink.logError(`runtime.${phase}.${runtimeId}`, error);
				},
			},
		);

	return {
		authStorage,
		modelRegistry,
		runtimeCoordinator,
		host: new CoordinatedAgentHost(runtimeCoordinator),
	};
}
