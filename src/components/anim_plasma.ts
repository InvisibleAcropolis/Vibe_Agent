import { hslToHex, style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface PlasmaOptions {
	cols?: number;
	rows?: number;
	freq?: number;
	timeScale?: number;
	palette?: "default" | "fire" | "ocean" | "toxic";
	freqModulation?: number;
	hueRangeStartStep?: number;
	hueRangeEndStep?: number;
	hueShiftEnabled?: boolean;
	hueShiftSpeed?: number;
	glyphCount?: number;
	mode?: "classic" | "radial" | "interference" | "warp";
}

export interface PlasmaResolvedOptions {
	cols: number;
	rows: number;
	freq: number;
	timeScale: number;
	palette: "default" | "fire" | "ocean" | "toxic";
	freqModulation: number;
	hueRangeStartStep: number;
	hueRangeEndStep: number;
	hueShiftEnabled: boolean;
	hueShiftSpeed: number;
	glyphCount: number;
	mode: "classic" | "radial" | "interference" | "warp";
}

export interface PlasmaNumberOptionSpec {
	defaultValue: number;
	min: number;
	max: number;
	step: number;
	integer?: boolean;
}

const PAL_DEFAULT = ["░", "▒", "▓", "█"] as const;
const PAL_FIRE = [" ", ".", ":", ";", "|", "i", "t", "S", "8", "#", "@"] as const;
const PAL_OCEAN = [" ", "·", ":", "=", "≡", "▒", "▓", "█"] as const;
const PAL_TOXIC = ["░", "▒", "▓", "█", "◐", "◑", "◒", "◓"] as const;

export const PLASMA_NUMBER_OPTION_SPECS = Object.freeze({
	cols: { defaultValue: 24, min: 4, max: 120, step: 1, integer: true },
	rows: { defaultValue: 8, min: 4, max: 40, step: 1, integer: true },
	freq: { defaultValue: 0.35, min: 0.05, max: 1.5, step: 0.01 },
	timeScale: { defaultValue: 0.06, min: 0.005, max: 0.5, step: 0.005 },
	freqModulation: { defaultValue: 0, min: 0, max: 4, step: 0.01 },
	hueRangeStartStep: { defaultValue: 135, min: 0, max: 256, step: 1, integer: true },
	hueRangeEndStep: { defaultValue: 156, min: 0, max: 256, step: 1, integer: true },
	hueShiftSpeed: { defaultValue: 1, min: 0, max: 48, step: 0.05 },
	glyphCount: { defaultValue: 11, min: 1, max: 11, step: 1, integer: true },
} satisfies Record<string, PlasmaNumberOptionSpec>);

export const PLASMA_DEFAULTS: Readonly<PlasmaResolvedOptions> = Object.freeze({
	cols: PLASMA_NUMBER_OPTION_SPECS.cols.defaultValue,
	rows: PLASMA_NUMBER_OPTION_SPECS.rows.defaultValue,
	freq: PLASMA_NUMBER_OPTION_SPECS.freq.defaultValue,
	timeScale: PLASMA_NUMBER_OPTION_SPECS.timeScale.defaultValue,
	palette: "default",
	freqModulation: PLASMA_NUMBER_OPTION_SPECS.freqModulation.defaultValue,
	hueRangeStartStep: PLASMA_NUMBER_OPTION_SPECS.hueRangeStartStep.defaultValue,
	hueRangeEndStep: PLASMA_NUMBER_OPTION_SPECS.hueRangeEndStep.defaultValue,
	hueShiftEnabled: false,
	hueShiftSpeed: PLASMA_NUMBER_OPTION_SPECS.hueShiftSpeed.defaultValue,
	glyphCount: PLASMA_NUMBER_OPTION_SPECS.glyphCount.defaultValue,
	mode: "classic",
});

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function clampUnit(value: number): number {
	return clamp(value, 0, 1);
}

function wrapUnit(value: number): number {
	const wrapped = value % 1;
	return wrapped < 0 ? wrapped + 1 : wrapped;
}

function wrapStep(value: number): number {
	const wrapped = value % 256;
	return wrapped < 0 ? wrapped + 256 : wrapped;
}

function normalizeNumberOption(value: number | undefined, spec: PlasmaNumberOptionSpec): number {
	const numeric = typeof value === "number" && Number.isFinite(value) ? value : spec.defaultValue;
	const normalized = spec.integer ? Math.round(numeric) : numeric;
	return clamp(normalized, spec.min, spec.max);
}

function normalizeBooleanOption(value: boolean | undefined, defaultValue: boolean): boolean {
	return typeof value === "boolean" ? value : defaultValue;
}

function normalizePalette(value: PlasmaOptions["palette"] | undefined): PlasmaResolvedOptions["palette"] {
	return value === "fire" || value === "ocean" || value === "toxic" ? value : PLASMA_DEFAULTS.palette;
}

function normalizeMode(value: PlasmaOptions["mode"] | undefined): PlasmaResolvedOptions["mode"] {
	return value === "radial" || value === "interference" || value === "warp" ? value : PLASMA_DEFAULTS.mode;
}

function isValidNumberOption(value: unknown, spec: PlasmaNumberOptionSpec): value is number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return false;
	}
	if (value < spec.min || value > spec.max) {
		return false;
	}
	return !spec.integer || Number.isInteger(value);
}

