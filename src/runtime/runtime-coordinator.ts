import type { AgentHostStartResult } from "../agent-host.js";
import type { ExtensionUIContext } from "../local-coding-agent.js";
import type { AgentRuntime, RuntimeDescriptor } from "./agent-runtime.js";

type RuntimePhase = "start" | "stop";

export interface RuntimeCoordinatorOptions {
	onRuntimeError?: (runtimeId: string, phase: RuntimePhase, error: unknown) => void;
}

export class RuntimeCoordinator {
	private readonly runtimes = new Map<string, AgentRuntime>();
	private readonly startedRuntimeIds = new Set<string>();
	private activeRuntimeId?: string;

	constructor(
		runtimes: AgentRuntime[] = [],
		private readonly options: RuntimeCoordinatorOptions = {},
	) {
		for (const runtime of runtimes) {
			this.register(runtime);
		}
	}

	register(runtime: AgentRuntime): void {
		this.runtimes.set(runtime.descriptor.id, runtime);
		if (!this.activeRuntimeId || runtime.descriptor.primary) {
			this.activeRuntimeId = runtime.descriptor.id;
		}
	}

	listDescriptors(): RuntimeDescriptor[] {
		return [...this.runtimes.values()].map((runtime) => runtime.descriptor);
	}

	getActiveRuntime(): AgentRuntime {
		const activeRuntime = this.activeRuntimeId ? this.runtimes.get(this.activeRuntimeId) : undefined;
		if (activeRuntime) {
			return activeRuntime;
		}
		const fallbackRuntime = [...this.runtimes.values()][0];
		if (!fallbackRuntime) {
			throw new Error("No runtimes registered");
		}
		this.activeRuntimeId = fallbackRuntime.descriptor.id;
		return fallbackRuntime;
	}

	setActiveRuntime(runtimeId: string): void {
		if (!this.runtimes.has(runtimeId)) {
			throw new Error(`Runtime not found: ${runtimeId}`);
		}
		this.activeRuntimeId = runtimeId;
	}

	async start(uiContext: ExtensionUIContext): Promise<AgentHostStartResult> {
		const activeRuntime = this.getActiveRuntime();
		const startResult = await activeRuntime.start(uiContext);
		this.startedRuntimeIds.add(activeRuntime.descriptor.id);

		for (const runtime of this.runtimes.values()) {
			if (runtime.descriptor.id === activeRuntime.descriptor.id) {
				continue;
			}
			try {
				await runtime.start(uiContext);
				this.startedRuntimeIds.add(runtime.descriptor.id);
			} catch (error) {
				this.options.onRuntimeError?.(runtime.descriptor.id, "start", error);
			}
		}

		return startResult;
	}

	async stop(): Promise<void> {
		const runtimes = [...this.runtimes.values()].reverse();
		for (const runtime of runtimes) {
			if (!this.startedRuntimeIds.has(runtime.descriptor.id)) {
				continue;
			}
			try {
				await runtime.stop();
			} catch (error) {
				this.options.onRuntimeError?.(runtime.descriptor.id, "stop", error);
			} finally {
				this.startedRuntimeIds.delete(runtime.descriptor.id);
			}
		}
	}
}
