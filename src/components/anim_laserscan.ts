import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { requireBooleanOption, requireNumberOption, requireStringOption } from "./anim-option-helpers.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface LaserScanOptions {
	cols?: number;
	rows?: number;
	speed?: number;
	beamWidth?: number;
	beamCount?: number;
	glyphSet?: string;
	beamStyle?: "gaussian" | "sharp" | "sine";
	reverseScan?: boolean;
	reflectionPasses?: number;
}

const DEFAULT_GLYPHS = '▐▓▒░█▄▀◆■•─╌═≡∽╣╗╝╔╩╦╠╬┼┤├┐└│⣾⣽⣻⢿⡿⣟⣯⣷÷×~+#@$%&*=';
const MODULE_ID = "anim_laserscan";

export function createLaserScan(opts?: LaserScanOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const cols = requireNumberOption(opts?.cols, MODULE_ID, "cols");
	const rows = requireNumberOption(opts?.rows, MODULE_ID, "rows");
	const speed = requireNumberOption(opts?.speed, MODULE_ID, "speed");
	const beamWidth = requireNumberOption(opts?.beamWidth, MODULE_ID, "beamWidth");
	const beamCount = requireNumberOption(opts?.beamCount, MODULE_ID, "beamCount");
	const glyphSet = opts?.glyphSet ?? DEFAULT_GLYPHS;
	const beamStyle = requireStringOption(opts?.beamStyle, MODULE_ID, "beamStyle");
	const reverseScan = requireBooleanOption(opts?.reverseScan, MODULE_ID, "reverseScan");
	const reflectionPasses = requireNumberOption(opts?.reflectionPasses, MODULE_ID, "reflectionPasses");

	const data: string[][] = Array.from({ length: rows }, () =>
		Array.from({ length: cols }, () => glyphSet[Math.floor(Math.random() * glyphSet.length)]!)
	);

	let beamPositions: number[] = Array.from({ length: beamCount }, (_, i) => i * (cols / beamCount));
	let lastBeamCols: number[] = new Array(beamCount).fill(-1);

	return (_animState: AnimationState, theme: ThemeConfig): string => {
		for (let b = 0; b < beamCount; b++) {
			const direction = reverseScan ? -1 : 1;
			beamPositions[b] = (beamPositions[b]! + speed * direction + cols + beamWidth * 2) % (cols + beamWidth * 2);

			const currentCol = Math.floor(beamPositions[b]! - beamWidth);
			if (currentCol !== lastBeamCols[b]! && currentCol >= 0 && currentCol < cols) {
				for (let y = 0; y < rows; y++) {
					data[y]![currentCol] = glyphSet[Math.floor(Math.random() * glyphSet.length)]!;
				}
				lastBeamCols[b] = currentCol;
			}
		}

		const rowStrings: string[] = [];
		for (let y = 0; y < rows; y++) {
			let row = '';
			for (let x = 0; x < cols; x++) {
				const glyph = data[y]![x]!;

				let maxIntensity = 0;
				for (let b = 0; b < beamCount; b++) {
					const beamCenter = beamPositions[b]! - beamWidth;
					const dist = x - beamCenter;

					let intensity = 0;
					switch (beamStyle) {
						case "sharp":
							intensity = Math.abs(dist) < 1 ? 1 : 0;
							break;
						case "sine":
							intensity = Math.abs(dist) < beamWidth ? Math.cos(dist / beamWidth * Math.PI / 2) : 0;
							break;
						default:
							intensity = Math.exp(-(dist * dist) / (2 * beamWidth * beamWidth));
					}
					maxIntensity = Math.max(maxIntensity, intensity);
				}

				if (maxIntensity < 0.04) {
					row += style({ fg: '#1a3348' })(glyph);
				} else {
					const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, maxIntensity);
					row += style({ fg: color })(glyph);
				}
			}
			rowStrings.push(row);
		}

		if (reflectionPasses > 0) {
			for (let pass = 0; pass < reflectionPasses; pass++) {
				for (let y = 0; y < rows; y++) {
					for (let x = 0; x < cols; x++) {
						if (data[y]![x] !== ' ' && Math.random() < 0.1) {
							const newY = (y + 1) % rows;
							const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, 0.3);
							rowStrings[newY] = rowStrings[newY]!.substring(0, x) +
								style({ fg: color })('·') +
								rowStrings[newY]!.substring(x + 1);
						}
					}
				}
			}
		}

		return rowStrings.join('\n');
	};
}
