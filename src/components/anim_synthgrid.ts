import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface SynthgridOptions {
	cols?: number;
	rows?: number;
	speed?: number;
	numVLines?: number;
	vanishingPointX?: number | "center";
	vanishingPointY?: number | "top" | "center";
	perspectiveFactor?: number;
	animateVanishingPoint?: boolean;
	animateSpeed?: number;
}

export function renderSynthgrid(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: SynthgridOptions,
): string {
	const cols = opts?.cols ?? 36;
	const rows = opts?.rows ?? 10;
	const speed = opts?.speed ?? 0.4;
	const numVLines = opts?.numVLines ?? 7;
	const vanishingPointX = opts?.vanishingPointX ?? "center";
	const vanishingPointY = opts?.vanishingPointY ?? "top";
	const perspectiveFactor = opts?.perspectiveFactor ?? 0.6;
	const animateVanishingPoint = opts?.animateVanishingPoint ?? false;
	const animateSpeed = opts?.animateSpeed ?? 0.02;
	const tick = animState.tickCount;

	let vpX: number;
	if (vanishingPointX === "center") {
		vpX = cols / 2;
	} else {
		vpX = vanishingPointX as number;
	}

	let vpY: number;
	if (vanishingPointY === "top") {
		vpY = 0;
	} else if (vanishingPointY === "center") {
		vpY = rows / 2;
	} else {
		vpY = vanishingPointY as number;
	}

	if (animateVanishingPoint) {
		vpX = vpX + Math.sin(tick * animateSpeed) * (cols * 0.1);
		vpY = vpY + Math.cos(tick * animateSpeed * 0.7) * (rows * 0.2);
	}

	const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(' '));
	const isHoriz: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));

	for (let y = 0; y < rows; y++) {
		const progress = rows <= 1 ? 1 : y / (rows - 1);
		const tColor = progress * 0.8 + 0.2;

		const spacing = Math.max(1, Math.round(8 - progress * 6));
		const phase = (tick * speed) % spacing;
		if (Math.round(y + phase) % spacing === 0) {
			for (let x = 0; x < cols; x++) {
				grid[y]![x] = style({ fg: lerpColor(theme.breathBaseColor, theme.breathPeakColor, tColor) })('─');
				isHoriz[y]![x] = true;
			}
		}

		for (let vi = 0; vi <= numVLines; vi++) {
			const edgeX = (vi / numVLines) * cols;
			const vxRel = edgeX - vpX;
			const vx = Math.round(vpX + vxRel * Math.pow(progress, perspectiveFactor));
			if (vx >= 0 && vx < cols) {
				const vColor = lerpColor(theme.breathBaseColor, theme.breathPeakColor, tColor * 0.85);
				grid[y]![vx] = style({ fg: vColor })(isHoriz[y]![vx] ? '┼' : '│');
			}
		}
	}

	return grid.map(r => r.join('')).join('\n');
}

export function renderSynthgridWide(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: SynthgridOptions,
): string {
	return renderSynthgrid(animState, theme, { ...opts, cols: 48, rows: 12, numVLines: 9 });
}
