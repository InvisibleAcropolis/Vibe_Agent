import { hslToHex, style, type Styler } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { defaultTheme } from "./default.js";
import { cyberpunkTheme } from "./cyberpunk.js";
import { matrixTheme } from "./matrix.js";
import { synthwaveTheme } from "./synthwave.js";
import { amberTheme } from "./amber.js";

export type ThemeName = "default" | "cyberpunk" | "matrix" | "synthwave" | "amber";

export interface ThemeConfig {
	name: ThemeName;
	hueRange: [number, number];
	hueSaturation: number;
	hueLightness: number;
	breathBaseColor: string;
	breathPeakColor: string;
}

export interface DynamicTheme {
	borderAnimated: Styler;
	borderBreath: Styler;
}

const THEME_REGISTRY: Record<ThemeName, ThemeConfig> = {
	default: defaultTheme,
	cyberpunk: cyberpunkTheme,
	matrix: matrixTheme,
	synthwave: synthwaveTheme,
	amber: amberTheme,
};

let activeTheme: ThemeConfig = defaultTheme;
const themeChangeCallbacks: Array<() => void> = [];

export function setActiveTheme(name: ThemeName): void {
	const config = THEME_REGISTRY[name];
	if (!config) return;
	activeTheme = config;
	for (const cb of themeChangeCallbacks) {
		cb();
	}
}

export function getActiveTheme(): ThemeConfig {
	return activeTheme;
}

export function getThemeNames(): ThemeName[] {
	return Object.keys(THEME_REGISTRY) as ThemeName[];
}

export function onThemeConfigChange(cb: () => void): void {
	themeChangeCallbacks.push(cb);
}

function lerpColor(from: string, to: string, t: number): string {
	const parseHex = (h: string) => {
		const n = h.replace("#", "");
		return [
			Number.parseInt(n.slice(0, 2), 16),
			Number.parseInt(n.slice(2, 4), 16),
			Number.parseInt(n.slice(4, 6), 16),
		] as [number, number, number];
	};
	const [r1, g1, b1] = parseHex(from);
	const [r2, g2, b2] = parseHex(to);
	const r = Math.round(r1 + (r2 - r1) * t);
	const g = Math.round(g1 + (g2 - g1) * t);
	const b = Math.round(b1 + (b2 - b1) * t);
	const toHex = (n: number) => n.toString(16).padStart(2, "0");
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function createDynamicTheme(config: ThemeConfig, animState: AnimationState): DynamicTheme {
	const [hMin, hMax] = config.hueRange;
	const t = animState.hueOffset / 360;
	const hue = hMin + t * (hMax - hMin);
	const animatedBorderColor = hslToHex(hue, config.hueSaturation, config.hueLightness);
	const breathColor = lerpColor(config.breathBaseColor, config.breathPeakColor, animState.breathPhase);

	return {
		borderAnimated: style({ fg: animatedBorderColor }),
		borderBreath: style({ fg: breathColor }),
	};
}
