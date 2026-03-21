import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
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
	const cols = opts?.cols ?? 12;
	const rows = opts?.rows ?? 8;
	const mutationRate = opts?.mutationRate ?? 0.05;
	const speedMin = opts?.speedMin ?? 0.3;
	const speedMax = opts?.speedMax ?? 1.2;
	const trailLengthMin = opts?.trailLengthMin ?? 6;
	const trailLengthMax = opts?.trailLengthMax ?? 18;
	const glyphSetType = opts?.glyphSet ?? "katakana";
	const charDensity = opts?.charDensity ?? 1.0;
	const brightnessGradient = opts?.brightnessGradient ?? "top";
	const fadeMode = opts?.fadeMode ?? "gradient";

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
