import type { AgentHostStartResult } from "../agent-host.js";
import type { ExtensionUIContext } from "../local-coding-agent.js";
import type { AgentRuntime, RuntimeDescriptor } from "./agent-runtime.js";

type RuntimePhase = "start" | "stop";

type ActiveRuntimeListener = (runtime: AgentRuntime) => void;

export interface RuntimeCoordinatorOptions {
	onRuntimeError?: (runtimeId: string, phase: RuntimePhase, error: unknown) => void;
}

export class RuntimeCoordinator {
	private readonly runtimes = new Map<string, AgentRuntime>();
	private readonly startedRuntimeIds = new Set<string>();
	private readonly activeRuntimeListeners = new Set<ActiveRuntimeListener>();
	private activeRuntimeId?: string;
	private uiContext?: ExtensionUIContext;

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

	getDescriptor(runtimeId: string): RuntimeDescriptor | undefined {
		return this.runtimes.get(runtimeId)?.descriptor;
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

	onActiveRuntimeChange(listener: ActiveRuntimeListener): () => void {
		this.activeRuntimeListeners.add(listener);
		return () => this.activeRuntimeListeners.delete(listener);
	}

	async setActiveRuntime(runtimeId: string): Promise<void> {
		const runtime = this.runtimes.get(runtimeId);
		if (!runtime) {
			throw new Error(`Runtime not found: ${runtimeId}`);
		}
		if (!this.startedRuntimeIds.has(runtimeId) && this.uiContext) {
			await this.startRuntime(runtime, this.uiContext);
		}
		this.activeRuntimeId = runtimeId;
		for (const listener of this.activeRuntimeListeners) {
			listener(runtime);
		}
	}

	async start(uiContext: ExtensionUIContext): Promise<AgentHostStartResult> {
		this.uiContext = uiContext;
		const activeRuntime = this.getActiveRuntime();
		const startResult = await this.startRuntime(activeRuntime, uiContext);

		for (const runtime of this.runtimes.values()) {
			if (runtime.descriptor.id === activeRuntime.descriptor.id) {
				continue;
			}
			try {
				await this.startRuntime(runtime, uiContext);
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

	private async startRuntime(runtime: AgentRuntime, uiContext: ExtensionUIContext): Promise<AgentHostStartResult> {
		const startResult = await runtime.start(uiContext);
		this.startedRuntimeIds.add(runtime.descriptor.id);
		return startResult;
	}
}
