import { hslToHex, style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface WaterRippleOptions {
	cols?: number;
	rows?: number;
	damping?: number;
	disturbInterval?: number;
	raindropChance?: number;
	raindropStrength?: number;
	reflectionEnabled?: boolean;
	refractionStrength?: number;
	multipleDrops?: boolean;
	baseHueStep?: number;
	raindropHueStep?: number;
	raindropSize?: number;
	raindropSizeRange?: number;
}

export interface WaterRippleResolvedOptions {
	cols: number;
	rows: number;
	damping: number;
	disturbInterval: number;
	raindropChance: number;
	raindropStrength: number;
	reflectionEnabled: boolean;
	refractionStrength: number;
	multipleDrops: boolean;
	baseHueStep: number;
	raindropHueStep: number;
	raindropSize: number;
	raindropSizeRange: number;
}

export interface WaterRippleNumberOptionSpec {
	defaultValue: number;
	min: number;
	max: number;
	step: number;
	integer?: boolean;
}

export const WATER_RIPPLE_NUMBER_OPTION_SPECS = Object.freeze({
	cols: { defaultValue: 24, min: 4, max: 120, step: 1, integer: true },
	rows: { defaultValue: 8, min: 4, max: 40, step: 1, integer: true },
	damping: { defaultValue: 0.98, min: 0.85, max: 0.999, step: 0.001 },
	disturbInterval: { defaultValue: 40, min: 1, max: 240, step: 1, integer: true },
	raindropChance: { defaultValue: 0.3, min: 0, max: 1, step: 0.01 },
	raindropStrength: { defaultValue: 180, min: 40, max: 240, step: 1 },
	refractionStrength: { defaultValue: 0.5, min: 0, max: 1, step: 0.01 },
	baseHueStep: { defaultValue: 148, min: 0, max: 256, step: 1, integer: true },
	raindropHueStep: { defaultValue: 132, min: 0, max: 256, step: 1, integer: true },
	raindropSize: { defaultValue: 3, min: 1, max: 12, step: 0.1 },
	raindropSizeRange: { defaultValue: 1.5, min: 0, max: 6, step: 0.1 },
} satisfies Record<string, WaterRippleNumberOptionSpec>);

export const WATER_RIPPLE_DEFAULTS: Readonly<WaterRippleResolvedOptions> = Object.freeze({
	cols: WATER_RIPPLE_NUMBER_OPTION_SPECS.cols.defaultValue,
	rows: WATER_RIPPLE_NUMBER_OPTION_SPECS.rows.defaultValue,
	damping: WATER_RIPPLE_NUMBER_OPTION_SPECS.damping.defaultValue,
	disturbInterval: WATER_RIPPLE_NUMBER_OPTION_SPECS.disturbInterval.defaultValue,
	raindropChance: WATER_RIPPLE_NUMBER_OPTION_SPECS.raindropChance.defaultValue,
	raindropStrength: WATER_RIPPLE_NUMBER_OPTION_SPECS.raindropStrength.defaultValue,
	reflectionEnabled: true,
	refractionStrength: WATER_RIPPLE_NUMBER_OPTION_SPECS.refractionStrength.defaultValue,
	multipleDrops: false,
	baseHueStep: WATER_RIPPLE_NUMBER_OPTION_SPECS.baseHueStep.defaultValue,
	raindropHueStep: WATER_RIPPLE_NUMBER_OPTION_SPECS.raindropHueStep.defaultValue,
	raindropSize: WATER_RIPPLE_NUMBER_OPTION_SPECS.raindropSize.defaultValue,
	raindropSizeRange: WATER_RIPPLE_NUMBER_OPTION_SPECS.raindropSizeRange.defaultValue,
});

const PAL = [" ", "·", ":", ";", "|", "+", "=", "*", "#", "@"] as const;
const WATER_SATURATION = 0.82;
const WATER_LIGHTNESS = 0.46;
const WATER_RIPPLE_INTENSITY_SCALE = 120;
const WATER_RIPPLE_PREWARM_STEPS = 12;

interface Raindrop {
	x: number;
	y: number;
	strength: number;
	radius: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function normalizeNumberOption(value: number | undefined, spec: WaterRippleNumberOptionSpec): number {
	const numeric = typeof value === "number" && Number.isFinite(value) ? value : spec.defaultValue;
	const normalized = spec.integer ? Math.round(numeric) : numeric;
	return clamp(normalized, spec.min, spec.max);
}

function normalizeBooleanOption(value: boolean | undefined, defaultValue: boolean): boolean {
	return typeof value === "boolean" ? value : defaultValue;
}

function isValidNumberOption(value: unknown, spec: WaterRippleNumberOptionSpec): value is number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return false;
	}
	if (value < spec.min || value > spec.max) {
		return false;
	}
	return !spec.integer || Number.isInteger(value);
}

