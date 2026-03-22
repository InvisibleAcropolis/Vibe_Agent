import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { requireBooleanOption, requireNumberOption, requireStringOption } from "./anim-option-helpers.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface DataRainOptions {
	cols?: number;
	rows?: number;
	refreshEveryN?: number;
	glyphSet?: "default" | "hex" | "binary" | "katakana" | "symbols";
	columnSpeed?: number[];
	seeded?: boolean;
}

const ANIMATION_GLYPHS = '▐▓▒░█▄▀◆■•─╌═≡∽╣╗╝╔╩╦╠╬┼┤├┐└│⣾⣽⣻⢿⡿⣟⣯⣷÷×~+#@$%&*=';
const HEX_GLYPHS = '0123456789ABCDEF';
const BINARY_GLYPHS = '01';
const KATAKANA = Array.from({ length: 0xFF9D - 0xFF66 + 1 }, (_, i) => String.fromCodePoint(0xFF66 + i));
const SYMBOL_GLYPHS = '★☆◆◇○●◐◑◒◓◔◕';
const MODULE_ID = "anim_datarain";

function seededRand(seed: number) {
	return Math.abs(Math.sin(seed * 9301 + 49297) * 233280) % 1;
}

export function renderDataRain(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: DataRainOptions,
): string {
	const cols = requireNumberOption(opts?.cols, MODULE_ID, "cols");
	const rows = requireNumberOption(opts?.rows, MODULE_ID, "rows");
	const refreshEveryN = requireNumberOption(opts?.refreshEveryN, MODULE_ID, "refreshEveryN");
	const glyphSetType = requireStringOption(opts?.glyphSet, MODULE_ID, "glyphSet");
	const columnSpeed = opts?.columnSpeed;
	const seeded = requireBooleanOption(opts?.seeded, MODULE_ID, "seeded");

	let glyphSet: string;
	switch (glyphSetType) {
		case "hex": glyphSet = HEX_GLYPHS; break;
		case "binary": glyphSet = BINARY_GLYPHS; break;
		case "katakana": glyphSet = KATAKANA.join(''); break;
		case "symbols": glyphSet = SYMBOL_GLYPHS; break;
		default: glyphSet = ANIMATION_GLYPHS;
	}

	const { tickCount } = animState;

	const lines: string[] = [];
	for (let r = 0; r < rows; r++) {
		const t = rows <= 1 ? 1 : 1 - (r / (rows - 1)) * 0.82;
		const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, t);
		const styler = style({ fg: color });

		const cells: string[] = [];
		for (let c = 0; c < cols; c++) {
			const speed = columnSpeed?.[c] ?? 1;
			const seed = c * 997 + r * 31 + Math.floor(tickCount / refreshEveryN) * 7 * speed;
			let glyphIdx: number;
			if (seeded) {
				glyphIdx = Math.floor(seededRand(seed) * glyphSet.length);
			} else {
				glyphIdx = Math.floor(Math.random() * glyphSet.length);
			}
			const glyph = glyphSet[glyphIdx]!;
			cells.push(styler(glyph));
		}
		lines.push(cells.join(' '));
	}

	return lines.join('\n');
}

export function renderDataRainHex(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: DataRainOptions,
): string {
	return renderDataRain(animState, theme, { ...opts, glyphSet: "hex" });
}

export function renderDataRainBinary(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: DataRainOptions,
): string {
	return renderDataRain(animState, theme, { ...opts, glyphSet: "binary" });
}

export function renderDataRainKatakana(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: DataRainOptions,
): string {
	return renderDataRain(animState, theme, { ...opts, glyphSet: "katakana" });
}
