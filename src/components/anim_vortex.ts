import { hslToHex, style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface VortexOptions {
	cols?: number;
	rows?: number;
	count?: number;
	pullStrength?: number;
	trailLength?: number;
	spawnPattern?: "random" | "ring" | "spiral" | "burst";
	colorTrail?: boolean;
	magneticField?: boolean;
	size?: number;
	glyphSet?: "default" | "dense" | "stars" | "symbols" | "braille";
	glyphRandomize?: boolean;
	startHueStep?: number;
	endHueStep?: number;
	pulse?: boolean;
	hueRotateSpeed?: number;
}

export interface VortexResolvedOptions {
	cols: number;
	rows: number;
	count: number;
	pullStrength: number;
	trailLength: number;
	spawnPattern: "random" | "ring" | "spiral" | "burst";
	colorTrail: boolean;
	magneticField: boolean;
	size: number;
	glyphSet: "default" | "dense" | "stars" | "symbols" | "braille";
	glyphRandomize: boolean;
	startHueStep: number;
	endHueStep: number;
	pulse: boolean;
	hueRotateSpeed: number;
}

export interface VortexNumberOptionSpec {
	defaultValue: number;
	min: number;
	max: number;
	step: number;
	integer?: boolean;
}

export const VORTEX_NUMBER_OPTION_SPECS = Object.freeze({
	cols: { defaultValue: 24, min: 4, max: 120, step: 1, integer: true },
	rows: { defaultValue: 10, min: 4, max: 40, step: 1, integer: true },
	count: { defaultValue: 35, min: 1, max: 512, step: 1, integer: true },
	pullStrength: { defaultValue: 0.04, min: 0.005, max: 1, step: 0.005 },
	trailLength: { defaultValue: 3, min: 1, max: 64, step: 1, integer: true },
	size: { defaultValue: 1, min: 0.2, max: 1, step: 0.01 },
	startHueStep: { defaultValue: 148, min: 0, max: 256, step: 1, integer: true },
	endHueStep: { defaultValue: 132, min: 0, max: 256, step: 1, integer: true },
	hueRotateSpeed: { defaultValue: 1, min: 0, max: 8, step: 0.05 },
} satisfies Record<string, VortexNumberOptionSpec>);

export const VORTEX_DEFAULTS: Readonly<VortexResolvedOptions> = Object.freeze({
	cols: VORTEX_NUMBER_OPTION_SPECS.cols.defaultValue,
	rows: VORTEX_NUMBER_OPTION_SPECS.rows.defaultValue,
	count: VORTEX_NUMBER_OPTION_SPECS.count.defaultValue,
	pullStrength: VORTEX_NUMBER_OPTION_SPECS.pullStrength.defaultValue,
	trailLength: VORTEX_NUMBER_OPTION_SPECS.trailLength.defaultValue,
	spawnPattern: "random",
	colorTrail: true,
	magneticField: false,
	size: VORTEX_NUMBER_OPTION_SPECS.size.defaultValue,
	glyphSet: "default",
	glyphRandomize: false,
	startHueStep: VORTEX_NUMBER_OPTION_SPECS.startHueStep.defaultValue,
	endHueStep: VORTEX_NUMBER_OPTION_SPECS.endHueStep.defaultValue,
	pulse: false,
	hueRotateSpeed: VORTEX_NUMBER_OPTION_SPECS.hueRotateSpeed.defaultValue,
});

const DEFAULT_GLYPHS = ["✦", "◉", "•", "∙", "·"] as const;
const DENSE_GLYPHS = Array.from(" .:;irsXA253hMHGS#9B&@");
const STAR_GLYPHS = ["·", "✦", "★", "◆", "◇", "✧", "◈"] as const;
const SYMBOL_GLYPHS = ["·", "•", "●", "◉", "○", "◌", "◍", "◎"] as const;
const BRAILLE_GLYPHS = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"] as const;
const VORTEX_SATURATION = 0.82;
const VORTEX_LIGHTNESS = 0.46;

interface Particle {
	angle: number;
	radius: number;
	angularSpeed: number;
	trail: Array<{ x: number; y: number; intensity: number }>;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function wrapStep(value: number): number {
	const wrapped = value % 256;
	return wrapped < 0 ? wrapped + 256 : wrapped;
}

function normalizeNumberOption(value: number | undefined, spec: VortexNumberOptionSpec): number {
	const numeric = typeof value === "number" && Number.isFinite(value) ? value : spec.defaultValue;
	const normalized = spec.integer ? Math.round(numeric) : numeric;
	return clamp(normalized, spec.min, spec.max);
}

function normalizeBooleanOption(value: boolean | undefined, defaultValue: boolean): boolean {
	return typeof value === "boolean" ? value : defaultValue;
}

function normalizeSpawnPattern(value: VortexOptions["spawnPattern"] | undefined): VortexResolvedOptions["spawnPattern"] {
	return value === "ring" || value === "spiral" || value === "burst" ? value : VORTEX_DEFAULTS.spawnPattern;
}

function normalizeGlyphSet(value: VortexOptions["glyphSet"] | undefined): VortexResolvedOptions["glyphSet"] {
	return value === "dense" || value === "stars" || value === "symbols" || value === "braille" ? value : VORTEX_DEFAULTS.glyphSet;
}

function isValidNumberOption(value: unknown, spec: VortexNumberOptionSpec): value is number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return false;
	}
	if (value < spec.min || value > spec.max) {
		return false;
	}
	return !spec.integer || Number.isInteger(value);
}

