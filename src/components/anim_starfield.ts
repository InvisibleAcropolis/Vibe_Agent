import { hslToHex, style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import type { ThemeConfig } from "../themes/index.js";

export interface StarfieldOptions {
	cols?: number;
	rows?: number;
	count?: number;
	speed?: number;
	streaks?: number;
	trails?: number;
	intensity?: number;
	brightness?: number;
	glyphRange?: number;
}

export interface StarfieldResolvedOptions {
	cols: number;
	rows: number;
	count: number;
	speed: number;
	streaks: number;
	trails: number;
	intensity: number;
	brightness: number;
	glyphRange: number;
}

export interface StarfieldNumberOptionSpec {
	defaultValue: number;
	min: number;
	max: number;
	step: number;
	integer?: boolean;
}

export const STARFIELD_NUMBER_OPTION_SPECS = Object.freeze({
	cols: { defaultValue: 24, min: 4, max: 120, step: 1, integer: true },
	rows: { defaultValue: 8, min: 4, max: 40, step: 1, integer: true },
	count: { defaultValue: 120, min: 8, max: 512, step: 1, integer: true },
	speed: { defaultValue: 0.06, min: 0.005, max: 0.35, step: 0.005 },
	streaks: { defaultValue: 0.55, min: 0, max: 1, step: 0.01 },
	trails: { defaultValue: 0.35, min: 0, max: 1, step: 0.01 },
	intensity: { defaultValue: 1, min: 0, max: 2, step: 0.01 },
	brightness: { defaultValue: 0, min: 0, max: 1, step: 0.01 },
	glyphRange: { defaultValue: 8, min: 1, max: 18, step: 1, integer: true },
} satisfies Record<string, StarfieldNumberOptionSpec>);

export const STARFIELD_DEFAULTS: Readonly<StarfieldResolvedOptions> = Object.freeze({
	cols: STARFIELD_NUMBER_OPTION_SPECS.cols.defaultValue,
	rows: STARFIELD_NUMBER_OPTION_SPECS.rows.defaultValue,
	count: STARFIELD_NUMBER_OPTION_SPECS.count.defaultValue,
	speed: STARFIELD_NUMBER_OPTION_SPECS.speed.defaultValue,
	streaks: STARFIELD_NUMBER_OPTION_SPECS.streaks.defaultValue,
	trails: STARFIELD_NUMBER_OPTION_SPECS.trails.defaultValue,
	intensity: STARFIELD_NUMBER_OPTION_SPECS.intensity.defaultValue,
	brightness: STARFIELD_NUMBER_OPTION_SPECS.brightness.defaultValue,
	glyphRange: STARFIELD_NUMBER_OPTION_SPECS.glyphRange.defaultValue,
});

const MASTER_STAR_GLYPHS = ["·", "•", "∙", "✦", "✧", "★", "☆", "✶", "✷", "✸", "✹", "✺", "✴", "✵", "✱", "✲", "✳", "◈"] as const;
const STREAK_GLYPHS = ["·", "•", "∙", "✦", "✧"] as const;
const FAR_DEPTH = 1.25;
const NEAR_DEPTH = 0.035;
const OUTSIDE_MARGIN = 3;

interface Star {
	x: number;
	y: number;
	z: number;
	prevScreenX?: number;
	prevScreenY?: number;
	huePhase: number;
	hueSpeed: number;
	twinklePhase: number;
	baseBrightness: number;
	glyph: string;
}

interface ProjectionResult {
	x: number;
	y: number;
	depth: number;
}

interface TunnelDirection {
	dirX: number;
	dirY: number;
	motionMagnitude: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function wrapStep(value: number): number {
	const wrapped = value % 256;
	return wrapped < 0 ? wrapped + 256 : wrapped;
}

function normalizeNumberOption(value: number | undefined, spec: StarfieldNumberOptionSpec): number {
	const numeric = typeof value === "number" && Number.isFinite(value) ? value : spec.defaultValue;
	const normalized = spec.integer ? Math.round(numeric) : numeric;
	return clamp(normalized, spec.min, spec.max);
}

function isValidNumberOption(value: unknown, spec: StarfieldNumberOptionSpec): value is number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return false;
	}
	if (value < spec.min || value > spec.max) {
		return false;
	}
	return !spec.integer || Number.isInteger(value);
}

