import { hslToHex, style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface PlasmaOptions {
	cols?: number;
	rows?: number;
	freq?: number;
	resolution?: number;
	timeScale?: number;
	palette?: "default" | "fire" | "ocean" | "toxic";
	freqModulation?: number;
	frequencyWarp?: number;
	frequencyWarpSpeed?: number;
	hueRangeStartStep?: number;
	hueRangeEndStep?: number;
	hueShiftEnabled?: boolean;
	hueShiftSpeed?: number;
	hueRotateEnabled?: boolean;
	hueRotateSpeed?: number;
	glyphCount?: number;
	fractalCenterX?: number;
	fractalCenterY?: number;
	fractalJuliaX?: number;
	fractalJuliaY?: number;
	fractalZoomSpeed?: number;
	fractalIterations?: number;
	fractalPower?: number;
	fractalEscapeRadius?: number;
	fractalRotation?: number;
	fractalAspect?: number;
	mode?: "classic" | "radial" | "interference" | "warp" | "fractal";
}

export interface PlasmaResolvedOptions {
	cols: number;
	rows: number;
	freq: number;
	resolution: number;
	timeScale: number;
	palette: "default" | "fire" | "ocean" | "toxic";
	freqModulation: number;
	frequencyWarp: number;
	frequencyWarpSpeed: number;
	hueRangeStartStep: number;
	hueRangeEndStep: number;
	hueShiftEnabled: boolean;
	hueShiftSpeed: number;
	hueRotateEnabled: boolean;
	hueRotateSpeed: number;
	glyphCount: number;
	fractalCenterX: number;
	fractalCenterY: number;
	fractalJuliaX: number;
	fractalJuliaY: number;
	fractalZoomSpeed: number;
	fractalIterations: number;
	fractalPower: number;
	fractalEscapeRadius: number;
	fractalRotation: number;
	fractalAspect: number;
	mode: "classic" | "radial" | "interference" | "warp" | "fractal";
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
const FRACTAL_JULIA_BASE_X = -0.4;
const FRACTAL_JULIA_BASE_Y = 0.6;
const FRACTAL_ZOOM_LOOP_SPAN = 3.25;

export const PLASMA_NUMBER_OPTION_SPECS = Object.freeze({
	cols: { defaultValue: 24, min: 4, max: 120, step: 1, integer: true },
	rows: { defaultValue: 8, min: 4, max: 40, step: 1, integer: true },
	freq: { defaultValue: 0.35, min: 0.05, max: 1.5, step: 0.01 },
	resolution: { defaultValue: 1, min: 0.25, max: 8, step: 0.01 },
	timeScale: { defaultValue: 0.06, min: 0.005, max: 0.5, step: 0.005 },
	freqModulation: { defaultValue: 0, min: 0, max: 4, step: 0.01 },
	frequencyWarp: { defaultValue: 0, min: 0, max: 4, step: 0.01 },
	frequencyWarpSpeed: { defaultValue: 1, min: 0, max: 8, step: 0.01 },
	hueRangeStartStep: { defaultValue: 135, min: 0, max: 256, step: 1, integer: true },
	hueRangeEndStep: { defaultValue: 156, min: 0, max: 256, step: 1, integer: true },
	hueShiftSpeed: { defaultValue: 1, min: 0, max: 48, step: 0.05 },
	hueRotateSpeed: { defaultValue: 1, min: 0, max: 48, step: 0.05 },
	glyphCount: { defaultValue: 11, min: 1, max: 4096, step: 1, integer: true },
	fractalCenterX: { defaultValue: 0, min: -2, max: 2, step: 0.001 },
	fractalCenterY: { defaultValue: 0, min: -2, max: 2, step: 0.001 },
	fractalJuliaX: { defaultValue: 1, min: 0.25, max: 2, step: 0.01 },
	fractalJuliaY: { defaultValue: 1, min: 0.25, max: 2, step: 0.01 },
	fractalZoomSpeed: { defaultValue: 1, min: 0, max: 8, step: 0.01 },
	fractalIterations: { defaultValue: 72, min: 8, max: 256, step: 1, integer: true },
	fractalPower: { defaultValue: 2, min: 1.25, max: 6, step: 0.01 },
	fractalEscapeRadius: { defaultValue: 4, min: 2, max: 32, step: 0.1 },
	fractalRotation: { defaultValue: 0, min: -3.1416, max: 3.1416, step: 0.01 },
	fractalAspect: { defaultValue: 1, min: 0.25, max: 4, step: 0.01 },
} satisfies Record<string, PlasmaNumberOptionSpec>);

export const PLASMA_DEFAULTS: Readonly<PlasmaResolvedOptions> = Object.freeze({
	cols: PLASMA_NUMBER_OPTION_SPECS.cols.defaultValue,
	rows: PLASMA_NUMBER_OPTION_SPECS.rows.defaultValue,
	freq: PLASMA_NUMBER_OPTION_SPECS.freq.defaultValue,
	resolution: PLASMA_NUMBER_OPTION_SPECS.resolution.defaultValue,
	timeScale: PLASMA_NUMBER_OPTION_SPECS.timeScale.defaultValue,
	palette: "default",
	freqModulation: PLASMA_NUMBER_OPTION_SPECS.freqModulation.defaultValue,
	frequencyWarp: PLASMA_NUMBER_OPTION_SPECS.frequencyWarp.defaultValue,
	frequencyWarpSpeed: PLASMA_NUMBER_OPTION_SPECS.frequencyWarpSpeed.defaultValue,
	hueRangeStartStep: PLASMA_NUMBER_OPTION_SPECS.hueRangeStartStep.defaultValue,
	hueRangeEndStep: PLASMA_NUMBER_OPTION_SPECS.hueRangeEndStep.defaultValue,
	hueShiftEnabled: false,
	hueShiftSpeed: PLASMA_NUMBER_OPTION_SPECS.hueShiftSpeed.defaultValue,
	hueRotateEnabled: false,
	hueRotateSpeed: PLASMA_NUMBER_OPTION_SPECS.hueRotateSpeed.defaultValue,
	glyphCount: PLASMA_NUMBER_OPTION_SPECS.glyphCount.defaultValue,
	fractalCenterX: PLASMA_NUMBER_OPTION_SPECS.fractalCenterX.defaultValue,
	fractalCenterY: PLASMA_NUMBER_OPTION_SPECS.fractalCenterY.defaultValue,
	fractalJuliaX: PLASMA_NUMBER_OPTION_SPECS.fractalJuliaX.defaultValue,
	fractalJuliaY: PLASMA_NUMBER_OPTION_SPECS.fractalJuliaY.defaultValue,
	fractalZoomSpeed: PLASMA_NUMBER_OPTION_SPECS.fractalZoomSpeed.defaultValue,
	fractalIterations: PLASMA_NUMBER_OPTION_SPECS.fractalIterations.defaultValue,
	fractalPower: PLASMA_NUMBER_OPTION_SPECS.fractalPower.defaultValue,
	fractalEscapeRadius: PLASMA_NUMBER_OPTION_SPECS.fractalEscapeRadius.defaultValue,
	fractalRotation: PLASMA_NUMBER_OPTION_SPECS.fractalRotation.defaultValue,
	fractalAspect: PLASMA_NUMBER_OPTION_SPECS.fractalAspect.defaultValue,
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

function smoothStep(value: number): number {
	const clamped = clampUnit(value);
	return clamped * clamped * (3 - 2 * clamped);
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
	return value === "radial" || value === "interference" || value === "warp" || value === "fractal" ? value : PLASMA_DEFAULTS.mode;
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

function resolveFractalJuliaConstant(fractalJuliaX: number, fractalJuliaY: number): { x: number; y: number } {
	return {
		x: FRACTAL_JULIA_BASE_X * fractalJuliaX,
		y: FRACTAL_JULIA_BASE_Y * fractalJuliaY,
	};
}

function getHueShiftOffset(animState: AnimationState, enabled: boolean, speed: number): number {
	if (!enabled) {
		return 0;
	}
	return wrapUnit((animState.tickCount * speed) / 256);
}

function getHueRotateOffset(animState: AnimationState, enabled: boolean, speed: number): number {
	if (!enabled) {
		return 0;
	}
	return animState.tickCount * speed;
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
	const effectiveCount = Math.max(1, Math.min(PLASMA_NUMBER_OPTION_SPECS.glyphCount.max, Math.round(glyphCount)));
	if (effectiveCount === 1) {
		return [paletteGlyphs[paletteGlyphs.length - 1] ?? "@"]; 
	}
	if (effectiveCount <= paletteGlyphs.length) {
		return paletteGlyphs.slice(0, effectiveCount);
	}

	return Array.from({ length: effectiveCount }, (_, index) => {
		const normalized = effectiveCount === 1 ? 1 : index / (effectiveCount - 1);
		const seedIndex = Math.min(
			paletteGlyphs.length - 1,
			Math.floor(normalized * paletteGlyphs.length),
		);
		return paletteGlyphs[seedIndex] ?? paletteGlyphs[paletteGlyphs.length - 1] ?? "@";
	});
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

interface FractalFieldConfig {
	resolution: number;
	fractalCenterX: number;
	fractalCenterY: number;
	fractalJuliaX: number;
	fractalJuliaY: number;
	fractalZoomSpeed: number;
	fractalIterations: number;
	fractalPower: number;
	fractalEscapeRadius: number;
	fractalRotation: number;
	fractalAspect: number;
	tickCount: number;
	frequencyWarp: number;
	frequencyWarpSpeed: number;
}

interface FieldSampleConfig {
	mode: PlasmaResolvedOptions["mode"];
	nx: number;
	ny: number;
	freq: number;
	t: number;
	fractal: FractalFieldConfig;
}

function sampleFractal(
	nx: number,
	ny: number,
	fractal: FractalFieldConfig,
): number {
	const baseViewport = 2.8;
	const zoomTravel = fractal.tickCount * fractal.fractalZoomSpeed * 0.045;
	const loopPhase = wrapUnit(zoomTravel / FRACTAL_ZOOM_LOOP_SPAN);
	const localZoom = loopPhase * FRACTAL_ZOOM_LOOP_SPAN;
	const warpPhase = wrapUnit((fractal.tickCount * fractal.frequencyWarpSpeed) / 256);
	const warpScale = 1 / (1 + fractal.frequencyWarp * warpPhase * 0.6);
	const actualJulia = resolveFractalJuliaConstant(fractal.fractalJuliaX, fractal.fractalJuliaY);
	const maxIterations = Math.max(8, Math.min(256, Math.round(fractal.fractalIterations)));
	const escapeRadiusSquared = fractal.fractalEscapeRadius * fractal.fractalEscapeRadius;
	const resolutionScale = Math.max(0.1, fractal.resolution);
	const aspectScale = Math.max(0.01, fractal.fractalAspect);
	const rotationCos = Math.cos(fractal.fractalRotation);
	const rotationSin = Math.sin(fractal.fractalRotation);

	const sampleJuliaAtScale = (zoomOffset: number): number => {
		const viewportScale = (baseViewport * Math.exp(-zoomOffset) * warpScale) / resolutionScale;
		const scaledX = nx * viewportScale * aspectScale;
		const scaledY = ny * viewportScale / aspectScale;
		const rotatedX = scaledX * rotationCos - scaledY * rotationSin;
		const rotatedY = scaledX * rotationSin + scaledY * rotationCos;
		let zx = fractal.fractalCenterX + rotatedX;
		let zy = fractal.fractalCenterY + rotatedY;
		let iteration = 0;
		let magnitudeSquared = 0;

		while (iteration < maxIterations) {
			const radius = Math.sqrt(zx * zx + zy * zy);
			const angle = Math.atan2(zy, zx);
			const poweredRadius = Math.pow(radius, fractal.fractalPower);
			const poweredAngle = angle * fractal.fractalPower;
			const nextX = poweredRadius * Math.cos(poweredAngle) + actualJulia.x;
			const nextY = poweredRadius * Math.sin(poweredAngle) + actualJulia.y;
			zx = nextX;
			zy = nextY;
			magnitudeSquared = zx * zx + zy * zy;
			if (magnitudeSquared > escapeRadiusSquared) {
				break;
			}
			iteration++;
		}

		if (iteration >= maxIterations) {
			return 0;
		}

		const smoothIteration =
			iteration + 1 - Math.log(Math.max(1e-6, Math.log(Math.max(1.000001, magnitudeSquared)))) / Math.LN2;
		return clampUnit(smoothIteration / maxIterations);
	};

	const nearSample = sampleJuliaAtScale(localZoom);
	const farSample = sampleJuliaAtScale(localZoom + FRACTAL_ZOOM_LOOP_SPAN);
	const zoomBlend = smoothStep(loopPhase);
	const regenerated = farSample * (1 - zoomBlend) + nearSample * zoomBlend;
	const bandPhase = wrapUnit(regenerated + loopPhase * 0.28 + zoomTravel * 0.035);
	return clampUnit(regenerated * 0.55 + bandPhase * 0.45);
}

function sampleModeField(config: FieldSampleConfig): number {
	switch (config.mode) {
		case "radial":
			return sampleRadial(config.nx, config.ny, config.freq, config.t);
		case "interference":
			return sampleInterference(config.nx, config.ny, config.freq, config.t);
		case "warp":
			return sampleWarp(config.nx, config.ny, config.freq, config.t);
		case "fractal":
			return sampleFractal(config.nx, config.ny, config.fractal);
		default:
			return sampleClassic(config.nx, config.ny, config.freq, config.t);
	}
}

export function normalizePlasmaOptions(opts?: PlasmaOptions): PlasmaResolvedOptions {
	return {
		cols: normalizeNumberOption(opts?.cols, PLASMA_NUMBER_OPTION_SPECS.cols),
		rows: normalizeNumberOption(opts?.rows, PLASMA_NUMBER_OPTION_SPECS.rows),
		freq: normalizeNumberOption(opts?.freq, PLASMA_NUMBER_OPTION_SPECS.freq),
		resolution: normalizeNumberOption(opts?.resolution, PLASMA_NUMBER_OPTION_SPECS.resolution),
		timeScale: normalizeNumberOption(opts?.timeScale, PLASMA_NUMBER_OPTION_SPECS.timeScale),
		palette: normalizePalette(opts?.palette),
		freqModulation: normalizeNumberOption(opts?.freqModulation, PLASMA_NUMBER_OPTION_SPECS.freqModulation),
		frequencyWarp: normalizeNumberOption(opts?.frequencyWarp, PLASMA_NUMBER_OPTION_SPECS.frequencyWarp),
		frequencyWarpSpeed: normalizeNumberOption(opts?.frequencyWarpSpeed, PLASMA_NUMBER_OPTION_SPECS.frequencyWarpSpeed),
		hueRangeStartStep: normalizeNumberOption(opts?.hueRangeStartStep, PLASMA_NUMBER_OPTION_SPECS.hueRangeStartStep),
		hueRangeEndStep: normalizeNumberOption(opts?.hueRangeEndStep, PLASMA_NUMBER_OPTION_SPECS.hueRangeEndStep),
		hueShiftEnabled: normalizeBooleanOption(opts?.hueShiftEnabled, PLASMA_DEFAULTS.hueShiftEnabled),
		hueShiftSpeed: normalizeNumberOption(opts?.hueShiftSpeed, PLASMA_NUMBER_OPTION_SPECS.hueShiftSpeed),
		hueRotateEnabled: normalizeBooleanOption(opts?.hueRotateEnabled, PLASMA_DEFAULTS.hueRotateEnabled),
		hueRotateSpeed: normalizeNumberOption(opts?.hueRotateSpeed, PLASMA_NUMBER_OPTION_SPECS.hueRotateSpeed),
		glyphCount: normalizeNumberOption(opts?.glyphCount, PLASMA_NUMBER_OPTION_SPECS.glyphCount),
		fractalCenterX: normalizeNumberOption(opts?.fractalCenterX, PLASMA_NUMBER_OPTION_SPECS.fractalCenterX),
		fractalCenterY: normalizeNumberOption(opts?.fractalCenterY, PLASMA_NUMBER_OPTION_SPECS.fractalCenterY),
		fractalJuliaX: normalizeNumberOption(opts?.fractalJuliaX, PLASMA_NUMBER_OPTION_SPECS.fractalJuliaX),
		fractalJuliaY: normalizeNumberOption(opts?.fractalJuliaY, PLASMA_NUMBER_OPTION_SPECS.fractalJuliaY),
		fractalZoomSpeed: normalizeNumberOption(opts?.fractalZoomSpeed, PLASMA_NUMBER_OPTION_SPECS.fractalZoomSpeed),
		fractalIterations: normalizeNumberOption(opts?.fractalIterations, PLASMA_NUMBER_OPTION_SPECS.fractalIterations),
		fractalPower: normalizeNumberOption(opts?.fractalPower, PLASMA_NUMBER_OPTION_SPECS.fractalPower),
		fractalEscapeRadius: normalizeNumberOption(opts?.fractalEscapeRadius, PLASMA_NUMBER_OPTION_SPECS.fractalEscapeRadius),
		fractalRotation: normalizeNumberOption(opts?.fractalRotation, PLASMA_NUMBER_OPTION_SPECS.fractalRotation),
		fractalAspect: normalizeNumberOption(opts?.fractalAspect, PLASMA_NUMBER_OPTION_SPECS.fractalAspect),
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
		isValidNumberOption(candidate.resolution, PLASMA_NUMBER_OPTION_SPECS.resolution) &&
		isValidNumberOption(candidate.timeScale, PLASMA_NUMBER_OPTION_SPECS.timeScale) &&
		(candidate.palette === "default" || candidate.palette === "fire" || candidate.palette === "ocean" || candidate.palette === "toxic") &&
		isValidNumberOption(candidate.freqModulation, PLASMA_NUMBER_OPTION_SPECS.freqModulation) &&
		isValidNumberOption(candidate.frequencyWarp, PLASMA_NUMBER_OPTION_SPECS.frequencyWarp) &&
		isValidNumberOption(candidate.frequencyWarpSpeed, PLASMA_NUMBER_OPTION_SPECS.frequencyWarpSpeed) &&
		isValidNumberOption(candidate.hueRangeStartStep, PLASMA_NUMBER_OPTION_SPECS.hueRangeStartStep) &&
		isValidNumberOption(candidate.hueRangeEndStep, PLASMA_NUMBER_OPTION_SPECS.hueRangeEndStep) &&
		typeof candidate.hueShiftEnabled === "boolean" &&
		isValidNumberOption(candidate.hueShiftSpeed, PLASMA_NUMBER_OPTION_SPECS.hueShiftSpeed) &&
		typeof candidate.hueRotateEnabled === "boolean" &&
		isValidNumberOption(candidate.hueRotateSpeed, PLASMA_NUMBER_OPTION_SPECS.hueRotateSpeed) &&
		isValidNumberOption(candidate.glyphCount, PLASMA_NUMBER_OPTION_SPECS.glyphCount) &&
		isValidNumberOption(candidate.fractalCenterX, PLASMA_NUMBER_OPTION_SPECS.fractalCenterX) &&
		isValidNumberOption(candidate.fractalCenterY, PLASMA_NUMBER_OPTION_SPECS.fractalCenterY) &&
		isValidNumberOption(candidate.fractalJuliaX, PLASMA_NUMBER_OPTION_SPECS.fractalJuliaX) &&
		isValidNumberOption(candidate.fractalJuliaY, PLASMA_NUMBER_OPTION_SPECS.fractalJuliaY) &&
		isValidNumberOption(candidate.fractalZoomSpeed, PLASMA_NUMBER_OPTION_SPECS.fractalZoomSpeed) &&
		isValidNumberOption(candidate.fractalIterations, PLASMA_NUMBER_OPTION_SPECS.fractalIterations) &&
		isValidNumberOption(candidate.fractalPower, PLASMA_NUMBER_OPTION_SPECS.fractalPower) &&
		isValidNumberOption(candidate.fractalEscapeRadius, PLASMA_NUMBER_OPTION_SPECS.fractalEscapeRadius) &&
		isValidNumberOption(candidate.fractalRotation, PLASMA_NUMBER_OPTION_SPECS.fractalRotation) &&
		isValidNumberOption(candidate.fractalAspect, PLASMA_NUMBER_OPTION_SPECS.fractalAspect) &&
		(candidate.mode === "classic" || candidate.mode === "radial" || candidate.mode === "interference" || candidate.mode === "warp" || candidate.mode === "fractal")
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
		resolution,
		timeScale,
		palette,
		freqModulation,
		frequencyWarp,
		frequencyWarpSpeed,
		hueRangeStartStep,
		hueRangeEndStep,
		hueShiftEnabled,
		hueShiftSpeed,
		hueRotateEnabled,
		hueRotateSpeed,
		glyphCount,
		fractalCenterX,
		fractalCenterY,
		fractalJuliaX,
		fractalJuliaY,
		fractalZoomSpeed,
		fractalIterations,
		fractalPower,
		fractalEscapeRadius,
		fractalRotation,
		fractalAspect,
		mode,
	} = normalizePlasmaOptions(opts);

	const paletteGlyphs = getPaletteGlyphs(palette);
	const glyphSubset = getGlyphSubset(paletteGlyphs, glyphCount);
	const hueRotateOffset = getHueRotateOffset(animState, hueRotateEnabled, hueRotateSpeed);
	const startHex = stepToHex(hueRangeStartStep + hueRotateOffset);
	const endHex = stepToHex(hueRangeEndStep + hueRotateOffset);
	const hueShiftOffset = getHueShiftOffset(animState, hueShiftEnabled, hueShiftSpeed);
	const t = animState.tickCount * timeScale;
	const modulation = Math.sin(t * Math.max(freqModulation, 0.001)) * 0.1 * freqModulation;
	const warpPhase = wrapUnit((animState.tickCount * frequencyWarpSpeed) / 256);
	const warpScale = frequencyWarp > 0 ? 1 + warpPhase * frequencyWarp : 1;
	const modFreq = Math.max(0.01, (freq + modulation) * warpScale);
	const centerX = (cols - 1) / 2;
	const centerY = (rows - 1) / 2;
	const fractalFieldConfig: FractalFieldConfig = {
		resolution,
		fractalCenterX,
		fractalCenterY,
		fractalJuliaX,
		fractalJuliaY,
		fractalZoomSpeed,
		fractalIterations,
		fractalPower,
		fractalEscapeRadius,
		fractalRotation,
		fractalAspect,
		tickCount: animState.tickCount,
		frequencyWarp,
		frequencyWarpSpeed,
	};

	const outputRows: string[] = [];
	for (let y = 0; y < rows; y++) {
		let row = "";
		for (let x = 0; x < cols; x++) {
			const nx = (x - centerX) / Math.max(cols, 1);
			const ny = (y - centerY) / Math.max(rows, 1);
			const sampleX = nx * cols * resolution;
			const sampleY = ny * rows * resolution;
			const value = sampleModeField({
				mode,
				nx: sampleX,
				ny: sampleY,
				freq: modFreq,
				t,
				fractal: fractalFieldConfig,
			});
			const glyphValue = sampleModeField({
				mode,
				nx: sampleX + 17.3,
				ny: sampleY - 11.7,
				freq: modFreq,
				t: t + 2.35,
				fractal: {
					...fractalFieldConfig,
					fractalRotation: clamp(fractalRotation + 0.42, PLASMA_NUMBER_OPTION_SPECS.fractalRotation.min, PLASMA_NUMBER_OPTION_SPECS.fractalRotation.max),
					fractalPower: clamp(fractalPower + 0.18, PLASMA_NUMBER_OPTION_SPECS.fractalPower.min, PLASMA_NUMBER_OPTION_SPECS.fractalPower.max),
				},
			});
			const shiftedValue = wrapUnit(value + hueShiftOffset);
			const color = lerpColor(startHex, endHex, shiftedValue);
			const glyphIndex = Math.min(glyphSubset.length - 1, Math.floor(glyphValue * glyphSubset.length));
			row += style({ fg: color })(glyphSubset[glyphIndex] ?? glyphSubset[glyphSubset.length - 1] ?? "@");
		}
		outputRows.push(row);
	}

	return outputRows.join("\n");
}
