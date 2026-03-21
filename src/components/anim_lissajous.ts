import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface LissajousOptions {
	cols?: number;
	rows?: number;
	a?: number;
	b?: number;
	deltaSpeed?: number;
	trailPoints?: number;
	decay?: number;
	threeDimensional?: boolean;
	phaseShift?: number;
	resonanceMode?: boolean;
	strokeWidth?: number;
}

const CHARS = ['·', '•', '●', '◉'] as const;

export function createLissajous(opts?: LissajousOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const cols = opts?.cols ?? 24;
	const rows = opts?.rows ?? 12;
	const a = opts?.a ?? 3;
	const b = opts?.b ?? 2;
	const deltaSpeed = opts?.deltaSpeed ?? 0.008;
	const trailPoints = opts?.trailPoints ?? 300;
	const decay = opts?.decay ?? 0.92;
	const threeDimensional = opts?.threeDimensional ?? false;
	const phaseShift = opts?.phaseShift ?? 0;
	const resonanceMode = opts?.resonanceMode ?? false;
	const strokeWidth = opts?.strokeWidth ?? 1;

	const A = cols / 2 - 1;
	const B = rows / 2 - 1;
	const cx = cols / 2;
	const cy = rows / 2;

	const density = new Float32Array(cols * rows);
	let delta = 0;

	const CHARS_SPARSE = ['·', '•'] as const;
	const CHARS_DENSE = ['·', '•', '●', '◉'] as const;

	return (_animState: AnimationState, theme: ThemeConfig): string => {
		delta += deltaSpeed;

		for (let i = 0; i < density.length; i++) {
			if (density[i]! > 0) density[i] = density[i]! * decay;
		}

		const effectiveA = resonanceMode && Math.sin(delta * a) > 0.9 ? a * 1.5 : a;
		const effectiveB = resonanceMode && Math.sin(delta * b) > 0.9 ? b * 1.5 : b;

		for (let i = 0; i < trailPoints; i++) {
			const param = (i / trailPoints) * Math.PI * 2;

			if (threeDimensional) {
				const z = Math.sin(param * 3 + delta) * 0.5 + 0.5;
				const px = cx + A * Math.sin(effectiveA * param + delta + phaseShift) * (0.5 + z * 0.5);
				const py = cy + B * Math.sin(effectiveB * param) * (0.5 + z * 0.5);

				for (let w = -strokeWidth; w <= strokeWidth; w++) {
					for (let h = -strokeWidth; h <= strokeWidth; h++) {
						const ix = Math.round(px) + w;
						const iy = Math.round(py) + h;
						if (ix >= 0 && ix < cols && iy >= 0 && iy < rows) {
							const dist = Math.sqrt(w * w + h * h);
							const contribution = Math.max(0, 1 - dist / strokeWidth);
							density[iy * cols + ix] = Math.min(1, density[iy * cols + ix]! + 0.15 * contribution);
						}
					}
				}
			} else {
				const px = cx + A * Math.sin(effectiveA * param + delta + phaseShift);
				const py = cy + B * Math.sin(effectiveB * param);

				for (let w = -strokeWidth; w <= strokeWidth; w++) {
					for (let h = -strokeWidth; h <= strokeWidth; h++) {
						const ix = Math.round(px) + w;
						const iy = Math.round(py) + h;
						if (ix >= 0 && ix < cols && iy >= 0 && iy < rows) {
							const dist = Math.sqrt(w * w + h * h);
							const contribution = Math.max(0, 1 - dist / strokeWidth);
							density[iy * cols + ix] = Math.min(1, density[iy * cols + ix]! + 0.15 * contribution);
						}
					}
				}
			}
		}

		const rowStrings: string[] = [];
		for (let y = 0; y < rows; y++) {
			let row = '';
			for (let x = 0; x < cols; x++) {
				const d = density[y * cols + x]!;
				if (d < 0.05) {
					row += ' ';
				} else {
					const charSet = d > 0.5 ? CHARS_DENSE : CHARS_SPARSE;
					const charIdx = Math.min(charSet.length - 1, Math.floor(d * charSet.length));
					const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, d);
					row += style({ fg: color })(charSet[charIdx]!);
				}
			}
			rowStrings.push(row);
		}
		return rowStrings.join('\n');
	};
}