function hueStepToHex(step: number): string {
	const hue = (clamp(step, 0, 256) / 256) * 360;
	return hslToHex(hue, WATER_SATURATION, WATER_LIGHTNESS);
}

function getRandomizedRadius(raindropSize: number, raindropSizeRange: number): number {
	if (raindropSizeRange <= 0) {
		return raindropSize;
	}

	const minRadius = Math.max(1, raindropSize - raindropSizeRange);
	const maxRadius = Math.min(12, raindropSize + raindropSizeRange);
	return minRadius + Math.random() * (maxRadius - minRadius);
}

export function normalizeWaterRippleOptions(opts?: WaterRippleOptions): WaterRippleResolvedOptions {
	return {
		cols: normalizeNumberOption(opts?.cols, WATER_RIPPLE_NUMBER_OPTION_SPECS.cols),
		rows: normalizeNumberOption(opts?.rows, WATER_RIPPLE_NUMBER_OPTION_SPECS.rows),
		damping: normalizeNumberOption(opts?.damping, WATER_RIPPLE_NUMBER_OPTION_SPECS.damping),
		disturbInterval: normalizeNumberOption(opts?.disturbInterval, WATER_RIPPLE_NUMBER_OPTION_SPECS.disturbInterval),
		raindropChance: normalizeNumberOption(opts?.raindropChance, WATER_RIPPLE_NUMBER_OPTION_SPECS.raindropChance),
		raindropStrength: normalizeNumberOption(opts?.raindropStrength, WATER_RIPPLE_NUMBER_OPTION_SPECS.raindropStrength),
		reflectionEnabled: normalizeBooleanOption(opts?.reflectionEnabled, WATER_RIPPLE_DEFAULTS.reflectionEnabled),
		refractionStrength: normalizeNumberOption(opts?.refractionStrength, WATER_RIPPLE_NUMBER_OPTION_SPECS.refractionStrength),
		multipleDrops: normalizeBooleanOption(opts?.multipleDrops, WATER_RIPPLE_DEFAULTS.multipleDrops),
		baseHueStep: normalizeNumberOption(opts?.baseHueStep, WATER_RIPPLE_NUMBER_OPTION_SPECS.baseHueStep),
		raindropHueStep: normalizeNumberOption(opts?.raindropHueStep, WATER_RIPPLE_NUMBER_OPTION_SPECS.raindropHueStep),
		raindropSize: normalizeNumberOption(opts?.raindropSize, WATER_RIPPLE_NUMBER_OPTION_SPECS.raindropSize),
		raindropSizeRange: normalizeNumberOption(opts?.raindropSizeRange, WATER_RIPPLE_NUMBER_OPTION_SPECS.raindropSizeRange),
	};
}

export function isWaterRippleOptionsPresetValid(opts: unknown): opts is WaterRippleResolvedOptions {
	if (typeof opts !== "object" || opts === null) {
		return false;
	}

	const candidate = opts as WaterRippleOptions;
	return (
		isValidNumberOption(candidate.cols, WATER_RIPPLE_NUMBER_OPTION_SPECS.cols) &&
		isValidNumberOption(candidate.rows, WATER_RIPPLE_NUMBER_OPTION_SPECS.rows) &&
		isValidNumberOption(candidate.damping, WATER_RIPPLE_NUMBER_OPTION_SPECS.damping) &&
		isValidNumberOption(candidate.disturbInterval, WATER_RIPPLE_NUMBER_OPTION_SPECS.disturbInterval) &&
		isValidNumberOption(candidate.raindropChance, WATER_RIPPLE_NUMBER_OPTION_SPECS.raindropChance) &&
		isValidNumberOption(candidate.raindropStrength, WATER_RIPPLE_NUMBER_OPTION_SPECS.raindropStrength) &&
		typeof candidate.reflectionEnabled === "boolean" &&
		isValidNumberOption(candidate.refractionStrength, WATER_RIPPLE_NUMBER_OPTION_SPECS.refractionStrength) &&
		typeof candidate.multipleDrops === "boolean" &&
		isValidNumberOption(candidate.baseHueStep, WATER_RIPPLE_NUMBER_OPTION_SPECS.baseHueStep) &&
		isValidNumberOption(candidate.raindropHueStep, WATER_RIPPLE_NUMBER_OPTION_SPECS.raindropHueStep) &&
		isValidNumberOption(candidate.raindropSize, WATER_RIPPLE_NUMBER_OPTION_SPECS.raindropSize) &&
		isValidNumberOption(candidate.raindropSizeRange, WATER_RIPPLE_NUMBER_OPTION_SPECS.raindropSizeRange)
	);
}

