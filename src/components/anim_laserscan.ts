import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
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

export function createLaserScan(opts?: LaserScanOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const cols = opts?.cols ?? 28;
	const rows = opts?.rows ?? 6;
	const speed = opts?.speed ?? 0.5;
	const beamWidth = opts?.beamWidth ?? 5;
	const beamCount = opts?.beamCount ?? 1;
	const glyphSet = opts?.glyphSet ?? DEFAULT_GLYPHS;
	const beamStyle = opts?.beamStyle ?? "gaussian";
	const reverseScan = opts?.reverseScan ?? false;
	const reflectionPasses = opts?.reflectionPasses ?? 0;

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
