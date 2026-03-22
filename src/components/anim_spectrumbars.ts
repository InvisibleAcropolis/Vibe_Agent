import { hslToHex, style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { requireBooleanOption, requireNumberOption, requireStringOption } from "./anim-option-helpers.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface SpectrumBarsOptions {
	cols?: number;
	rows?: number;
	speed?: number;
	decay?: number;
	peakHold?: boolean;
	peakDecay?: number;
	smoothing?: number;
	barGap?: number;
	hueRangeStartStep?: number;
	hueRangeEndStep?: number;
	hueShiftEnabled?: boolean;
	hueShiftSpeed?: number;
	glyphCount?: number;
	stereoLayout?: "overlap" | "mirrored";
	stereoStartOffsetStep?: number;
	stereoFlipHueShift?: boolean;
	stereoFlipGlyphOrder?: boolean;
}

interface BarTracker {
	phase: number;
	value: number;
	peak: number;
}

interface MonoRendererState {
	lastTick: number;
	trackers: BarTracker[];
	values: number[];
}

interface StereoRendererState {
	lastTick: number;
	leftTrackers: BarTracker[];
	rightTrackers: BarTracker[];
	leftValues: number[];
	rightValues: number[];
}

interface RenderConfig {
	cols: number;
	rows: number;
	speed: number;
	decay: number;
	peakHold: boolean;
	peakDecay: number;
	smoothing: number;
	barGap: number;
	hueRangeStartStep: number;
	hueRangeEndStep: number;
	hueShiftEnabled: boolean;
	hueShiftSpeed: number;
	glyphCount: number;
	stereoLayout: "overlap" | "mirrored";
	stereoStartOffsetStep: number;
	stereoFlipHueShift: boolean;
	stereoFlipGlyphOrder: boolean;
}

interface GlyphChoice {
	char: string;
	densityIndex: number;
}

const MODULE_ID = "anim_spectrumbars";
const DIM = "#1a3348";
const ASCII_DENSITY_SEED = " .'^`,:;Il!i~+_-?][}{1)(|\\\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
const ASCII_GLYPH_RAMP = Array.from({ length: 256 }, (_, index) => {
	const normalized = index / 255;
	const seedIndex = Math.min(
		ASCII_DENSITY_SEED.length - 1,
		Math.floor(Math.sqrt(normalized) * (ASCII_DENSITY_SEED.length - 1)),
	);
	return ASCII_DENSITY_SEED[seedIndex] ?? "@";
});
const monoRendererCache = new Map<string, MonoRendererState>();
const stereoRendererCache = new Map<string, StereoRendererState>();

