import { ProcessTerminal, type Terminal } from "@mariozechner/pi-tui";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentHost, AgentHostState } from "../agent-host.js";
import type { AnimationEngine } from "../animation-engine.js";
import type { AppStateStore } from "../app-state-store.js";
import { DefaultShellView, type ShellView } from "../shell-view.js";
import { createShellNextActions, type ShellNextActions } from "./actions.js";
import { createShellNextChrome, type ShellNextChrome } from "./chrome.js";
import { createShellNextRenderer, type ShellNextRenderer } from "./renderer.js";
import { createInitialShellNextState, type ShellNextState } from "./state.js";

export interface ShellNextControllerOptions {
	terminal?: Terminal;
	stateStore: AppStateStore;
	getHostState: () => AgentHostState | undefined;
	getMessages: () => AgentMessage[];
	getAgentHost: () => AgentHost | undefined;
	animationEngine?: AnimationEngine;
}

export interface ShellNextController {
	readonly shellView: ShellView;
	readonly state: ShellNextState;
	readonly actions: ShellNextActions;
	readonly renderer: ShellNextRenderer;
	readonly chrome: ShellNextChrome;
}

export function createShellNextController(options: ShellNextControllerOptions): ShellNextController {
	const state = createInitialShellNextState();
	const actions = createShellNextActions();
	const renderer = createShellNextRenderer();
	const chrome = createShellNextChrome();

	// Initial migration step: route Shell Next through current DefaultShellView so
	// both implementations are hostable while feature work continues in this namespace.
	const shellView = new DefaultShellView(
		options.terminal ?? new ProcessTerminal(),
		options.stateStore,
		options.getHostState,
		options.getMessages,
		options.getAgentHost,
		options.animationEngine,
	);

	return {
		shellView,
		state,
		actions,
		renderer,
		chrome,
	};
}
