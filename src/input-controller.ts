import { matchesKey, type TUI } from "@mariozechner/pi-tui";
import type { PiMonoAppDebugger } from "./app-debugger.js";
import type { AppStateStore } from "./app-state-store.js";
import type { OverlayController } from "./overlay-controller.js";
import type { MouseEvent } from "./mouse.js";
import { parseMouseEvent } from "./mouse.js";
import type { MainShellAdapter } from "./shell/main-shell-adapter.js";
import type { ShellInputAction } from "./shell/shell-input-actions.js";

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
		private readonly shellAdapter: MainShellAdapter,
		private readonly debuggerSink: PiMonoAppDebugger,
		private readonly onStop: () => void,
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
			if (this.overlayController.getOverlayDepth() > 0) {
				if (!this.overlayController.dispatchMouse(mouseEvent) && !this.shellAdapter.shellView.dispatchMouse(mouseEvent)) {
					return undefined;
				}
			} else if (!this.shellAdapter.shellView.dispatchMouse(mouseEvent)) {
				return undefined;
			}
			this.tui.requestRender();
			return { consume: true };
		}

		if (this.overlayController.getOverlayDepth() === 0) {
			if (data === "\x1b[5~") {
				this.dispatchShellAction({ type: "scroll", target: "page-up" });
				return { consume: true };
			}
			if (data === "\x1b[6~") {
				this.dispatchShellAction({ type: "scroll", target: "page-down" });
				return { consume: true };
			}
			if (matchesKey(data, "home") || data === "\x1b[H") {
				this.dispatchShellAction({ type: "scroll", target: "top" });
				return { consume: true };
			}
			if (matchesKey(data, "end") || data === "\x1b[F") {
				this.dispatchShellAction({ type: "scroll", target: "bottom" });
				return { consume: true };
			}
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
			this.dispatchShellAction({ type: "overlay-open", target: "settings" });
			return { consume: true };
		}
		if (matchesKey(nextData, "f2")) {
			this.dispatchShellAction({ type: "overlay-open", target: "sessions" });
			return { consume: true };
		}
		if (matchesKey(nextData, "f3")) {
			this.dispatchShellAction({ type: "overlay-open", target: "orchestration" });
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

	private dispatchShellAction(action: ShellInputAction): void {
		this.shellAdapter.dispatchShellAction(action);
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
