import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { requireNumberOption, requireStringOption } from "./anim-option-helpers.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface MatrixRainOptions {
	cols?: number;
	rows?: number;
	mutationRate?: number;
	speedMin?: number;
	speedMax?: number;
	trailLengthMin?: number;
	trailLengthMax?: number;
	glyphSet?: "katakana" | "hex" | "binary" | "mixed" | "fullwidth";
	charDensity?: number;
	brightnessGradient?: "top" | "bottom" | "center";
	fadeMode?: "solid" | "gradient" | "sharp";
}

const KATAKANA = Array.from({ length: 0xFF9D - 0xFF66 + 1 }, (_, i) => String.fromCodePoint(0xFF66 + i));
const HEX_CHARS = '0123456789ABCDEF';
const BINARY_CHARS = '01';
const FULLWIDTH = Array.from({ length: 0x30 - 0x21 + 1 }, (_, i) => String.fromCodePoint(0x21 + i));

interface Column {
	headY: number;
	speed: number;
	trailLength: number;
	tickAcc: number;
	active: boolean;
	restartDelay: number;
	glyphSet: string;
}
const MODULE_ID = "anim_matrixrain";

function createGlyphSet(type: string): string {
	switch (type) {
		case "hex": return HEX_CHARS;
		case "binary": return BINARY_CHARS;
		case "fullwidth": return FULLWIDTH.join('');
		case "mixed": return [...KATAKANA, ...HEX_CHARS.split('')].join('');
		default: return KATAKANA.join('');
	}
}

function randGlyph(glyphSet: string): string {
	return glyphSet[Math.floor(Math.random() * glyphSet.length)]!;
}

export function createMatrixRain(opts?: MatrixRainOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const cols = requireNumberOption(opts?.cols, MODULE_ID, "cols");
	const rows = requireNumberOption(opts?.rows, MODULE_ID, "rows");
	const mutationRate = requireNumberOption(opts?.mutationRate, MODULE_ID, "mutationRate");
	const speedMin = requireNumberOption(opts?.speedMin, MODULE_ID, "speedMin");
	const speedMax = requireNumberOption(opts?.speedMax, MODULE_ID, "speedMax");
	const trailLengthMin = requireNumberOption(opts?.trailLengthMin, MODULE_ID, "trailLengthMin");
	const trailLengthMax = requireNumberOption(opts?.trailLengthMax, MODULE_ID, "trailLengthMax");
	const glyphSetType = requireStringOption(opts?.glyphSet, MODULE_ID, "glyphSet");
	const charDensity = requireNumberOption(opts?.charDensity, MODULE_ID, "charDensity");
	const brightnessGradient = requireStringOption(opts?.brightnessGradient, MODULE_ID, "brightnessGradient");
	const fadeMode = requireStringOption(opts?.fadeMode, MODULE_ID, "fadeMode");

	const glyphSet = createGlyphSet(glyphSetType);

	const glyphs: string[][] = Array.from({ length: rows }, () =>
		Array.from({ length: cols }, () => randGlyph(glyphSet))
	);

	function spawnCol(): Column {
		return {
			headY: -Math.floor(Math.random() * rows),
			speed: speedMin + Math.random() * (speedMax - speedMin),
			trailLength: trailLengthMin + Math.floor(Math.random() * (trailLengthMax - trailLengthMin)),
			tickAcc: 0,
			active: true,
			restartDelay: 20 + Math.floor(Math.random() * 60),
			glyphSet,
		};
	}

	const columns: Column[] = Array.from({ length: cols }, spawnCol);

	return (_animState: AnimationState, theme: ThemeConfig): string => {
		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < cols; c++) {
				if (Math.random() < mutationRate) {
					glyphs[r]![c] = randGlyph(glyphSet);
				}
			}
		}

		for (const col of columns) {
			if (!col.active) {
				col.restartDelay--;
				if (col.restartDelay <= 0) Object.assign(col, spawnCol());
				continue;
			}
			col.tickAcc += col.speed;
			while (col.tickAcc >= 1) { col.headY++; col.tickAcc--; }
			if (col.headY >= rows + col.trailLength) {
				col.active = false;
				col.restartDelay = 20 + Math.floor(Math.random() * 60);
			}
		}

		const rowStrings: string[] = [];
		for (let y = 0; y < rows; y++) {
			let row = '';
			for (let x = 0; x < cols; x++) {
				if (Math.random() > charDensity) {
					row += style({ fg: '#1a3348' })(' ');
					continue;
				}

				const col = columns[x]!;
				const glyph = glyphs[y]![x]!;

				if (!col.active) {
					row += style({ fg: '#1a3348' })(glyph);
					continue;
				}

				const dist = col.headY - y;

				if (dist < 0) {
					row += style({ fg: '#1a3348' })(glyph);
				} else if (dist === 0) {
					row += style({ fg: theme.breathPeakColor })(glyph);
				} else if (dist < col.trailLength) {
					let t: number;
					switch (fadeMode) {
						case "sharp":
							t = dist < col.trailLength * 0.3 ? 1 : 0.2;
							break;
						case "gradient":
						default:
							t = 1 - dist / col.trailLength;
							break;
					}

					let brightness: number;
					switch (brightnessGradient) {
						case "bottom":
							brightness = t * (1 - y / rows * 0.5);
							break;
						case "center":
							brightness = t * (1 - Math.abs(y - rows / 2) / (rows / 2) * 0.5);
							break;
						default:
							brightness = t * (0.5 + y / rows * 0.5);
					}

					const color = lerpColor('#1a3348', theme.breathBaseColor, brightness);
					row += style({ fg: color })(glyph);
				} else {
					row += style({ fg: '#1a3348' })(glyph);
				}
			}
			rowStrings.push(row);
		}
		return rowStrings.join('\n');
	};
}