function stepToHex(step: number): string {
	return hslToHex((wrapStep(step) / 256) * 360, VORTEX_SATURATION, VORTEX_LIGHTNESS);
}

function getGlyphSet(glyphSet: VortexResolvedOptions["glyphSet"]): readonly string[] {
	switch (glyphSet) {
		case "dense":
			return DENSE_GLYPHS;
		case "stars":
			return STAR_GLYPHS;
		case "symbols":
			return SYMBOL_GLYPHS;
		case "braille":
			return BRAILLE_GLYPHS;
		default:
			return DEFAULT_GLYPHS;
	}
}

function resolveGlyph(glyphs: readonly string[], intensity: number, randomize: boolean): string {
	if (glyphs.length === 0) {
		return "·";
	}
	if (randomize) {
		return glyphs[Math.floor(Math.random() * glyphs.length)] ?? glyphs[glyphs.length - 1] ?? "·";
	}
	const index = Math.min(glyphs.length - 1, Math.floor(clamp(intensity, 0, 1) * glyphs.length));
	return glyphs[index] ?? glyphs[glyphs.length - 1] ?? "·";
}

export function normalizeVortexOptions(opts?: VortexOptions): VortexResolvedOptions {
	return {
		cols: normalizeNumberOption(opts?.cols, VORTEX_NUMBER_OPTION_SPECS.cols),
		rows: normalizeNumberOption(opts?.rows, VORTEX_NUMBER_OPTION_SPECS.rows),
		count: normalizeNumberOption(opts?.count, VORTEX_NUMBER_OPTION_SPECS.count),
		pullStrength: normalizeNumberOption(opts?.pullStrength, VORTEX_NUMBER_OPTION_SPECS.pullStrength),
		trailLength: normalizeNumberOption(opts?.trailLength, VORTEX_NUMBER_OPTION_SPECS.trailLength),
		spawnPattern: normalizeSpawnPattern(opts?.spawnPattern),
		colorTrail: normalizeBooleanOption(opts?.colorTrail, VORTEX_DEFAULTS.colorTrail),
		magneticField: normalizeBooleanOption(opts?.magneticField, VORTEX_DEFAULTS.magneticField),
		size: normalizeNumberOption(opts?.size, VORTEX_NUMBER_OPTION_SPECS.size),
		glyphSet: normalizeGlyphSet(opts?.glyphSet),
		glyphRandomize: normalizeBooleanOption(opts?.glyphRandomize, VORTEX_DEFAULTS.glyphRandomize),
		startHueStep: normalizeNumberOption(opts?.startHueStep, VORTEX_NUMBER_OPTION_SPECS.startHueStep),
		endHueStep: normalizeNumberOption(opts?.endHueStep, VORTEX_NUMBER_OPTION_SPECS.endHueStep),
		pulse: normalizeBooleanOption(opts?.pulse, VORTEX_DEFAULTS.pulse),
		hueRotateSpeed: normalizeNumberOption(opts?.hueRotateSpeed, VORTEX_NUMBER_OPTION_SPECS.hueRotateSpeed),
	};
}

export function isVortexOptionsPresetValid(opts: unknown): opts is VortexResolvedOptions {
	if (typeof opts !== "object" || opts === null) {
		return false;
	}
	const candidate = opts as VortexOptions;
	return (
		isValidNumberOption(candidate.cols, VORTEX_NUMBER_OPTION_SPECS.cols) &&
		isValidNumberOption(candidate.rows, VORTEX_NUMBER_OPTION_SPECS.rows) &&
		isValidNumberOption(candidate.count, VORTEX_NUMBER_OPTION_SPECS.count) &&
		isValidNumberOption(candidate.pullStrength, VORTEX_NUMBER_OPTION_SPECS.pullStrength) &&
		isValidNumberOption(candidate.trailLength, VORTEX_NUMBER_OPTION_SPECS.trailLength) &&
		(candidate.spawnPattern === "random" || candidate.spawnPattern === "ring" || candidate.spawnPattern === "spiral" || candidate.spawnPattern === "burst") &&
		typeof candidate.colorTrail === "boolean" &&
		typeof candidate.magneticField === "boolean" &&
		isValidNumberOption(candidate.size, VORTEX_NUMBER_OPTION_SPECS.size) &&
		(candidate.glyphSet === "default" || candidate.glyphSet === "dense" || candidate.glyphSet === "stars" || candidate.glyphSet === "symbols" || candidate.glyphSet === "braille") &&
		typeof candidate.glyphRandomize === "boolean" &&
		isValidNumberOption(candidate.startHueStep, VORTEX_NUMBER_OPTION_SPECS.startHueStep) &&
		isValidNumberOption(candidate.endHueStep, VORTEX_NUMBER_OPTION_SPECS.endHueStep) &&
		typeof candidate.pulse === "boolean" &&
		isValidNumberOption(candidate.hueRotateSpeed, VORTEX_NUMBER_OPTION_SPECS.hueRotateSpeed)
	);
}

