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
import { createSurfaceLaunchManager, type ShellSurfaceLaunchRequest, type SurfaceLaunchManager } from "./surface-launch-manager.js";
import { TranscriptTimelineController } from "./transcript-timeline.js";
import { createInitialShellNextState, type ShellNextState } from "./state.js";

export interface ShellNextControllerOptions {
	terminal?: Terminal;
	stateStore: AppStateStore;
	getHostState: () => AgentHostState | undefined;
	getMessages: () => AgentMessage[];
	getAgentHost: () => AgentHost | undefined;
	animationEngine?: AnimationEngine;
	onSurfaceLaunch?: (request: ShellSurfaceLaunchRequest) => void;
	onSurfaceClose?: (surfaceId: string) => void;
}

export interface ShellNextController {
	readonly shellView: ShellView;
	readonly state: ShellNextState;
	readonly actions: ShellNextActions;
	readonly renderer: ShellNextRenderer;
	readonly chrome: ShellNextChrome;
	readonly timeline: TranscriptTimelineController;
	readonly surfaceLaunchManager: SurfaceLaunchManager;
}

export function createShellNextController(options: ShellNextControllerOptions): ShellNextController {
	const state = createInitialShellNextState();
	const actions = createShellNextActions();
	const renderer = createShellNextRenderer();
	const chrome = createShellNextChrome();
	const timeline = new TranscriptTimelineController();

	const surfaceLaunchManager = createSurfaceLaunchManager(options.stateStore, {
		onLaunch: (request) => options.onSurfaceLaunch?.(request),
		onClose: (surfaceId) => options.onSurfaceClose?.(surfaceId),
	});
	surfaceLaunchManager.registerSurface({
		id: "sessions-browser",
		title: "Sessions Browser",
		kind: "workspace",
		routing: {
			route: "sessions-browser",
			scope: {},
		},
	});
	surfaceLaunchManager.registerSurface({
		id: "orc-session",
		title: "Orc Session",
		kind: "workspace",
		routing: {
			route: "orc-session",
			scope: {},
		},
	});
	surfaceLaunchManager.rediscoverOpenSurfaces();

	const shellView = new ShellNextView({
		terminal: options.terminal ?? new ProcessTerminal(),
		stateStore: options.stateStore,
		getHostState: options.getHostState,
	});

	return {
		shellView,
		state,
		actions,
		renderer,
		chrome,
		timeline,
		surfaceLaunchManager,
	};
}