function clampUnit(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function wrapUnit(value: number): number {
	const wrapped = value % 1;
	return wrapped < 0 ? wrapped + 1 : wrapped;
}

function wrapStep(value: number): number {
	const wrapped = value % 256;
	return wrapped < 0 ? wrapped + 256 : wrapped;
}

function stepToHex(step: number): string {
	return hslToHex((wrapStep(step) / 256) * 360, 1, 0.5);
}

function createTrackers(cols: number, phaseOffset = 0): BarTracker[] {
	return Array.from({ length: cols }, (_, index) => ({
		phase: index * 0.4 + phaseOffset,
		value: 0,
		peak: 0,
	}));
}

function advanceTrackers(
	trackers: BarTracker[],
	config: Pick<RenderConfig, "cols" | "speed" | "decay" | "smoothing" | "peakHold" | "peakDecay">,
): number[] {
	const values: number[] = [];
	for (let index = 0; index < config.cols; index++) {
		const tracker = trackers[index]!;
		tracker.phase += (0.06 + index * 0.004) * config.speed;

		const raw = (Math.sin(tracker.phase) * 0.5 + 0.5) * 0.9 + 0.05;
		if (raw >= tracker.value) {
			tracker.value = clampUnit(tracker.value * (1 - config.smoothing) + raw * config.smoothing);
		} else {
			tracker.value = clampUnit(tracker.value * config.decay + raw * (1 - config.decay));
		}

		if (config.peakHold) {
			if (tracker.value > tracker.peak) {
				tracker.peak = tracker.value;
			} else {
				tracker.peak = clampUnit(tracker.peak * config.peakDecay);
			}
		}

		values.push(tracker.value);
	}
	return values;
}

function getGlyphSubset(glyphCount: number): string[] {
	const effectiveCount = Math.max(1, Math.min(256, Math.round(glyphCount)));
	if (effectiveCount === 1) {
		return [ASCII_GLYPH_RAMP[255] ?? "@"];
	}
	return ASCII_GLYPH_RAMP.slice(0, effectiveCount);
}

function resolveGlyphChoice(fill: number, glyphSubset: readonly string[], reverse = false): GlyphChoice {
	const clampedFill = clampUnit(fill);
	const rawIndex = Math.min(glyphSubset.length - 1, Math.round(clampedFill * (glyphSubset.length - 1)));
	const densityIndex = reverse ? glyphSubset.length - 1 - rawIndex : rawIndex;
	return {
		char: glyphSubset[densityIndex] ?? glyphSubset[glyphSubset.length - 1] ?? "@",
		densityIndex,
	};
}

function getHueShiftOffset(
	animState: AnimationState,
	enabled: boolean,
	speed: number,
	direction = 1,
): number {
	if (!enabled) {
		return 0;
	}
	return wrapUnit((animState.tickCount * speed * direction) / 256);
}

function getBarColor(
	startHex: string,
	endHex: string,
	intensity: number,
	hueShiftOffset: number,
): string {
	return lerpColor(startHex, endHex, wrapUnit(clampUnit(intensity) + hueShiftOffset));
}

function getPeakRowIndex(origin: "bottom" | "top", peakValue: number, rows: number): number {
	const peakRow = Math.max(0, Math.min(rows - 1, Math.ceil(clampUnit(peakValue) * rows) - 1));
	return origin === "bottom" ? rows - 1 - peakRow : peakRow;
}

function createGapAwareGrid(cols: number, rows: number, barGap: number): string[][] {
	return Array.from({ length: rows }, () => new Array(cols + barGap * (cols - 1)).fill(" "));
}

function parseConfig(opts?: SpectrumBarsOptions): RenderConfig {
	return {
		cols: requireNumberOption(opts?.cols, MODULE_ID, "cols"),
		rows: requireNumberOption(opts?.rows, MODULE_ID, "rows"),
		speed: requireNumberOption(opts?.speed, MODULE_ID, "speed"),
		decay: requireNumberOption(opts?.decay, MODULE_ID, "decay"),
		peakHold: requireBooleanOption(opts?.peakHold, MODULE_ID, "peakHold"),
		peakDecay: requireNumberOption(opts?.peakDecay, MODULE_ID, "peakDecay"),
		smoothing: requireNumberOption(opts?.smoothing, MODULE_ID, "smoothing"),
		barGap: requireNumberOption(opts?.barGap, MODULE_ID, "barGap"),
		hueRangeStartStep: requireNumberOption(opts?.hueRangeStartStep, MODULE_ID, "hueRangeStartStep"),
		hueRangeEndStep: requireNumberOption(opts?.hueRangeEndStep, MODULE_ID, "hueRangeEndStep"),
		hueShiftEnabled: requireBooleanOption(opts?.hueShiftEnabled, MODULE_ID, "hueShiftEnabled"),
		hueShiftSpeed: requireNumberOption(opts?.hueShiftSpeed, MODULE_ID, "hueShiftSpeed"),
		glyphCount: requireNumberOption(opts?.glyphCount, MODULE_ID, "glyphCount"),
		stereoLayout: requireStringOption(opts?.stereoLayout ?? "overlap", MODULE_ID, "stereoLayout"),
		stereoStartOffsetStep: requireNumberOption(opts?.stereoStartOffsetStep ?? 64, MODULE_ID, "stereoStartOffsetStep"),
		stereoFlipHueShift: requireBooleanOption(opts?.stereoFlipHueShift ?? false, MODULE_ID, "stereoFlipHueShift"),
		stereoFlipGlyphOrder: requireBooleanOption(opts?.stereoFlipGlyphOrder ?? false, MODULE_ID, "stereoFlipGlyphOrder"),
	};
}

function getMonoState(config: RenderConfig): MonoRendererState {
	const cacheKey = JSON.stringify({
		cols: config.cols,
		speed: config.speed,
		decay: config.decay,
		smoothing: config.smoothing,
		peakHold: config.peakHold,
		peakDecay: config.peakDecay,
	});

	let state = monoRendererCache.get(cacheKey);
	if (!state) {
		state = {
			lastTick: -1,
			trackers: createTrackers(config.cols),
			values: new Array(config.cols).fill(0),
		};
		monoRendererCache.clear();
		monoRendererCache.set(cacheKey, state);
	}
	return state;
}

function getStereoState(config: RenderConfig): StereoRendererState {
	const cacheKey = JSON.stringify({
		cols: config.cols,
		speed: config.speed,
		decay: config.decay,
		smoothing: config.smoothing,
		peakHold: config.peakHold,
		peakDecay: config.peakDecay,
		stereoStartOffsetStep: config.stereoStartOffsetStep,
	});

	let state = stereoRendererCache.get(cacheKey);
	if (!state) {
		state = {
			lastTick: -1,
			leftTrackers: createTrackers(config.cols),
			rightTrackers: createTrackers(config.cols, (wrapStep(config.stereoStartOffsetStep) / 256) * Math.PI * 2),
			leftValues: new Array(config.cols).fill(0),
			rightValues: new Array(config.cols).fill(0),
		};
		stereoRendererCache.clear();
		stereoRendererCache.set(cacheKey, state);
	}
	return state;
}

export function createSpectrumBars(opts?: SpectrumBarsOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const config = parseConfig(opts);
	const glyphSubset = getGlyphSubset(config.glyphCount);
	const startHex = stepToHex(config.hueRangeStartStep);
	const endHex = stepToHex(config.hueRangeEndStep);
	const monoState = getMonoState(config);

	return (animState: AnimationState, _theme: ThemeConfig): string => {
		if (animState.tickCount !== monoState.lastTick) {
			monoState.lastTick = animState.tickCount;
			monoState.values = advanceTrackers(monoState.trackers, config);
		}

		const hueShiftOffset = getHueShiftOffset(animState, config.hueShiftEnabled, config.hueShiftSpeed);
		const grid = createGapAwareGrid(config.cols, config.rows, config.barGap);

		for (let x = 0; x < config.cols; x++) {
			const value = clampUnit(monoState.values[x] ?? 0);
			const peakValue = clampUnit(monoState.trackers[x]?.peak ?? 0);
			const gridX = x + config.barGap * x;
			const color = getBarColor(startHex, endHex, value, hueShiftOffset);
			const filledCells = value * config.rows;
			const peakRow = getPeakRowIndex("bottom", peakValue, config.rows);

			for (let y = 0; y < config.rows; y++) {
				const fromBottom = config.rows - 1 - y;
				const localFill = clampUnit(filledCells - fromBottom);
				if (localFill > 0.02) {
					const glyph = resolveGlyphChoice(localFill, glyphSubset);
					grid[y]![gridX] = style({ fg: color })(glyph.char);
				} else if (config.peakHold && y === peakRow) {
					grid[y]![gridX] = style({ fg: lerpColor(color, "#ffffff", 0.35) })("^");
				} else {
					grid[y]![gridX] = style({ fg: DIM })(".");
				}
			}

			if (config.barGap > 0 && x < config.cols - 1) {
				for (let y = 0; y < config.rows; y++) {
					for (let gapOffset = 1; gapOffset <= config.barGap; gapOffset++) {
						grid[y]![gridX + gapOffset] = " ";
					}
				}
			}
		}

		return grid.map((row) => row.join("")).join("\n");
	};
}

export function renderSpectrumBarsStereo(
	animState: AnimationState,
	_theme: ThemeConfig,
	opts?: SpectrumBarsOptions,
): string {
	const config = parseConfig(opts);
	const glyphSubset = getGlyphSubset(config.glyphCount);
	const startHex = stepToHex(config.hueRangeStartStep);
	const endHex = stepToHex(config.hueRangeEndStep);
	const stereoState = getStereoState(config);

	if (animState.tickCount !== stereoState.lastTick) {
		stereoState.lastTick = animState.tickCount;
		stereoState.leftValues = advanceTrackers(stereoState.leftTrackers, config);
		stereoState.rightValues = advanceTrackers(stereoState.rightTrackers, config);
	}

	const leftHueShift = getHueShiftOffset(animState, config.hueShiftEnabled, config.hueShiftSpeed, 1);
	const rightHueShift = getHueShiftOffset(
		animState,
		config.hueShiftEnabled,
		config.hueShiftSpeed,
		config.stereoFlipHueShift ? -1 : 1,
	);
	const grid = createGapAwareGrid(config.cols, config.rows, config.barGap);

	for (let x = 0; x < config.cols; x++) {
		const gridX = x + config.barGap * x;
		const leftValue = clampUnit(stereoState.leftValues[x] ?? 0);
		const rightValue = clampUnit(stereoState.rightValues[x] ?? 0);
		const leftPeak = clampUnit(stereoState.leftTrackers[x]?.peak ?? 0);
		const rightPeak = clampUnit(stereoState.rightTrackers[x]?.peak ?? 0);
		const leftColor = getBarColor(startHex, endHex, leftValue, leftHueShift);
		const rightColor = getBarColor(startHex, endHex, rightValue, rightHueShift);
		const overlapColor = lerpColor(leftColor, rightColor, 0.5);
		const leftFilledCells = leftValue * config.rows;
		const rightFilledCells = rightValue * config.rows;
		const leftPeakRow = getPeakRowIndex("bottom", leftPeak, config.rows);
		const rightPeakRow = getPeakRowIndex(config.stereoLayout === "mirrored" ? "top" : "bottom", rightPeak, config.rows);

		for (let y = 0; y < config.rows; y++) {
			const fromBottom = config.rows - 1 - y;
			const leftFill = clampUnit(leftFilledCells - fromBottom);
			const rightFill = config.stereoLayout === "mirrored"
				? clampUnit(rightFilledCells - y)
				: clampUnit(rightFilledCells - fromBottom);
			const leftActive = leftFill > 0.02;
			const rightActive = rightFill > 0.02;

			if (leftActive && rightActive) {
				const leftGlyph = resolveGlyphChoice(leftFill, glyphSubset);
				const rightGlyph = resolveGlyphChoice(rightFill, glyphSubset, config.stereoFlipGlyphOrder);
				const chosenGlyph = leftGlyph.densityIndex >= rightGlyph.densityIndex ? leftGlyph : rightGlyph;
				grid[y]![gridX] = style({ fg: overlapColor })(chosenGlyph.char);
			} else if (leftActive) {
				const leftGlyph = resolveGlyphChoice(leftFill, glyphSubset);
				grid[y]![gridX] = style({ fg: leftColor })(leftGlyph.char);
			} else if (rightActive) {
				const rightGlyph = resolveGlyphChoice(rightFill, glyphSubset, config.stereoFlipGlyphOrder);
				grid[y]![gridX] = style({ fg: rightColor })(rightGlyph.char);
			} else if (config.peakHold && y === leftPeakRow && y === rightPeakRow) {
				grid[y]![gridX] = style({ fg: lerpColor(overlapColor, "#ffffff", 0.25) })("*");
			} else if (config.peakHold && y === leftPeakRow) {
				grid[y]![gridX] = style({ fg: lerpColor(leftColor, "#ffffff", 0.35) })("^");
			} else if (config.peakHold && y === rightPeakRow) {
				const rightPeakGlyph = config.stereoLayout === "mirrored" ? "v" : "^";
				grid[y]![gridX] = style({ fg: lerpColor(rightColor, "#ffffff", 0.35) })(rightPeakGlyph);
			} else {
				grid[y]![gridX] = style({ fg: DIM })(".");
			}
		}

		if (config.barGap > 0 && x < config.cols - 1) {
			for (let y = 0; y < config.rows; y++) {
				for (let gapOffset = 1; gapOffset <= config.barGap; gapOffset++) {
					grid[y]![gridX + gapOffset] = " ";
				}
			}
		}
	}

	return grid.map((row) => row.join("")).join("\n");
}
