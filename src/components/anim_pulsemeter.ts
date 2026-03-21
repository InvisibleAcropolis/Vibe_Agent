import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface PulseMeterOptions {
	width?: number;
	label?: string;
	segments?: number;
	segmentMode?: "smooth" | "discrete" | "gradient";
	orientation?: "left" | "right" | "center";
	dualMode?: boolean;
	peakHold?: boolean;
	peakHoldTime?: number;
}

const FILL_CHARS_SMOOTH = ['░', '▒', '▓', '█'] as const;
const FILL_CHARS_DISCRETE = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '▊', '█'] as const;
const FILL_CHARS_BLOCK = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;
const DIM_COLOR = '#1a3348';

export function createPulseMeterTracker() {
	let peak = 0;
	let peakTimer = 0;
	return {
		update(value: number, peakHoldTime: number): number {
			if (value > peak) {
				peak = value;
				peakTimer = 0;
			} else {
				peakTimer++;
				if (peakTimer > peakHoldTime) {
					peak = Math.max(value, peak - 0.02);
				}
			}
			return peak;
		},
		reset() { peak = 0; peakTimer = 0; },
	};
}

export function renderPulseMeter(
	value: number,
	_animState: AnimationState,
	theme: ThemeConfig,
	opts?: PulseMeterOptions,
): string {
	const width = opts?.width ?? 24;
	const label = opts?.label ?? `${Math.round(value * 100)}%`;
	const segmentMode = opts?.segmentMode ?? "smooth";
	const orientation = opts?.orientation ?? "left";
	const dualMode = opts?.dualMode ?? false;
	const peakHold = opts?.peakHold ?? false;

	let fillChars: readonly string[];
	switch (segmentMode) {
		case "discrete":
			fillChars = FILL_CHARS_DISCRETE;
			break;
		case "gradient":
			fillChars = FILL_CHARS_BLOCK;
			break;
		default:
			fillChars = FILL_CHARS_SMOOTH;
	}

	const clamped = Math.max(0, Math.min(1, value));
	const filled = Math.round(clamped * width);
	const peakFilled = Math.round(clamped * width);

	let cells: string[] = [];
	for (let i = 0; i < width; i++) {
		let idx: number;
		if (orientation === "right") idx = width - 1 - i;
		else if (orientation === "center") idx = i < width / 2 ? width / 2 - 1 - i : i - width / 2;
		else idx = i;

		const isFilled = idx < filled;
		const isPeak = peakHold && idx < peakFilled;

		if (isFilled || isPeak) {
			const t = idx / width;
			const color = isPeak && idx >= filled
				? lerpColor(theme.breathPeakColor, '#ffffff', 0.3)
				: lerpColor(theme.breathBaseColor, theme.breathPeakColor, t);
			const segmentIdx = segmentMode === "discrete"
				? Math.min(fillChars.length - 1, Math.floor(t * fillChars.length))
				: Math.min(3, Math.floor(t * 4));
			const char = fillChars[segmentIdx]!;
			cells.push(style({ fg: color })(char));
		} else {
			cells.push(style({ fg: DIM_COLOR })('·'));
		}
	}

	if (dualMode) {
		const mirrored = [...cells].reverse();
		return `▐${cells.join('')}▌${label}▐${mirrored.join('')}▌`;
	}

	const prefix = orientation === "right" ? `${label} ▐` : `▐`;
	const suffix = orientation === "right" ? "▌" : "▌ ";
	const suffixWithLabel = orientation === "right" ? "▌" : ` ▌ ${label}`;

	return `${prefix}${cells.join('')}${filled >= width ? suffixWithLabel : suffix}`;
}

export function renderDualPulseMeter(
	leftValue: number,
	rightValue: number,
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: PulseMeterOptions,
): string {
	const width = opts?.width ?? 10;
	const meterA = renderPulseMeter(leftValue, animState, theme, { ...opts, width, dualMode: true, label: "" });
	const meterB = renderPulseMeter(rightValue, animState, theme, { ...opts, width, dualMode: true, label: "" });
	return `${meterA} ${meterB}`;
}
