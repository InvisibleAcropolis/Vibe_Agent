const BRAILLE_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"] as const;

export interface AnimationState {
	hueOffset: number;    // 0-359
	spinnerFrame: number; // 0-7
	breathPhase: number;  // 0.0-1.0 sine
	glitchActive: boolean;
	tickCount: number;
}

export class AnimationEngine {
	private state: AnimationState = {
		hueOffset: 190,
		spinnerFrame: 0,
		breathPhase: 0,
		glitchActive: false,
		tickCount: 0,
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
