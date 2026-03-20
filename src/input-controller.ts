import { matchesKey, type TUI } from "@mariozechner/pi-tui";
import type { PiMonoAppDebugger } from "./app-debugger.js";
import type { AppStateStore } from "./app-state-store.js";
import type { CommandController } from "./command-controller.js";
import type { OverlayController } from "./overlay-controller.js";
import type { MouseEvent } from "./mouse.js";
import { parseMouseEvent } from "./mouse.js";

type TerminalInputHandler = (data: string) => { consume?: boolean; data?: string } | undefined;

export interface InputController {
	attach(): void;
	registerTerminalInputHandler(handler: TerminalInputHandler): () => void;
}

export class DefaultInputController implements InputController {
	private readonly terminalInputHandlers = new Set<TerminalInputHandler>();

	constructor(
		private readonly tui: TUI,
		private readonly stateStore: AppStateStore,
		private readonly overlayController: OverlayController,
		private readonly commandController: CommandController,
		private readonly debuggerSink: PiMonoAppDebugger,
		private readonly onStop: () => void,
		private readonly onToggleSessionsPanel?: () => void,
	) {}

	attach(): void {
		this.tui.addInputListener((data) => this.handleGlobalInput(data));
	}

	registerTerminalInputHandler(handler: TerminalInputHandler): () => void {
		this.terminalInputHandlers.add(handler);
		return () => this.terminalInputHandlers.delete(handler);
	}

	private handleGlobalInput(data: string): { consume?: boolean; data?: string } | undefined {
		this.debuggerSink.log("input.global", {
			...this.debuggerSink.describeInput(data),
			focus: this.stateStore.getState().focusLabel,
			overlayDepth: this.overlayController.getOverlayDepth(),
		});
		const mouseEvent = parseMouseEvent(data);
		if (mouseEvent) {
			this.logMouse(mouseEvent);
			this.overlayController.dispatchMouse(mouseEvent);
			this.tui.requestRender();
			return { consume: true };
		}

		let nextData = data;
		for (const handler of this.terminalInputHandlers) {
			const result = handler(nextData);
			if (result?.consume) {
				return { consume: true };
			}
			if (result?.data !== undefined) {
				nextData = result.data;
			}
		}

		if (matchesKey(nextData, "ctrl+q")) {
			this.onStop();
			return { consume: true };
		}
		if (matchesKey(nextData, "f1")) {
			this.openSettingsSubmenu();
			return { consume: true };
		}
		if (matchesKey(nextData, "f2")) {
			this.openSessionsSubmenu();
			return { consume: true };
		}
		if (matchesKey(nextData, "f3")) {
			this.onToggleSessionsPanel?.();
			return { consume: true };
		}
		if ((matchesKey(nextData, "escape") || matchesKey(nextData, "esc")) && this.overlayController.getOverlayDepth() > 0) {
			this.overlayController.closeTopOverlay();
			return { consume: true };
		}

		if (nextData !== data) {
			return { data: nextData };
		}
		return undefined;
	}

	private openSettingsSubmenu(): void {
		this.overlayController.openSelectOverlay(
			"menu-settings", "[F1] Settings",
			"Select a settings action.",
			[
				{ value: "/provider", label: "Provider",    description: "Choose or reconnect an OAuth provider." },
				{ value: "/model",    label: "Model",       description: "Choose the default model." },
				{ value: "/theme",    label: "Theme",       description: "Switch visual theme." },
				{ value: "/settings", label: "Settings",    description: "Open app settings." },
			],
			(cmd) => void this.commandController.handleSlashCommand(cmd),
		);
	}

	private openSessionsSubmenu(): void {
		this.overlayController.openSelectOverlay(
			"menu-sessions", "[F2] Sessions",
			"Select a session action.",
			[
				{ value: "/resume", label: "Resume Session", description: "Resume or switch sessions." },
				{ value: "/fork",   label: "Fork Session",   description: "Fork from a previous user message." },
				{ value: "/tree",   label: "Session Tree",   description: "Navigate branch points." },
				{ value: "/stats",  label: "Session Stats",  description: "Show token usage." },
			],
			(cmd) => void this.commandController.handleSlashCommand(cmd),
		);
	}

	private logMouse(event: MouseEvent): void {
		this.debuggerSink.log("input.mouse", {
			row: event.row,
			col: event.col,
			action: event.action,
			button: event.button,
			shift: event.shift,
			alt: event.alt,
			ctrl: event.ctrl,
		});
	}
}
