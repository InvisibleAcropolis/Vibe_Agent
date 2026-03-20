const BRAILLE_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"] as const;

export interface AnimationState {
	hueOffset: number;    // 0-359
	spinnerFrame: number; // 0-7
	breathPhase: number;  // 0.0-1.0 sine
	glitchActive: boolean;
	tickCount: number;
	// --- New fields ---
	focusFlashTicks: number;      // A: counts down 3→0 on focus change
	focusedComponent: "editor" | "sessions" | "overlay"; // A
	wipeTransition: { active: boolean; frame: number }; // B: frame 0 = trigger value; 1-3 = fill chars during tick; ≥4 = done (resets)
	separatorOffset: number;      // C: increments every 8 ticks for crawling separator
	typewriter: { target: string; displayed: string; ticksSinceChar: number }; // E
}

export class AnimationEngine {
	private state: AnimationState = {
		hueOffset: 190,
		spinnerFrame: 0,
		breathPhase: 0,
		glitchActive: false,
		tickCount: 0,
		focusFlashTicks: 0,
		focusedComponent: "editor",
		wipeTransition: { active: false, frame: 0 },
		separatorOffset: 0,
		typewriter: { target: "", displayed: "", ticksSinceChar: 0 },
	};
	private timer: ReturnType<typeof setInterval> | null = null;
	private isStreaming = false;
	private glitchTicksRemaining = 0;
	private onTickCallback?: (state: AnimationState) => void;

	setOnTick(cb: (state: AnimationState) => void): void {
		this.onTickCallback = cb;
	}

	start(): void {
		if (this.timer !== null) return;
		this.timer = setInterval(() => this.tick(), 80);
		// Allow Node.js to exit even if the timer is still running
		(this.timer as any).unref?.();
	}

	stop(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	getState(): AnimationState {
		return { ...this.state };
	}

	setStreaming(streaming: boolean): void {
		this.isStreaming = streaming;
	}

	getSpinnerChar(): string {
		return BRAILLE_FRAMES[this.state.spinnerFrame] ?? "⣾";
	}

	/** A: Trigger selection flash on focus change */
	triggerFocusFlash(component: "editor" | "sessions" | "overlay"): void {
		this.state.focusFlashTicks = 3;
		this.state.focusedComponent = component;
	}

	/** B: Trigger block-fill wipe (call when switching sessions) */
	triggerWipeTransition(): void {
		this.state.wipeTransition = { active: true, frame: 0 };
	}

	/** E: Set typewriter target (call from setStatusMessage hook) */
	setTypewriterTarget(message: string): void {
		this.state.typewriter = { target: message, displayed: "", ticksSinceChar: 0 };
	}

	private tick(): void {
		this.state.tickCount++;
		this.state.hueOffset = (this.state.hueOffset + (this.isStreaming ? 2 : 0.8)) % 360;
		this.state.spinnerFrame = (this.state.spinnerFrame + 1) % 8;
		this.state.breathPhase = (Math.sin((this.state.tickCount / 50) * Math.PI * 2) + 1) / 2;

		// Trigger glitch every ~6 seconds (75 ticks * 80ms = 6000ms)
		if (this.state.tickCount > 0 && this.state.tickCount % 75 === 0) {
			this.glitchTicksRemaining = 3;
		}
		if (this.glitchTicksRemaining > 0) {
			this.state.glitchActive = true;
			this.glitchTicksRemaining--;
		} else {
			this.state.glitchActive = false;
		}

		// A: Focus flash countdown
		if (this.state.focusFlashTicks > 0) {
			this.state.focusFlashTicks--;
		}

		// B: Wipe transition advance
		if (this.state.wipeTransition.active) {
			this.state.wipeTransition.frame++;
			if (this.state.wipeTransition.frame >= 4) {
				this.state.wipeTransition = { active: false, frame: 0 };
			}
		}

		// C: Separator crawl
		if (this.state.tickCount % 8 === 0) {
			this.state.separatorOffset = (this.state.separatorOffset + 1) % 100;
		}

		// E: Typewriter
		if (this.state.typewriter.displayed !== this.state.typewriter.target) {
			const ticks = this.state.typewriter.ticksSinceChar + 1;
			if (ticks >= 2) {
				const next = this.state.typewriter.target.slice(0, this.state.typewriter.displayed.length + 1);
				this.state.typewriter = { ...this.state.typewriter, displayed: next, ticksSinceChar: 0 };
			} else {
				this.state.typewriter = { ...this.state.typewriter, ticksSinceChar: ticks };
			}
		}

		this.onTickCallback?.(this.state);
	}
}

// Module-level singleton for access from tool-execution.ts
let globalEngine: AnimationEngine | null = null;

export function setGlobalAnimationEngine(engine: AnimationEngine): void {
	globalEngine = engine;
}

export function getGlobalSpinnerChar(): string {
	return globalEngine?.getSpinnerChar() ?? "⣾";
}

export function getGlobalAnimationState(): AnimationState | undefined {
	return globalEngine?.getState();
}