function stepToHex(step: number, saturation: number, lightness: number): string {
	return hslToHex((wrapStep(step) / 256) * 360, clamp(saturation, 0, 1), clamp(lightness, 0, 1));
}

function createStar(): Star {
	return {
		x: 0,
		y: 0,
		z: 0,
		prevScreenX: undefined,
		prevScreenY: undefined,
		huePhase: Math.random() * 256,
		hueSpeed: 10 + Math.random() * 20,
		twinklePhase: Math.random() * Math.PI * 2,
		baseBrightness: 0.65,
		glyph: MASTER_STAR_GLYPHS[0],
	};
}

function getActiveStarGlyphs(glyphRange: number): readonly string[] {
	return MASTER_STAR_GLYPHS.slice(0, clamp(Math.round(glyphRange), 1, MASTER_STAR_GLYPHS.length));
}

function respawnStar(star: Star, activeGlyphs: readonly string[]): void {
	const angle = Math.random() * Math.PI * 2;
	const radius = Math.sqrt(Math.random()) * 1.15;
	star.x = Math.cos(angle) * radius;
	star.y = Math.sin(angle) * radius;
	star.z = NEAR_DEPTH + 0.08 + Math.random() * (FAR_DEPTH - (NEAR_DEPTH + 0.08));
	star.prevScreenX = undefined;
	star.prevScreenY = undefined;
	star.huePhase = Math.random() * 256;
	star.hueSpeed = 10 + Math.random() * 20;
	star.twinklePhase = Math.random() * Math.PI * 2;
	star.baseBrightness = 0.35 + Math.random() * 0.6;
	star.glyph = activeGlyphs[Math.floor(Math.random() * activeGlyphs.length)] ?? MASTER_STAR_GLYPHS[0];
}

function projectStar(star: Star, cols: number, rows: number): ProjectionResult {
	const centerX = (cols - 1) / 2;
	const centerY = (rows - 1) / 2;
	const perspective = Math.min(cols, rows * 2) * 0.68;
	const inverseZ = 1 / Math.max(star.z, NEAR_DEPTH);
	return {
		x: centerX + star.x * inverseZ * perspective,
		y: centerY + star.y * inverseZ * perspective * 0.5,
		depth: clamp(1 - (star.z - NEAR_DEPTH) / (FAR_DEPTH - NEAR_DEPTH), 0, 1),
	};
}

function isOutsideViewport(x: number, y: number, cols: number, rows: number): boolean {
	return x < -OUTSIDE_MARGIN || x >= cols + OUTSIDE_MARGIN || y < -OUTSIDE_MARGIN || y >= rows + OUTSIDE_MARGIN;
}

function plotCell(
	grid: string[][],
	brightness: number[][],
	x: number,
	y: number,
	value: number,
	color: string,
	glyph: string,
): void {
	const px = Math.round(x);
	const py = Math.round(y);
	if (py < 0 || py >= grid.length || px < 0 || px >= grid[py]!.length) {
		return;
	}
	if (value <= brightness[py]![px]!) {
		return;
	}
	brightness[py]![px] = value;
	grid[py]![px] = style({ fg: color })(glyph);
}

function resolveTunnelDirection(
	centerX: number,
	centerY: number,
	currentX: number,
	currentY: number,
	prevX: number | undefined,
	prevY: number | undefined,
): TunnelDirection | undefined {
	const radialDx = currentX - centerX;
	const radialDy = currentY - centerY;
	const radialDistance = Math.hypot(radialDx, radialDy);
	if (radialDistance >= 0.15) {
		const motionDx = prevX === undefined ? 0 : currentX - prevX;
		const motionDy = prevY === undefined ? 0 : currentY - prevY;
		return {
			dirX: radialDx / radialDistance,
			dirY: radialDy / radialDistance,
			motionMagnitude: Math.hypot(motionDx, motionDy),
		};
	}

	if (prevX !== undefined && prevY !== undefined) {
		const fallbackDx = currentX - prevX;
		const fallbackDy = currentY - prevY;
		const fallbackDistance = Math.hypot(fallbackDx, fallbackDy);
		if (fallbackDistance >= 0.1) {
			return {
				dirX: fallbackDx / fallbackDistance,
				dirY: fallbackDy / fallbackDistance,
				motionMagnitude: fallbackDistance,
			};
		}
	}

	return undefined;
}

