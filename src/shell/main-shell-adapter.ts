import { ProcessTerminal, type Terminal } from "@mariozechner/pi-tui";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentHost, AgentHostState } from "../agent-host.js";
import type { AnimationEngine } from "../animation-engine.js";
import type { AppStateStore } from "../app-state-store.js";
import { DefaultShellView, type ShellView } from "../shell-view.js";
import { createShellNextController } from "../shell-next/controller.js";
import type { LaunchSurfaceTarget, OverlayTarget, ShellInputAction } from "./shell-input-actions.js";

export type MainShellImplementation = "legacy" | "next";

export interface MainShellAdapterOptions {
	implementation: MainShellImplementation;
	terminal?: Terminal;
	stateStore: AppStateStore;
	getHostState: () => AgentHostState | undefined;
	getMessages: () => AgentMessage[];
	getAgentHost: () => AgentHost | undefined;
	animationEngine?: AnimationEngine;
	onOverlayOpen?: (target: OverlayTarget) => void;
	onSurfaceLaunch?: (target: LaunchSurfaceTarget) => void;
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
				options.onSurfaceLaunch?.(action.target);
				return true;
		}
	};

	if (options.implementation === "next") {
		const nextController = createShellNextController({
			terminal: options.terminal,
			stateStore: options.stateStore,
			getHostState: options.getHostState,
			getMessages: options.getMessages,
			getAgentHost: options.getAgentHost,
			animationEngine: options.animationEngine,
			onSurfaceLaunch: (request) => options.onSurfaceLaunch?.(request.route as LaunchSurfaceTarget),
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
		dispatchShellAction: (action) => dispatchShellAction(shellView, action),
	};
}
