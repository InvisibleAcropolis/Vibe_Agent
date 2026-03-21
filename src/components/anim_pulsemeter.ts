import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { defineStyleTestDemos } from "../style-test-contract.js";
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

export const styleTestDemos = defineStyleTestDemos({
	exports: {
		createPulseMeterTracker: {
			hidden: true,
		},
		renderPulseMeter: {
			title: "Pulse Meter",
			category: "Animations",
			kind: "animation",
			description: "Segment modes, orientations, and peak-hold tracking.",
			controls: [
				{ id: "width", label: "Width", type: "number", defaultValue: 24, min: 8, max: 40, step: 1 },
				{ id: "value", label: "Value", type: "number", defaultValue: 74, min: 0, max: 100, step: 1 },
				{ id: "segmentMode", label: "Segments", type: "enum", defaultValue: "gradient", options: ["smooth", "discrete", "gradient"] },
				{ id: "orientation", label: "Orientation", type: "enum", defaultValue: "left", options: ["left", "right", "center"] },
				{ id: "peakHold", label: "Peak Hold", type: "boolean", defaultValue: true },
			],
			createRuntime: (_moduleNamespace, _exportName, _exportValue, context, values) => {
				const tracker = createPulseMeterTracker();
				return {
					render() {
						return [
							renderPulseMeter(Number(values.value) / 100, context.getAnimationState(), context.getTheme(), {
								width: Number(values.width),
								segmentMode: String(values.segmentMode) as "smooth" | "discrete" | "gradient",
								orientation: String(values.orientation) as "left" | "right" | "center",
								peakHold: Boolean(values.peakHold),
							}),
							`Peak ${Math.round(tracker.update(Number(values.value) / 100, 24) * 100)}%`,
						];
					},
				};
			},
		},
		renderDualPulseMeter: {
			title: "Dual Pulse Meter",
			category: "Animations",
			kind: "animation",
			description: "Stereo pair using the enhanced pulse-meter renderer.",
			controls: [
				{ id: "leftValue", label: "Left", type: "number", defaultValue: 45, min: 0, max: 100, step: 1 },
				{ id: "rightValue", label: "Right", type: "number", defaultValue: 80, min: 0, max: 100, step: 1 },
				{ id: "width", label: "Width", type: "number", defaultValue: 10, min: 6, max: 20, step: 1 },
			],
			createRuntime: (_moduleNamespace, _exportName, _exportValue, context, values) => ({
				render() {
					return [
						renderDualPulseMeter(
							Number(values.leftValue) / 100,
							Number(values.rightValue) / 100,
							context.getAnimationState(),
							context.getTheme(),
							{ width: Number(values.width), segmentMode: "gradient" },
						),
					];
				},
			}),
		},
	},
});
