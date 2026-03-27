import type { OverlayHandle, TUI } from "@mariozechner/pi-tui";
import type { AnimationEngine } from "./animation-engine.js";
import {
	FLOATING_SPLASH_WINDOW_HEIGHT,
	FLOATING_SPLASH_WINDOW_WIDTH,
	FloatingSplashScreen,
	buildFloatingSplashVisibleCellOrder,
	type SplashPhase,
} from "./components/floating_splashscreen.js";
import { readSplashReplaySignal } from "./splash-replay-signal.js";

interface SplashWindowState {
	phase: SplashPhase;
	progress: number;
	totalSteps: number;
	holdTicksRemaining: number;
	randomOrder: number[];
}

const LOGO_INTRO_STEPS = 12;
const LOGO_HOLD_TICKS = 38;
const LOGO_OUTRO_STEPS = 24;
const REPLAY_SIGNAL_POLL_INTERVAL_TICKS = 4;

export class SplashWindowController {
	private readonly state: SplashWindowState = {
		phase: "hidden",
		progress: 0,
		totalSteps: LOGO_INTRO_STEPS,
		holdTicksRemaining: 0,
		randomOrder: [],
	};
	private readonly component: FloatingSplashScreen;
	private animationUnsubscribe?: () => void;
	private overlayHandle?: OverlayHandle;
	private lastSeenReplayToken?: string;
	private ticksSinceReplayPoll = 0;

	constructor(
		private readonly tui: TUI,
		private readonly animationEngine: AnimationEngine,
		private readonly options: {
			enabled?: boolean;
			sessionName?: string;
			durableRootPath?: string;
		} = {},
	) {
		this.component = new FloatingSplashScreen(() => ({
			phase: this.state.phase,
			progress: this.state.progress,
			totalSteps: this.state.totalSteps,
			randomOrder: this.state.randomOrder,
			animationState: this.animationEngine.getState(),
		}));
	}

	start(): void {
		if (this.options.enabled === false) {
			return;
		}
		this.animationUnsubscribe?.();
		this.lastSeenReplayToken = this.readReplayToken();
		this.restartLifecycle();
		this.animationUnsubscribe = this.animationEngine.subscribe(() => {
			this.advance();
		});
	}

	dispose(): void {
		if (this.options.enabled === false) {
			return;
		}
		this.animationUnsubscribe?.();
		this.animationUnsubscribe = undefined;
		this.hideOverlay();
		this.state.phase = "hidden";
		this.state.progress = 0;
		this.state.holdTicksRemaining = 0;
		this.state.randomOrder = [];
	}

	private advance(): void {
		this.ticksSinceReplayPoll += 1;
		if (this.ticksSinceReplayPoll >= REPLAY_SIGNAL_POLL_INTERVAL_TICKS) {
			this.ticksSinceReplayPoll = 0;
			if (this.tryReplayFromSignal()) {
				this.tui.requestRender();
				return;
			}
		}

		if (this.state.phase === "hidden") {
			return;
		}

		if (this.state.phase === "intro") {
			if (this.state.progress < this.state.totalSteps) {
				this.state.progress += 1;
			} else {
				this.state.phase = "hold";
				this.state.progress = this.state.totalSteps;
			}
			this.tui.requestRender();
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
				this.state.randomOrder = this.buildRandomOrder();
			}
			this.tui.requestRender();
			return;
		}

		if (this.state.phase === "outro") {
			if (this.state.progress < this.state.totalSteps) {
				this.state.progress += 1;
			}
			if (this.state.progress >= this.state.totalSteps) {
				this.hideOverlay();
				this.state.phase = "hidden";
				this.state.progress = 0;
				this.state.totalSteps = LOGO_INTRO_STEPS;
				this.state.randomOrder = [];
			}
			this.tui.requestRender();
		}
	}

	private restartLifecycle(): void {
		this.ensureOverlayVisible();
		this.ticksSinceReplayPoll = 0;
		this.state.phase = "intro";
		this.state.progress = 1;
		this.state.totalSteps = LOGO_INTRO_STEPS;
		this.state.holdTicksRemaining = LOGO_HOLD_TICKS;
		this.state.randomOrder = [];
	}

	private ensureOverlayVisible(): void {
		if (this.overlayHandle && !this.overlayHandle.isHidden()) {
			return;
		}
		this.hideOverlay();
		this.overlayHandle = this.tui.showOverlay(this.component, {
			anchor: "center",
			width: FLOATING_SPLASH_WINDOW_WIDTH,
			maxHeight: FLOATING_SPLASH_WINDOW_HEIGHT,
			margin: 1,
		});
	}

	private hideOverlay(): void {
		this.overlayHandle?.hide();
		this.overlayHandle = undefined;
	}

	private tryReplayFromSignal(): boolean {
		const nextToken = this.readReplayToken();
		if (!nextToken || nextToken === this.lastSeenReplayToken) {
			return false;
		}
		this.lastSeenReplayToken = nextToken;
		this.restartLifecycle();
		return true;
	}

	private buildRandomOrder(): number[] {
		const order = buildFloatingSplashVisibleCellOrder();
		for (let index = order.length - 1; index > 0; index--) {
			const swapIndex = Math.floor(Math.random() * (index + 1));
			const next = order[index]!;
			order[index] = order[swapIndex]!;
			order[swapIndex] = next;
		}
		return order;
	}

	private readReplayToken(): string | undefined {
		if (!this.options.sessionName) {
			return undefined;
		}
		return readSplashReplaySignal(this.options.sessionName, {
			durableRoot: this.options.durableRootPath,
		})?.token;
	}
}
