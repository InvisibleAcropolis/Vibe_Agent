import { ProcessTerminal, type Terminal } from "@mariozechner/pi-tui";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentHost, AgentHostState } from "../agent-host.js";
import type { AnimationEngine } from "../animation-engine.js";
import type { AppStateStore } from "../app-state-store.js";
import type { ShellView } from "../shell-view.js";
import { createShellNextActions, type ShellNextActions } from "./actions.js";
import { createShellNextChrome, type ShellNextChrome } from "./chrome.js";
import { createShellNextRenderer, type ShellNextRenderer } from "./renderer.js";
import { ShellNextView } from "./shell-next-view.js";
import { TranscriptTimelineController } from "./transcript-timeline.js";
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
	readonly timeline: TranscriptTimelineController;
}

export function createShellNextController(options: ShellNextControllerOptions): ShellNextController {
	const state = createInitialShellNextState();
	const actions = createShellNextActions();
	const renderer = createShellNextRenderer();
	const chrome = createShellNextChrome();
	const timeline = new TranscriptTimelineController();

	const shellView = new ShellNextView(options.terminal ?? new ProcessTerminal());

	return {
		shellView,
		state,
		actions,
		renderer,
		chrome,
		timeline,
	};
}