function stepToHex(step: number): string {
	return hslToHex((wrapStep(step) / 256) * 360, 1, 0.5);
}

function getHueShiftOffset(animState: AnimationState, enabled: boolean, speed: number): number {
	if (!enabled) {
		return 0;
	}
	return wrapUnit((animState.tickCount * speed) / 256);
}

function getPaletteGlyphs(palette: PlasmaResolvedOptions["palette"]): readonly string[] {
	switch (palette) {
		case "fire":
			return PAL_FIRE;
		case "ocean":
			return PAL_OCEAN;
		case "toxic":
			return PAL_TOXIC;
		default:
			return PAL_DEFAULT;
	}
}

function getGlyphSubset(paletteGlyphs: readonly string[], glyphCount: number): string[] {
	const effectiveCount = Math.max(1, Math.min(paletteGlyphs.length, Math.round(glyphCount)));
	if (effectiveCount === 1) {
		return [paletteGlyphs[paletteGlyphs.length - 1] ?? "@"]; 
	}
	return paletteGlyphs.slice(0, effectiveCount);
}

function normalizeWave(raw: number, amplitude: number): number {
	return clampUnit((raw + amplitude) / (amplitude * 2));
}

function sampleClassic(nx: number, ny: number, freq: number, t: number): number {
	const cx = nx + 0.5 * Math.sin(t / 5);
	const cy = ny + 0.5 * Math.cos(t / 3);
	const raw =
		Math.sin(nx * freq + t) +
		Math.sin(ny * freq + t * 0.7) +
		Math.sin((nx + ny) * (freq * 0.6) + t * 0.5) +
		Math.sin(Math.sqrt(cx * cx + cy * cy) * (freq * 0.8) + t);
	return normalizeWave(raw, 4);
}

function sampleRadial(nx: number, ny: number, freq: number, t: number): number {
	const radius = Math.sqrt(nx * nx + ny * ny);
	const angle = Math.atan2(ny, nx);
	const raw =
		Math.sin(radius * freq * 2.8 - t * 1.1) +
		Math.sin((radius + Math.sin(angle * 2 + t * 0.5) * 0.9) * freq * 2.1 + t * 0.8) +
		Math.sin(angle * 3 + radius * freq * 0.7 - t * 0.35);
	return normalizeWave(raw, 3);
}

function sampleInterference(nx: number, ny: number, freq: number, t: number): number {
	const raw =
		Math.sin(nx * freq * 3.1 + t) +
		Math.sin(ny * freq * 2.7 - t * 0.9) +
		Math.sin((nx + ny) * freq * 1.9 + t * 0.55) +
		Math.sin((nx - ny) * freq * 2.4 - t * 0.45);
	return normalizeWave(raw, 4);
}

function sampleWarp(nx: number, ny: number, freq: number, t: number): number {
	const warpX = nx + Math.sin(ny * freq * 1.8 + t * 0.7) * 0.9;
	const warpY = ny + Math.cos(nx * freq * 1.5 - t * 0.6) * 0.8;
	const radius = Math.sqrt(warpX * warpX + warpY * warpY);
	const raw =
		Math.sin(warpX * freq * 2.6 + t) +
		Math.sin(warpY * freq * 2.9 - t * 0.8) +
		Math.sin(radius * freq * 3.4 + t * 0.65);
	return normalizeWave(raw, 3);
}

function samplePlasmaValue(
	mode: PlasmaResolvedOptions["mode"],
	nx: number,
	ny: number,
	freq: number,
	t: number,
): number {
	switch (mode) {
		case "radial":
			return sampleRadial(nx, ny, freq, t);
		case "interference":
			return sampleInterference(nx, ny, freq, t);
		case "warp":
			return sampleWarp(nx, ny, freq, t);
		default:
			return sampleClassic(nx, ny, freq, t);
	}
}

