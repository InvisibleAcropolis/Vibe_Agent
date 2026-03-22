import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { requireBooleanOption, requireNumberOption, requireStringOption } from "./anim-option-helpers.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface GlyphCascadeOptions {
	maxCount?: number;
	historyRows?: number;
	ticksPerStep?: number;
	glyphSet?: string;
	direction?: "up" | "down" | "alternate";
	multiRow?: boolean;
	rowHeight?: number;
	colorShift?: number;
	seeded?: boolean;
}

const DEFAULT_GLYPHS = '▐▓▒░█▄▀◆■•─╌═≡∽╣╗╝╔╩╦╠╬┼┤├┐└│⣾⣽⣻⢿⡿⣟⣯⣷÷×~+#@$%&*=';
const HEX_GLYPHS = '0123456789ABCDEF';
const BINARY_GLYPHS = '01';
const SYMBOL_GLYPHS = '★☆◆◇○●◐◑◒◓◔◕◖◗◘◙◚◛◜◝◞◟◠◡◢◣◤◥◦◧◨◩◪◫◬◭◮◯';
const BLOCK_GLYPHS = ' ▁▂▃▄▅▆▇█';
const MODULE_ID = "anim_glyphcascade";

function seededRandom(seed: number): number {
	return Math.abs(Math.sin(seed * 9301 + 49297) * 233280) % 1;
}

export function createGlyphCascade(opts?: GlyphCascadeOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const maxCount = requireNumberOption(opts?.maxCount, MODULE_ID, "maxCount");
	const historyRows = requireNumberOption(opts?.historyRows, MODULE_ID, "historyRows");
	const ticksPerStep = requireNumberOption(opts?.ticksPerStep, MODULE_ID, "ticksPerStep");
	const glyphSet = opts?.glyphSet ?? DEFAULT_GLYPHS;
	const direction = requireStringOption(opts?.direction, MODULE_ID, "direction");
	const multiRow = requireBooleanOption(opts?.multiRow, MODULE_ID, "multiRow");
	const rowHeight = requireNumberOption(opts?.rowHeight, MODULE_ID, "rowHeight");
	const colorShift = requireNumberOption(opts?.colorShift, MODULE_ID, "colorShift");
	const seeded = requireBooleanOption(opts?.seeded, MODULE_ID, "seeded");

	let count = 1;
	let dir: 1 | -1 = 1;
	let actualDir: "up" | "down" = "up";
	const history: string[] = [];
	let lastTick = -1;

	return (animState: AnimationState, theme: ThemeConfig): string => {
		const { tickCount } = animState;

		if (tickCount !== lastTick && tickCount % ticksPerStep === 0) {
			let row = "";

			if (multiRow) {
				for (let r = 0; r < rowHeight; r++) {
					let rowStr = "";
					const rowCount = Math.max(1, count - r);
					for (let i = 0; i < rowCount; i++) {
						const t = rowCount <= 1 ? 0.5 : i / (rowCount - 1);
						const shiftedT = (t + colorShift) % 1;
						const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, shiftedT);
						let glyph: string;
						if (seeded) {
							const seed = i * 997 + r * 31 + tickCount * 7;
							const glyphIdx = Math.floor(seededRandom(seed) * glyphSet.length);
							glyph = glyphSet[glyphIdx]!;
						} else {
							glyph = glyphSet[Math.floor(Math.random() * glyphSet.length)]!;
						}
						rowStr += style({ fg: color })(glyph);
					}
					history.push(rowStr);
				}
			} else {
				for (let i = 0; i < count; i++) {
					const t = count <= 1 ? 0.5 : i / (count - 1);
					const shiftedT = (t + colorShift) % 1;
					const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, shiftedT);
					let glyph: string;
					if (seeded) {
						const seed = i * 997 + tickCount * 7;
						const glyphIdx = Math.floor(seededRandom(seed) * glyphSet.length);
						glyph = glyphSet[glyphIdx]!;
					} else {
						glyph = glyphSet[Math.floor(Math.random() * glyphSet.length)]!;
					}
					row += style({ fg: color })(glyph);
				}
				history.push(row);
			}

			if (history.length > historyRows) history.shift();

			if (direction === "alternate") {
				count += dir;
				if (count >= maxCount) {
					dir = -1;
					actualDir = "down";
				} else if (count <= 0) {
					dir = 1;
					count = 1;
					actualDir = "up";
				}
			} else if (direction === "up") {
				count = Math.min(count + 1, maxCount);
				if (count >= maxCount) count = 1;
			} else {
				count = Math.max(count - 1, 1);
				if (count <= 1) count = maxCount;
			}

			lastTick = tickCount;
		}

		return history.join("\n");
	};
}

export function renderGlyphCascadeDemo(theme: ThemeConfig, animState: AnimationState): string {
	const demo = createGlyphCascade({
		maxCount: 12,
		historyRows: 8,
		glyphSet: SYMBOL_GLYPHS,
		multiRow: true,
		rowHeight: 2,
		seeded: true,
	});
	return demo(animState, theme);
}
