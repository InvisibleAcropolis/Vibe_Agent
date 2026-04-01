import type { KeyEvent } from "@opentui/core";
import type { PiMonoAppDebugger } from "../app-debugger.js";
import type { AppStateStore } from "../app-state-store.js";
import type { InputController } from "../input-controller.js";
import type { OverlayController } from "../overlay-controller.js";
import type { MainShellAdapter } from "../shell/main-shell-adapter.js";
import type { ShellInputAction } from "../shell/shell-input-actions.js";

type TerminalInputHandler = (data: string) => { consume?: boolean; data?: string } | undefined;

type GlobalInputShellView = {
	registerGlobalKeyHandler?: (handler: (event: KeyEvent) => void) => () => void;
};

export class OpenTuiInputController implements InputController {
	private readonly terminalInputHandlers = new Set<TerminalInputHandler>();
	private detachGlobalKeyHandler?: () => void;

	constructor(
		private readonly stateStore: AppStateStore,
		private readonly overlayController: OverlayController,
		private readonly shellAdapter: MainShellAdapter,
		private readonly debuggerSink: PiMonoAppDebugger,
		private readonly onStop: () => void,
	) {}

	attach(): void {}

	bindShellView(shellView: GlobalInputShellView): void {
		this.detachGlobalKeyHandler?.();
		this.detachGlobalKeyHandler = shellView.registerGlobalKeyHandler?.((event) => this.handleGlobalInput(event));
	}

	registerTerminalInputHandler(handler: TerminalInputHandler): () => void {
		this.terminalInputHandlers.add(handler);
		return () => this.terminalInputHandlers.delete(handler);
	}

	private handleGlobalInput(event: KeyEvent): void {
		if (event.defaultPrevented || event.propagationStopped) {
			return;
		}

		this.debuggerSink.log("input.global", {
			...this.debuggerSink.describeInput(event.sequence),
			focus: this.stateStore.getState().focusLabel,
			overlayDepth: this.overlayController.getOverlayDepth(),
			key: {
				name: event.name,
				ctrl: event.ctrl,
				shift: event.shift,
				meta: event.meta,
				type: event.eventType,
			},
		});

		if (this.overlayController.getOverlayDepth() === 0) {
			if (event.name === "pageup") {
				this.dispatchShellAction(event, { type: "scroll", target: "page-up" });
				return;
			}
			if (event.name === "pagedown") {
				this.dispatchShellAction(event, { type: "scroll", target: "page-down" });
				return;
			}
			if (event.name === "home") {
				this.dispatchShellAction(event, { type: "scroll", target: "top" });
				return;
			}
			if (event.name === "end") {
				this.dispatchShellAction(event, { type: "scroll", target: "bottom" });
				return;
			}
		}

		for (const handler of this.terminalInputHandlers) {
			const result = handler(event.sequence);
			if (result?.consume) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}
		}

		if (event.ctrl && event.name === "q") {
			event.preventDefault();
			event.stopPropagation();
			this.onStop();
			return;
		}
		if (event.name === "f1") {
			this.dispatchShellAction(event, { type: "overlay-open", target: "settings" });
			return;
		}
		if (event.name === "f2") {
			this.dispatchShellAction(event, { type: "overlay-open", target: "sessions" });
			return;
		}
		if (event.ctrl && event.name === "b") {
			this.dispatchShellAction(event, { type: "surface-launch", target: "sessions-browser" });
			return;
		}
		if ((event.name === "escape" || event.name === "esc") && this.overlayController.getOverlayDepth() > 0) {
			event.preventDefault();
			event.stopPropagation();
			this.overlayController.closeTopOverlay();
		}
	}

	private dispatchShellAction(event: KeyEvent, action: ShellInputAction): void {
		event.preventDefault();
		event.stopPropagation();
		this.shellAdapter.dispatchShellAction(action);
	}
}