export function createWaterRipple(opts?: WaterRippleOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const {
		cols,
		rows,
		damping,
		disturbInterval,
		raindropChance,
		raindropStrength,
		reflectionEnabled,
		refractionStrength,
		multipleDrops,
		baseHueStep,
		raindropHueStep,
		raindropSize,
		raindropSizeRange,
	} = normalizeWaterRippleOptions(opts);

	const baseHex = hueStepToHex(baseHueStep);
	const raindropHex = hueStepToHex(raindropHueStep);

	let cur = new Float32Array(cols * rows);
	let prv = new Float32Array(cols * rows);
	let lastTick = -1;
	let ticksSinceDisturbance = disturbInterval;
	const raindrops: Raindrop[] = [];

	function stampDisturbance(cx: number, cy: number, strength: number, radius: number): void {
		const minX = Math.max(1, Math.floor(cx - radius));
		const maxX = Math.min(cols - 2, Math.ceil(cx + radius));
		const minY = Math.max(1, Math.floor(cy - radius));
		const maxY = Math.min(rows - 2, Math.ceil(cy + radius));

		for (let y = minY; y <= maxY; y++) {
			for (let x = minX; x <= maxX; x++) {
				const dx = x - cx;
				const dy = y - cy;
				const dist = Math.sqrt(dx * dx + dy * dy);
				if (dist > radius) {
					continue;
				}
				const falloff = Math.max(0, 1 - dist / radius);
				cur[y * cols + x] += strength * falloff;
			}
		}
	}

	function addDrop(cx: number, cy: number, strength: number): void {
		const radius = getRandomizedRadius(raindropSize, raindropSizeRange);
		stampDisturbance(cx, cy, strength, radius);
		if (reflectionEnabled) {
			raindrops.push({ x: cx, y: cy, strength, radius });
		}
	}

	function spawnDisturbance(): void {
		if (multipleDrops) {
			const dropCount = Math.floor(Math.random() * 3) + 1;
			for (let d = 0; d < dropCount; d++) {
				const rx = 1 + Math.floor(Math.random() * (cols - 2));
				const ry = 1 + Math.floor(Math.random() * (rows - 2));
				const strength = raindropStrength * (0.5 + Math.random() * 0.5);
				addDrop(rx, ry, strength);
			}
			return;
		}

		const rx = 1 + Math.floor(Math.random() * (cols - 2));
		const ry = 1 + Math.floor(Math.random() * (rows - 2));
		if (raindropChance > Math.random()) {
			addDrop(rx, ry, raindropStrength);
		}
	}

	function stepSimulation(): void {
		ticksSinceDisturbance++;
		if (ticksSinceDisturbance >= disturbInterval) {
			ticksSinceDisturbance = 0;
			spawnDisturbance();
		}

		const next = new Float32Array(cols * rows);
		for (let y = 1; y < rows - 1; y++) {
			for (let x = 1; x < cols - 1; x++) {
				let avg = (
					cur[(y - 1) * cols + x] +
					cur[(y + 1) * cols + x] +
					cur[y * cols + x - 1] +
					cur[y * cols + x + 1]
				) / 2 - prv[y * cols + x];

				if (reflectionEnabled) {
					for (const drop of raindrops) {
						const dx = x - drop.x;
						const dy = y - drop.y;
						const dist = Math.sqrt(dx * dx + dy * dy);
						if (dist >= drop.radius || dist <= 0) {
							continue;
						}
						const normalizedDistance = 1 - dist / drop.radius;
						avg += drop.strength * refractionStrength * normalizedDistance / (dist + 1);
					}
				}

				next[y * cols + x] = avg * damping;
			}
		}

		prv = cur;
		cur = next;

		for (let i = raindrops.length - 1; i >= 0; i--) {
			raindrops[i]!.strength *= 0.9;
			if (raindrops[i]!.strength < 5) {
				raindrops.splice(i, 1);
			}
		}
	}

	function prewarmSimulation(): void {
		for (let step = 0; step < WATER_RIPPLE_PREWARM_STEPS; step++) {
			stepSimulation();
		}
	}

	prewarmSimulation();

	return (animState: AnimationState, _theme: ThemeConfig): string => {
		if (animState.tickCount !== lastTick) {
			lastTick = animState.tickCount;
			stepSimulation();
		}

		const rowStrings: string[] = [];
		for (let y = 0; y < rows; y++) {
			let row = "";
			for (let x = 0; x < cols; x++) {
				const v = Math.abs(cur[y * cols + x]!);
				const t = Math.min(1, v / WATER_RIPPLE_INTENSITY_SCALE);
				const color = lerpColor(baseHex, raindropHex, t);
				if (t < 0.04) {
					row += style({ fg: color })("·");
				} else {
					const charIdx = Math.min(PAL.length - 1, Math.floor(t * PAL.length));
					row += style({ fg: color })(PAL[charIdx]!);
				}
			}
			rowStrings.push(row);
		}
		return rowStrings.join("\n");
	};
}
