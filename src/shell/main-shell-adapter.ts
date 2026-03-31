import { ProcessTerminal, type Terminal } from "@mariozechner/pi-tui";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentHost, AgentHostState } from "../agent-host.js";
import type { AnimationEngine } from "../animation-engine.js";
import type { AppStateStore } from "../app-state-store.js";
import { DefaultShellView, type ShellView } from "../shell-view.js";
import { createShellNextController } from "../shell-next/controller.js";

export type MainShellImplementation = "legacy" | "next";

export interface MainShellAdapterOptions {
	implementation: MainShellImplementation;
	terminal?: Terminal;
	stateStore: AppStateStore;
	getHostState: () => AgentHostState | undefined;
	getMessages: () => AgentMessage[];
	getAgentHost: () => AgentHost | undefined;
	animationEngine?: AnimationEngine;
}

/**
 * Main-shell integration seam used by the app lifecycle.
 *
 * Both legacy and next-generation shell implementations provide the same
 * externally-consumed shell view contract (`ShellView`) so the rest of the app
 * can remain implementation-agnostic during migration.
 */
export interface MainShellAdapter {
	readonly implementation: MainShellImplementation;
	readonly shellView: ShellView;
}

export function createMainShellAdapter(options: MainShellAdapterOptions): MainShellAdapter {
	if (options.implementation === "next") {
		const nextController = createShellNextController({
			terminal: options.terminal,
			stateStore: options.stateStore,
			getHostState: options.getHostState,
			getMessages: options.getMessages,
			getAgentHost: options.getAgentHost,
			animationEngine: options.animationEngine,
		});
		return {
			implementation: "next",
			shellView: nextController.shellView,
		};
	}

	return {
		implementation: "legacy",
		shellView: new DefaultShellView(
			options.terminal ?? new ProcessTerminal(),
			options.stateStore,
			options.getHostState,
			options.getMessages,
			options.getAgentHost,
			options.animationEngine,
		),
	};
}
