import { ProcessTerminal, type Terminal } from "@mariozechner/pi-tui";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentHost, AgentHostState } from "../agent-host.js";
import type { AnimationEngine } from "../animation-engine.js";
import type { AppStateStore } from "../app-state-store.js";
import { DefaultShellView, type ShellView } from "../shell-view.js";
import { LazyOpenTuiShellView } from "../shell-opentui/lazy-shell-view.js";
import { createShellNextController } from "../shell-next/controller.js";
import { createSurfaceLaunchManager } from "../shell-next/surface-launch-manager.js";
import type { ShellSurfaceLaunchRequest } from "../shell-next/surface-launch-manager.js";
import type { LaunchSurfaceTarget, OverlayTarget, ShellInputAction } from "./shell-input-actions.js";

export type MainShellImplementation = "legacy" | "next" | "opentui";

export interface MainShellAdapterOptions {
	implementation: MainShellImplementation;
	terminal?: Terminal;
	stateStore: AppStateStore;
	getHostState: () => AgentHostState | undefined;
	getMessages: () => AgentMessage[];
	getAgentHost: () => AgentHost | undefined;
	animationEngine?: AnimationEngine;
	onOverlayOpen?: (target: OverlayTarget) => void;
	onSurfaceLaunch?: (request: ShellSurfaceLaunchRequest) => void;
	onSurfaceClose?: (surfaceId: string) => void;
	onPromptFocus?: () => void;
	onToggleFollow?: () => void;
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
	dispatchShellAction(action: ShellInputAction): boolean;
}

export function createMainShellAdapter(options: MainShellAdapterOptions): MainShellAdapter {
	const dispatchShellAction = (shellView: ShellView, action: ShellInputAction): boolean => {
		switch (action.type) {
			case "scroll":
				switch (action.target) {
					case "page-up":
						shellView.scrollTranscript(-10);
						return true;
					case "page-down":
						shellView.scrollTranscript(10);
						return true;
					case "top":
						shellView.scrollTranscriptToTop();
						return true;
					case "bottom":
						shellView.scrollTranscriptToBottom();
						return true;
				}
			case "follow-toggle":
				options.onToggleFollow?.();
				return true;
			case "prompt-focus":
				options.onPromptFocus?.();
				return true;
			case "overlay-open":
				options.onOverlayOpen?.(action.target);
				return true;
			case "surface-launch":
				options.onSurfaceLaunch?.({
					surfaceId: action.target,
					route: action.target,
					kind: "workspace",
					scope: {},
					reason: "open",
				});
				return true;
		}
	};

	const createDefaultSurfaceManager = () => {
		const manager = createSurfaceLaunchManager(options.stateStore, {
			onLaunch: (request) => options.onSurfaceLaunch?.(request),
			onClose: (surfaceId) => options.onSurfaceClose?.(surfaceId),
		});
		manager.registerSurface({
			id: "sessions-browser",
			title: "Sessions Browser",
			kind: "workspace",
			routing: {
				route: "sessions-browser",
				scope: {},
			},
		});
		manager.registerSurface({
			id: "orc-session",
			title: "Orc Session",
			kind: "workspace",
			routing: {
				route: "orc-session",
				scope: {},
			},
		});
		manager.rediscoverOpenSurfaces();
		return manager;
	};

	if (options.implementation === "next") {
		const nextController = createShellNextController({
			terminal: options.terminal,
			stateStore: options.stateStore,
			getHostState: options.getHostState,
			getMessages: options.getMessages,
			getAgentHost: options.getAgentHost,
			animationEngine: options.animationEngine,
			onSurfaceLaunch: (request) => options.onSurfaceLaunch?.(request),
			onSurfaceClose: (surfaceId) => options.onSurfaceClose?.(surfaceId),
		});
		return {
			implementation: "next",
			shellView: nextController.shellView,
			dispatchShellAction: (action) => {
				if (action.type === "surface-launch") {
					nextController.surfaceLaunchManager.launchSurface(action.target);
					return true;
				}
				return dispatchShellAction(nextController.shellView, action);
			},
		};
	}

	if (options.implementation === "opentui") {
		const surfaceLaunchManager = createDefaultSurfaceManager();
		const shellView = new LazyOpenTuiShellView({
			stateStore: options.stateStore,
			getHostState: options.getHostState,
			onShellAction: (action) => {
				if (action.type === "overlay-open") {
					options.onOverlayOpen?.(action.target);
					return;
				}
				surfaceLaunchManager.launchSurface(action.target);
			},
		});
		return {
			implementation: "opentui",
			shellView,
			dispatchShellAction: (action) => {
				if (action.type === "surface-launch") {
					surfaceLaunchManager.launchSurface(action.target);
					return true;
				}
				return dispatchShellAction(shellView, action);
			},
		};
	}

	const legacySurfaceLaunchManager = createDefaultSurfaceManager();
	const shellView = new DefaultShellView(
		options.terminal ?? new ProcessTerminal(),
		options.stateStore,
		options.getHostState,
		options.getMessages,
		options.getAgentHost,
		options.animationEngine,
	);

	return {
		implementation: "legacy",
		shellView,
		dispatchShellAction: (action) => {
			if (action.type === "surface-launch") {
				legacySurfaceLaunchManager.launchSurface(action.target);
				return true;
			}
			return dispatchShellAction(shellView, action);
		},
	};
}