function renderStreaks(
	grid: string[][],
	brightness: number[][],
	currentX: number,
	currentY: number,
	tunnelDirection: TunnelDirection | undefined,
	headIntensity: number,
	starBrightness: number,
	depth: number,
	color: string,
	streaks: number,
): void {
	if (streaks <= 0 || tunnelDirection === undefined) {
		return;
	}

	const { dirX, dirY, motionMagnitude } = tunnelDirection;
	const stretch = (0.45 + motionMagnitude * 1.35 + depth * 1.8) * (0.35 + streaks * 2.6);
	if (stretch < 0.2) {
		return;
	}

	const steps = Math.max(2, Math.ceil(stretch * 1.8));

	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		const sampleX = currentX - dirX * stretch * t;
		const sampleY = currentY - dirY * stretch * t;
		const sampleIntensity = headIntensity * starBrightness * streaks * (1 - t) * 0.85;
		const glyphIndex = Math.max(0, Math.min(STREAK_GLYPHS.length - 1, Math.floor(sampleIntensity * STREAK_GLYPHS.length)));
		plotCell(grid, brightness, sampleX, sampleY, sampleIntensity, color, STREAK_GLYPHS[glyphIndex]!);
	}
}

function renderTrailShadow(
	grid: string[][],
	brightness: number[][],
	currentX: number,
	currentY: number,
	tunnelDirection: TunnelDirection | undefined,
	headIntensity: number,
	starBrightness: number,
	depth: number,
	color: string,
	trails: number,
): void {
	if (trails <= 0 || tunnelDirection === undefined) {
		return;
	}

	const { dirX, dirY, motionMagnitude } = tunnelDirection;
	const shadowDistance = (1.4 + motionMagnitude * 1.7 + depth * 2.2) * trails * 2.6;
	if (shadowDistance < 0.25) {
		return;
	}

	const echoes = Math.max(1, Math.round(1 + trails * 4));

	for (let i = 1; i <= echoes; i++) {
		const t = i / echoes;
		const sampleX = currentX - dirX * shadowDistance * t;
		const sampleY = currentY - dirY * shadowDistance * t;
		const sampleIntensity = headIntensity * starBrightness * trails * (1 - t) * 0.55;
		plotCell(grid, brightness, sampleX, sampleY, sampleIntensity, color, i === echoes ? "·" : "•");
	}
}

export function normalizeStarfieldOptions(opts?: StarfieldOptions): StarfieldResolvedOptions {
	return {
		cols: normalizeNumberOption(opts?.cols, STARFIELD_NUMBER_OPTION_SPECS.cols),
		rows: normalizeNumberOption(opts?.rows, STARFIELD_NUMBER_OPTION_SPECS.rows),
		count: normalizeNumberOption(opts?.count, STARFIELD_NUMBER_OPTION_SPECS.count),
		speed: normalizeNumberOption(opts?.speed, STARFIELD_NUMBER_OPTION_SPECS.speed),
		streaks: normalizeNumberOption(opts?.streaks, STARFIELD_NUMBER_OPTION_SPECS.streaks),
		trails: normalizeNumberOption(opts?.trails, STARFIELD_NUMBER_OPTION_SPECS.trails),
		intensity: normalizeNumberOption(opts?.intensity, STARFIELD_NUMBER_OPTION_SPECS.intensity),
		brightness: normalizeNumberOption(opts?.brightness, STARFIELD_NUMBER_OPTION_SPECS.brightness),
		glyphRange: normalizeNumberOption(opts?.glyphRange, STARFIELD_NUMBER_OPTION_SPECS.glyphRange),
	};
}

