import { TUI } from "@mariozechner/pi-tui";
import type { AnimationEngine } from "./animation-engine.js";
import { createLogoBlockRows, LogoBlockView } from "./components/logo-block-view.js";
import { OffscreenTerminal } from "./offscreen-terminal.js";

type LogoPhase = "hidden" | "intro" | "hold" | "outro";

interface LogoBlockState {
	phase: LogoPhase;
	progress: number;
	totalSteps: number;
	holdTicksRemaining: number;
	randomOrder: number[];
}

const SPLASH_ROWS = 8;
const LOGO_PATTERN_STEPS = 6;
const LOGO_GLYPH_STEPS = 4;
const LOGO_TOTAL_STEPS = LOGO_PATTERN_STEPS + LOGO_GLYPH_STEPS;
const LOGO_HOLD_TICKS = 38;
const LOGO_OUTRO_STEPS = 24;

export class LogoBlockSystem {
	private readonly terminal: OffscreenTerminal;
	private readonly tui: TUI;
	private readonly state: LogoBlockState = {
		phase: "hidden",
		progress: 0,
		totalSteps: LOGO_TOTAL_STEPS,
		holdTicksRemaining: 0,
		randomOrder: [],
	};
	private animationUnsubscribe?: () => void;
	private currentFrame: string[] = [];
	private currentColumns: number;

	constructor(
		columns: number,
		private readonly animationEngine: AnimationEngine,
		private readonly onFrame: (lines: string[]) => void,
	) {
		this.currentColumns = columns;
		this.terminal = new OffscreenTerminal(columns, SPLASH_ROWS);
		this.tui = new TUI(this.terminal, false);
		this.tui.addChild(new LogoBlockView(() => ({
			phase: this.state.phase,
			progress: this.state.progress,
			totalSteps: this.state.totalSteps,
			randomOrder: this.state.randomOrder,
		})));
	}

	start(): void {
		this.animationUnsubscribe?.();
		this.tui.start();
		this.resetForBootstrap();
		void this.renderFrame();
		this.animationUnsubscribe = this.animationEngine.subscribe(() => {
			void this.advance();
		});
	}

	dismiss(): void {
		// Timer-owned lifecycle only.
	}

	isVisible(): boolean {
		return this.state.phase !== "hidden" || this.state.progress > 0;
	}

	getFrame(): string[] {
		return [...this.currentFrame];
	}

	resize(columns: number, _rows: number): void {
		this.currentColumns = columns;
		this.terminal.resize(columns, SPLASH_ROWS);
		if (this.state.phase === "outro") {
			this.state.randomOrder = this.buildRandomOrder(columns);
		}
		void this.renderFrame();
	}

	dispose(): void {
		this.animationUnsubscribe?.();
		this.animationUnsubscribe = undefined;
		this.state.phase = "hidden";
		this.state.progress = 0;
		this.state.holdTicksRemaining = 0;
		this.state.randomOrder = [];
		this.currentFrame = [];
		this.onFrame([]);
		this.tui.stop();
	}

	private resetForBootstrap(): void {
		this.state.phase = "intro";
		this.state.progress = 1;
		this.state.totalSteps = LOGO_TOTAL_STEPS;
		this.state.holdTicksRemaining = LOGO_HOLD_TICKS;
		this.state.randomOrder = [];
	}

	private async advance(): Promise<void> {
		if (this.state.phase === "intro") {
			if (this.state.progress < this.state.totalSteps) {
				this.state.progress += 1;
			} else {
				this.state.phase = "hold";
				this.state.progress = this.state.totalSteps;
			}
			await this.renderFrame();
			return;
		}

		if (this.state.phase === "hold") {
			if (this.state.holdTicksRemaining > 0) {
				this.state.holdTicksRemaining -= 1;
			}
			if (this.state.holdTicksRemaining <= 0) {
				this.state.phase = "outro";
				this.state.progress = 0;
				this.state.totalSteps = LOGO_OUTRO_STEPS;
				this.state.randomOrder = this.buildRandomOrder(this.currentColumns);
			}
			await this.renderFrame();
			return;
		}

		if (this.state.phase === "outro") {
			if (this.state.progress < this.state.totalSteps) {
				this.state.progress += 1;
			}
			if (this.state.progress >= this.state.totalSteps) {
				this.state.progress = 0;
				this.state.phase = "hidden";
				this.state.totalSteps = LOGO_TOTAL_STEPS;
				this.state.randomOrder = [];
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

	private buildRandomOrder(width: number): number[] {
		const rows = createLogoBlockRows(width);
		const visibleCount = rows.reduce((total, line) => {
			let count = total;
			for (const char of line) {
				if (char !== " ") {
					count += 1;
				}
			}
			return count;
		}, 0);
		const order = Array.from({ length: visibleCount }, (_, index) => index);
		for (let index = order.length - 1; index > 0; index--) {
			const swapIndex = Math.floor(Math.random() * (index + 1));
			const next = order[index]!;
			order[index] = order[swapIndex]!;
			order[swapIndex] = next;
		}
		return order;
	}
}