function spawnParticle(vortexRadius: number, pattern: VortexResolvedOptions["spawnPattern"]): Particle {
	switch (pattern) {
		case "ring":
			return {
				angle: Math.random() * Math.PI * 2,
				radius: vortexRadius * (0.8 + Math.random() * 0.2),
				angularSpeed: 0.03 + Math.random() * 0.05,
				trail: [],
			};
		case "spiral":
			return {
				angle: Math.random() * Math.PI * 2,
				radius: vortexRadius,
				angularSpeed: 0.05 + Math.random() * 0.03,
				trail: [],
			};
		case "burst":
			return {
				angle: Math.random() * Math.PI * 2,
				radius: vortexRadius * 0.5,
				angularSpeed: 0.08 + Math.random() * 0.04,
				trail: [],
			};
		default:
			return {
				angle: Math.random() * Math.PI * 2,
				radius: vortexRadius * (0.7 + Math.random() * 0.3),
				angularSpeed: 0.03 + Math.random() * 0.05,
				trail: [],
			};
	}
}

export function createVortex(opts?: VortexOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const {
		cols,
		rows,
		count,
		pullStrength,
		trailLength,
		spawnPattern,
		colorTrail,
		magneticField,
		size,
		glyphSet,
		glyphRandomize,
		startHueStep,
		endHueStep,
		pulse,
		hueRotateSpeed,
	} = normalizeVortexOptions(opts);

	const arenaRadius = Math.min(cols, rows * 2) / 2;
	const vortexRadius = arenaRadius * size;
	const glyphs = getGlyphSet(glyphSet);
	const particles: Particle[] = Array.from({ length: count }, () => spawnParticle(vortexRadius, spawnPattern));

	return (animState: AnimationState, _theme: ThemeConfig): string => {
		const cx = cols / 2;
		const cy = rows / 2;
		const hueOffset = pulse ? animState.tickCount * hueRotateSpeed : 0;
		const startHex = stepToHex(startHueStep + hueOffset);
		const endHex = stepToHex(endHueStep + hueOffset);

		const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(" "));
		const brightness: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

		for (const p of particles) {
			let angularVel = p.angularSpeed * (vortexRadius / Math.max(p.radius, 0.5));

			if (magneticField) {
				angularVel += Math.sin(p.angle * 3) * 0.02;
			}

			p.angle += angularVel;
			p.radius -= pullStrength;

			if (p.radius <= 0.3) {
				Object.assign(p, spawnParticle(vortexRadius, spawnPattern));
				continue;
			}

			const x = p.radius * Math.cos(p.angle);
			const y = p.radius * Math.sin(p.angle) * 0.5;
			const t = 1 - p.radius / Math.max(vortexRadius, 0.001);
			p.trail.push({ x, y, intensity: t });
			if (p.trail.length > trailLength) {
				p.trail.shift();
			}

			const px = Math.floor(cx + x);
			const py = Math.floor(cy + y);
			if (px < 0 || px >= cols || py < 0 || py >= rows) {
				continue;
			}

			if (colorTrail) {
				for (let i = 0; i < p.trail.length; i++) {
					const tp = p.trail[i]!;
					const tx = Math.floor(cx + tp.x);
					const ty = Math.floor(cy + tp.y);
					if (tx < 0 || tx >= cols || ty < 0 || ty >= rows) {
						continue;
					}
					const trailT = ((i + 1) / p.trail.length) * tp.intensity;
					if (trailT > brightness[ty]![tx]!) {
						brightness[ty]![tx] = trailT;
						const trailColor = lerpColor(startHex, endHex, trailT);
						const trailGlyph = resolveGlyph(glyphs, trailT, glyphRandomize);
						grid[ty]![tx] = style({ fg: trailColor })(trailGlyph);
					}
				}
			}

			if (t > brightness[py]![px]!) {
				brightness[py]![px] = t;
				const glyph = resolveGlyph(glyphs, t, glyphRandomize);
				const color = lerpColor(startHex, endHex, t);
				grid[py]![px] = style({ fg: color })(glyph);
			}
		}

		return grid.map((row) => row.join("")).join("\n");
	};
}