export function isStarfieldOptionsPresetValid(opts: unknown): opts is StarfieldResolvedOptions {
	if (typeof opts !== "object" || opts === null) {
		return false;
	}
	const candidate = opts as StarfieldOptions;
	return (
		isValidNumberOption(candidate.cols, STARFIELD_NUMBER_OPTION_SPECS.cols) &&
		isValidNumberOption(candidate.rows, STARFIELD_NUMBER_OPTION_SPECS.rows) &&
		isValidNumberOption(candidate.count, STARFIELD_NUMBER_OPTION_SPECS.count) &&
		isValidNumberOption(candidate.speed, STARFIELD_NUMBER_OPTION_SPECS.speed) &&
		isValidNumberOption(candidate.streaks, STARFIELD_NUMBER_OPTION_SPECS.streaks) &&
		isValidNumberOption(candidate.trails, STARFIELD_NUMBER_OPTION_SPECS.trails) &&
		isValidNumberOption(candidate.intensity, STARFIELD_NUMBER_OPTION_SPECS.intensity) &&
		isValidNumberOption(candidate.brightness, STARFIELD_NUMBER_OPTION_SPECS.brightness) &&
		isValidNumberOption(candidate.glyphRange, STARFIELD_NUMBER_OPTION_SPECS.glyphRange)
	);
}

export function createStarfield(opts?: StarfieldOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const {
		cols,
		rows,
		count,
		speed,
		streaks,
		trails,
		intensity,
		brightness,
		glyphRange,
	} = normalizeStarfieldOptions(opts);

	const activeGlyphs = getActiveStarGlyphs(glyphRange);
	const stars: Star[] = Array.from({ length: count }, () => {
		const star = createStar();
		respawnStar(star, activeGlyphs);
		return star;
	});

	return (animState: AnimationState, _theme: ThemeConfig): string => {
		const centerX = (cols - 1) / 2;
		const centerY = (rows - 1) / 2;
		const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(" "));
		const brightnessMap: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
		const simulationSteps = Math.max(1, Math.ceil(speed / 0.08));
		const speedPerStep = speed / simulationSteps;

		for (let stepIndex = 0; stepIndex < simulationSteps; stepIndex++) {
			for (const star of stars) {
				star.z -= speedPerStep;
				if (star.z <= NEAR_DEPTH) {
					respawnStar(star, activeGlyphs);
				}
			}
		}

		for (const star of stars) {
			const projection = projectStar(star, cols, rows);
			if (isOutsideViewport(projection.x, projection.y, cols, rows)) {
				respawnStar(star, activeGlyphs);
				continue;
			}

			const prevX = star.prevScreenX;
			const prevY = star.prevScreenY;
			const screenVelocity = prevX === undefined || prevY === undefined ? 0 : Math.hypot(projection.x - prevX, projection.y - prevY);
			const tunnelDirection = resolveTunnelDirection(centerX, centerY, projection.x, projection.y, prevX, prevY);
			const velocityFactor = clamp(screenVelocity / 4.5, 0, 1);
			const twinkle = 0.5 + 0.5 * Math.sin(animState.tickCount * 0.65 + star.twinklePhase);
			const headIntensity = clamp(projection.depth * 0.8 + velocityFactor * 0.2, 0, 1);
			const starBrightness = clamp(star.baseBrightness + brightness, 0, 1);
			const finalIntensity = clamp(headIntensity * starBrightness, 0, 1);
			const saturation = clamp((0.45 + twinkle * 0.45) * intensity * (0.6 + starBrightness * 0.4), 0, 1);
			const lightness = clamp((0.18 + projection.depth * 0.46 + twinkle * 0.14) * intensity * starBrightness, 0, 1);
			const color = stepToHex(star.huePhase + animState.tickCount * star.hueSpeed, saturation, lightness);

			renderStreaks(grid, brightnessMap, projection.x, projection.y, tunnelDirection, headIntensity, starBrightness, projection.depth, color, streaks);
			renderTrailShadow(grid, brightnessMap, projection.x, projection.y, tunnelDirection, headIntensity, starBrightness, projection.depth, color, trails);
			plotCell(grid, brightnessMap, projection.x, projection.y, finalIntensity, color, star.glyph);

			star.prevScreenX = projection.x;
			star.prevScreenY = projection.y;
		}

		return grid.map((row) => row.join("")).join("\n");
	};
}
