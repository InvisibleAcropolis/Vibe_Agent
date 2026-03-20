import { TUI } from "@mariozechner/pi-tui";
import { LogoBlockView } from "./components/logo-block-view.js";
import { OffscreenTerminal } from "./offscreen-terminal.js";

type LogoPhase = "hidden" | "intro" | "visible" | "outro";

interface LogoBlockState {
	phase: LogoPhase;
	progress: number;
	totalSteps: number;
}

const SPLASH_ROWS = 8;
const LOGO_PATTERN_STEPS = 6;
const LOGO_GLYPH_STEPS = 4;
const LOGO_TOTAL_STEPS = LOGO_PATTERN_STEPS + LOGO_GLYPH_STEPS;
const LOGO_TICK_MS = 80;

export class LogoBlockSystem {
	private readonly terminal: OffscreenTerminal;
	private readonly tui: TUI;
	private readonly state: LogoBlockState = {
		phase: "hidden",
		progress: 0,
		totalSteps: LOGO_TOTAL_STEPS,
	};
	private timer?: ReturnType<typeof setInterval>;
	private currentFrame: string[] = [];

	constructor(
		columns: number,
		private readonly onFrame: (lines: string[]) => void,
	) {
		this.terminal = new OffscreenTerminal(columns, SPLASH_ROWS);
		this.tui = new TUI(this.terminal, false);
		this.tui.addChild(new LogoBlockView(() => ({
			progress: this.state.progress,
			totalSteps: this.state.totalSteps,
		})));
	}

	start(): void {
		if (this.timer) {
			return;
		}
		this.tui.start();
		this.state.phase = "intro";
		this.state.progress = 1;
		void this.renderFrame();
		this.timer = setInterval(() => {
			void this.advance();
		}, LOGO_TICK_MS);
	}

	dismiss(): void {
		if (this.state.phase === "hidden" || this.state.phase === "outro") {
			return;
		}
		this.state.phase = "outro";
		void this.renderFrame();
	}

	isVisible(): boolean {
		return this.state.phase !== "hidden" || this.state.progress > 0;
	}

	getFrame(): string[] {
		return [...this.currentFrame];
	}

	resize(columns: number, _rows: number): void {
		this.terminal.resize(columns, SPLASH_ROWS);
		void this.renderFrame();
	}

	dispose(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.state.phase = "hidden";
		this.state.progress = 0;
		this.currentFrame = [];
		this.onFrame([]);
		this.tui.stop();
	}

	private async advance(): Promise<void> {
		if (this.state.phase === "intro") {
			if (this.state.progress < this.state.totalSteps) {
				this.state.progress += 1;
			} else {
				this.state.phase = "visible";
			}
			await this.renderFrame();
			return;
		}

		if (this.state.phase === "outro") {
			if (this.state.progress > 0) {
				this.state.progress -= 1;
			}
			if (this.state.progress <= 0) {
				this.state.progress = 0;
				this.state.phase = "hidden";
			}
			await this.renderFrame();
		}
	}

	private async renderFrame(): Promise<void> {
		if (this.state.phase === "hidden" && this.state.progress === 0) {
			this.currentFrame = [];
			this.onFrame([]);
			return;
		}

		this.tui.requestRender(true);
		await this.terminal.flush();
		const frame = this.trimTrailingBlankLines(this.terminal.getViewport());
		this.currentFrame = frame;
		this.onFrame(frame);
	}

	private trimTrailingBlankLines(lines: string[]): string[] {
		let end = lines.length;
		while (end > 0 && lines[end - 1]!.trim().length === 0) {
			end -= 1;
		}
		return lines.slice(0, end);
	}
}
