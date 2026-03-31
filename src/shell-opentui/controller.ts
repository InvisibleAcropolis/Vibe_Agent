import type { AgentHost, AgentHostState } from "../agent-host.js";
import type { AppStateStore } from "../app-state-store.js";
import type { ShellView } from "../shell-view.js";
import { createSurfaceLaunchManager, type ShellSurfaceLaunchRequest, type SurfaceLaunchManager } from "../shell-next/surface-launch-manager.js";
import { OpenTuiOverlayController } from "./overlay-controller.js";
import { OpenTuiShellView } from "./shell-opentui-view.js";

export interface OpenTuiControllerOptions {
	stateStore: AppStateStore;
	getHostState: () => AgentHostState | undefined;
	getAgentHost: () => AgentHost | undefined;
	onOverlayOpen?: (target: "command-palette" | "settings" | "sessions" | "orchestration") => void;
	onSurfaceLaunch?: (request: ShellSurfaceLaunchRequest) => void;
	onSurfaceClose?: (surfaceId: string) => void;
}

export interface OpenTuiShellController {
	readonly shellView: ShellView;
	readonly overlayController: OpenTuiOverlayController;
	readonly surfaceLaunchManager: SurfaceLaunchManager;
}

export function createOpenTuiShellController(
	options: OpenTuiControllerOptions,
): OpenTuiShellController {
	const shellView = new OpenTuiShellView({
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
	const overlayController = new OpenTuiOverlayController(shellView);
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
	return {
		shellView,
		overlayController,
		surfaceLaunchManager,
	};
}
