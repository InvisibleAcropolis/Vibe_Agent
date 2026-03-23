import * as path from "node:path";
import type { AnimationState } from "../animation-engine.js";
import type { MenuBarItem } from "../components/menu-bar.js";

export const BRAILLE_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"] as const;

export const SHELL_MENU_ITEMS: MenuBarItem[] = [
	{ key: "F1", label: "Settings" },
	{ key: "F2", label: "Sessions" },
	{ key: "F3", label: "Orc" },
];

export function ctxBar(pct: number, width = 8): string {
	const filled = Math.round((pct / 100) * width);
	return "█".repeat(filled) + "░".repeat(width - filled);
}

export function cwdLabel(): string {
	return path.basename(process.cwd()) || process.cwd();
}

export function createFallbackAnimationState(): AnimationState {
	return {
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
}
