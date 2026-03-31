import type { PiMonoAppDebugger } from "../app-debugger.js";
import type { AppStateStore } from "../app-state-store.js";
import type { AnimationEngine } from "../animation-engine.js";
import type { OverlayController } from "../overlay-controller.js";
import type { ShellView } from "../shell-view.js";
import type { SplashWindowController } from "../splash-window-controller.js";
import type { StartupController } from "../startup-controller.js";
import type { AgentHost } from "../agent-host.js";

export class AppLifecycleController {
	private running = false;
	private focusedComponent: unknown = null;
	private focusedLabel = "editor";

	constructor(
		private readonly shellView: ShellView,
		private readonly stateStore: AppStateStore,
		private readonly debuggerSink: PiMonoAppDebugger,
		private readonly animationEngine: AnimationEngine,
		private readonly splashWindowController: SplashWindowController,
		private readonly startupController: StartupController,
		private readonly overlayController: OverlayController,
		private readonly host: AgentHost,
	) {}

	start(onStartup: () => Promise<void>): void {
		if (this.running) {
			return;
		}
		this.running = true;
		this.debuggerSink.log("app.start", { cwd: process.cwd() });
		this.shellView.setTitle("Vibe Agent");
		this.animationEngine.start();
		this.shellView.start();
		this.splashWindowController.start();
		void onStartup().catch((error) => {
			this.debuggerSink.logError("startup.sequence.error", error);
		});
	}

	stop(): void {
		if (!this.running) {
			return;
		}
		this.running = false;
		this.debuggerSink.log("app.stop.start");
		this.splashWindowController.dispose();
		this.animationEngine.stop();
		this.startupController.dispose();
		this.overlayController.closeAllOverlays();
		void this.host
			.stop()
			.catch((error) => this.debuggerSink.logError("app.stop.host", error))
			.finally(() => {
				this.shellView.stop();
				this.debuggerSink.log("app.stop.end");
			});
	}

	setFocus(component: unknown, label: string): void {
		this.focusedComponent = component;
		this.focusedLabel = label;
		this.stateStore.setFocusLabel(label);
		this.shellView.setFocus(component);
	}

	getFocusedComponent(): unknown {
		return this.focusedComponent;
	}

	getFocusedLabel(): string {
		return this.focusedLabel;
	}

	handleRuntimeError(context: string, error: unknown): void {
		this.debuggerSink.logError(`runtime.${context}`, error);
		this.stateStore.setStatusMessage(`${context}: ${error instanceof Error ? error.message : String(error)}`);
	}
}
