import { ProcessTerminal, TUI, type Component } from "@mariozechner/pi-tui";
import { createAppDebugger, type PiMonoAppDebugger } from "./app-debugger.js";
import { AnimationEngine } from "./animation-engine.js";
import { paintLine, paintLineTwoParts } from "./ansi.js";
import { getVibeDurableRoot } from "./durable/durable-paths.js";
import { MouseEnabledTerminal } from "./mouse-enabled-terminal.js";
import { SplashWindowController } from "./splash-window-controller.js";
import { agentTheme } from "./theme.js";

export interface SplashPaneAppOptions {
	debugger?: PiMonoAppDebugger;
	sessionName?: string;
	durableRootPath?: string;
}

export interface SplashPaneAppHandle {
	stop(): void;
	writeDebugSnapshot(reason: string): string | undefined;
}

class SplashPaneBackdrop implements Component {
	constructor(
		private readonly getRows: () => number,
		private readonly getSessionLabel: () => string,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const rows = Math.max(3, this.getRows());
		const lines = Array.from({ length: rows }, () => paintLine("", width, agentTheme.panelBgActive));
		lines[0] = agentTheme.headerLine(
			paintLineTwoParts(
				agentTheme.accentStrong(" Secondary Pane Splash Host "),
				agentTheme.chromeMeta(` session:${this.getSessionLabel()} `),
				width,
			),
		);
		lines[rows - 2] = paintLine(agentTheme.dim("Passive bootstrap splash host"), width, agentTheme.panelBgRaised);
		lines[rows - 1] = agentTheme.footerLine(
			paintLineTwoParts(
				agentTheme.dim("Waiting for replay signal"),
				agentTheme.accent("secondary pane"),
				width,
			),
		);
		return lines;
	}
}

class SplashPaneApp implements SplashPaneAppHandle {
	private readonly terminal = new MouseEnabledTerminal(new ProcessTerminal());
	private readonly tui = new TUI(this.terminal, true);
	private readonly animationEngine = new AnimationEngine();
	private readonly splashController: SplashWindowController;

	constructor(
		private readonly debuggerSink: PiMonoAppDebugger,
		options: SplashPaneAppOptions,
	) {
		this.splashController = new SplashWindowController(this.tui, this.animationEngine, {
			sessionName: options.sessionName,
			durableRootPath: options.durableRootPath ?? getVibeDurableRoot(),
		});
		this.tui.addChild(
			new SplashPaneBackdrop(
				() => this.terminal.rows,
				() => options.sessionName ?? "detached",
			),
		);
	}

	start(): void {
		this.debuggerSink.log("splash-pane.start", { cwd: process.cwd() });
		this.terminal.setTitle("Vibe Agent Splash");
		this.animationEngine.start();
		this.tui.start();
		this.splashController.start();
	}

	stop(): void {
		this.debuggerSink.log("splash-pane.stop");
		this.splashController.dispose();
		this.animationEngine.stop();
		this.tui.stop();
	}

	writeDebugSnapshot(_reason: string): string | undefined {
		return undefined;
	}
}

export function startSplashPaneApp(options: SplashPaneAppOptions = {}): SplashPaneAppHandle {
	const debuggerSink =
		options.debugger
		?? createAppDebugger({
			appName: "vibe-splash-pane",
			appRoot: process.cwd(),
		});
	const app = new SplashPaneApp(debuggerSink, options);
	app.start();
	return app;
}