export function normalizePlasmaOptions(opts?: PlasmaOptions): PlasmaResolvedOptions {
	return {
		cols: normalizeNumberOption(opts?.cols, PLASMA_NUMBER_OPTION_SPECS.cols),
		rows: normalizeNumberOption(opts?.rows, PLASMA_NUMBER_OPTION_SPECS.rows),
		freq: normalizeNumberOption(opts?.freq, PLASMA_NUMBER_OPTION_SPECS.freq),
		timeScale: normalizeNumberOption(opts?.timeScale, PLASMA_NUMBER_OPTION_SPECS.timeScale),
		palette: normalizePalette(opts?.palette),
		freqModulation: normalizeNumberOption(opts?.freqModulation, PLASMA_NUMBER_OPTION_SPECS.freqModulation),
		hueRangeStartStep: normalizeNumberOption(opts?.hueRangeStartStep, PLASMA_NUMBER_OPTION_SPECS.hueRangeStartStep),
		hueRangeEndStep: normalizeNumberOption(opts?.hueRangeEndStep, PLASMA_NUMBER_OPTION_SPECS.hueRangeEndStep),
		hueShiftEnabled: normalizeBooleanOption(opts?.hueShiftEnabled, PLASMA_DEFAULTS.hueShiftEnabled),
		hueShiftSpeed: normalizeNumberOption(opts?.hueShiftSpeed, PLASMA_NUMBER_OPTION_SPECS.hueShiftSpeed),
		glyphCount: normalizeNumberOption(opts?.glyphCount, PLASMA_NUMBER_OPTION_SPECS.glyphCount),
		mode: normalizeMode(opts?.mode),
	};
}

export function isPlasmaOptionsPresetValid(opts: unknown): opts is PlasmaResolvedOptions {
	if (typeof opts !== "object" || opts === null) {
		return false;
	}
	const candidate = opts as PlasmaOptions;
	return (
		isValidNumberOption(candidate.cols, PLASMA_NUMBER_OPTION_SPECS.cols) &&
		isValidNumberOption(candidate.rows, PLASMA_NUMBER_OPTION_SPECS.rows) &&
		isValidNumberOption(candidate.freq, PLASMA_NUMBER_OPTION_SPECS.freq) &&
		isValidNumberOption(candidate.timeScale, PLASMA_NUMBER_OPTION_SPECS.timeScale) &&
		(candidate.palette === "default" || candidate.palette === "fire" || candidate.palette === "ocean" || candidate.palette === "toxic") &&
		isValidNumberOption(candidate.freqModulation, PLASMA_NUMBER_OPTION_SPECS.freqModulation) &&
		isValidNumberOption(candidate.hueRangeStartStep, PLASMA_NUMBER_OPTION_SPECS.hueRangeStartStep) &&
		isValidNumberOption(candidate.hueRangeEndStep, PLASMA_NUMBER_OPTION_SPECS.hueRangeEndStep) &&
		typeof candidate.hueShiftEnabled === "boolean" &&
		isValidNumberOption(candidate.hueShiftSpeed, PLASMA_NUMBER_OPTION_SPECS.hueShiftSpeed) &&
		isValidNumberOption(candidate.glyphCount, PLASMA_NUMBER_OPTION_SPECS.glyphCount) &&
		(candidate.mode === "classic" || candidate.mode === "radial" || candidate.mode === "interference" || candidate.mode === "warp")
	);
}

export function renderPlasma(
	animState: AnimationState,
	_theme: ThemeConfig,
	opts?: PlasmaOptions,
): string {
	const {
		cols,
		rows,
		freq,
		timeScale,
		palette,
		freqModulation,
		hueRangeStartStep,
		hueRangeEndStep,
		hueShiftEnabled,
		hueShiftSpeed,
		glyphCount,
		mode,
	} = normalizePlasmaOptions(opts);

	const paletteGlyphs = getPaletteGlyphs(palette);
	const glyphSubset = getGlyphSubset(paletteGlyphs, glyphCount);
	const startHex = stepToHex(hueRangeStartStep);
	const endHex = stepToHex(hueRangeEndStep);
	const hueShiftOffset = getHueShiftOffset(animState, hueShiftEnabled, hueShiftSpeed);
	const t = animState.tickCount * timeScale;
	const modFreq = freq + Math.sin(t * Math.max(freqModulation, 0.001)) * 0.1 * freqModulation;
	const centerX = (cols - 1) / 2;
	const centerY = (rows - 1) / 2;

	const outputRows: string[] = [];
	for (let y = 0; y < rows; y++) {
		let row = "";
		for (let x = 0; x < cols; x++) {
			const nx = (x - centerX) / Math.max(cols, 1);
			const ny = (y - centerY) / Math.max(rows, 1);
			const value = samplePlasmaValue(mode, nx * cols, ny * rows, modFreq, t);
			const shiftedValue = wrapUnit(value + hueShiftOffset);
			const color = lerpColor(startHex, endHex, shiftedValue);
			const glyphIndex = Math.min(glyphSubset.length - 1, Math.floor(value * glyphSubset.length));
			row += style({ fg: color })(glyphSubset[glyphIndex] ?? glyphSubset[glyphSubset.length - 1] ?? "@");
		}
		outputRows.push(row);
	}

	return outputRows.join("\n");
}
