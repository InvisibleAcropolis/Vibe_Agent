import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface SpectrumBarsOptions {
	cols?: number;
	rows?: number;
	speed?: number;
	decay?: number;
	peakHold?: boolean;
	peakDecay?: number;
	smoothing?: number;
	barGap?: number;
}

const EIGHTHS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;
const DIM = '#1a3348';

interface BarTracker {
	phase: number;
	value: number;
	peak: number;
}

export function createSpectrumBars(opts?: SpectrumBarsOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const cols = opts?.cols ?? 12;
	const rows = opts?.rows ?? 6;
	const speed = opts?.speed ?? 1.0;
	const decay = opts?.decay ?? 0.92;
	const peakHold = opts?.peakHold ?? true;
	const peakDecay = opts?.peakDecay ?? 0.98;
	const smoothing = opts?.smoothing ?? 0.3;
	const barGap = opts?.barGap ?? 0;

	const trackers: BarTracker[] = Array.from({ length: cols }, (_, i) => ({
		phase: i * 0.4,
		value: 0,
		peak: 0,
	}));

	return (_animState: AnimationState, theme: ThemeConfig): string => {
		const vals: number[] = [];

		for (let i = 0; i < cols; i++) {
			const tracker = trackers[i]!;
			tracker.phase += (0.06 + i * 0.004) * speed;

			const raw = (Math.sin(tracker.phase) * 0.5 + 0.5) * 0.9 + 0.05;
			tracker.value = tracker.value * (1 - smoothing) + raw * smoothing;

			if (peakHold) {
				if (tracker.value > tracker.peak) {
					tracker.peak = tracker.value;
				} else {
					tracker.peak *= peakDecay;
				}
			}

			vals.push(tracker.value);
		}

		const grid: string[][] = Array.from({ length: rows }, () => new Array(cols + barGap * (cols - 1)).fill(''));

		for (let x = 0; x < cols; x++) {
			const v = vals[x]!;
			const peakV = trackers[x]!.peak;
			const filledCells = v * rows;
			const fullRows = Math.floor(filledCells);
			const frac = filledCells - fullRows;

			const gridX = x + barGap * x;

			for (let y = 0; y < rows; y++) {
				const fromBottom = rows - 1 - y;
				const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, v);

				if (fromBottom < fullRows) {
					grid[y]![gridX] = style({ fg: color })('█');
				} else if (fromBottom === fullRows && frac > 0.05) {
					const eighthIdx = Math.round(frac * 8);
					grid[y]![gridX] = style({ fg: color })(EIGHTHS[eighthIdx]!);
				} else if (peakHold && fromBottom < Math.floor(peakV * rows) && fromBottom >= fullRows) {
					grid[y]![gridX] = style({ fg: lerpColor(theme.breathPeakColor, '#ffffff', 0.3) })('▔');
				} else {
					grid[y]![gridX] = style({ fg: DIM })('·');
				}
			}

			if (barGap > 0 && x < cols - 1) {
				for (let y = 0; y < rows; y++) {
					grid[y]![gridX + 1] = '';
				}
			}
		}

		return grid.map(r => r.join('')).join('\n');
	};
}

export function renderSpectrumBarsStereo(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: SpectrumBarsOptions,
): string {
	const cols = opts?.cols ?? 6;
	const renderer = createSpectrumBars({ ...opts, cols });
	const left = renderer(animState, theme);
	const right = renderer(animState, theme);
	return `${left}\n${right}`;
}
