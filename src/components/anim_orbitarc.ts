import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface OrbitArcOptions {
	trailLength?: number;
	label?: string;
	trailStyle?: "dots" | "line" | "dashed" | "gradient";
	speedMultiplier?: number;
	reverse?: boolean;
	orbitType?: "circular" | "elliptical" | "figure8";
}

const BRAILLE_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'] as const;
const DOT_TRAIL = ['●', '◉', '•', '∙', '·', ' '] as const;
const LINE_TRAIL = ['─', '╌', '═', '≡', '∽', '~'] as const;
const DASH_TRAIL = ['┄', '┅', '┆', '┇', '┈', '┉', '│', '┃'] as const;

export function renderOrbitArc(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: OrbitArcOptions,
): string {
	const trailLength = opts?.trailLength ?? 6;
	const label = opts?.label ?? '';
	const trailStyle = opts?.trailStyle ?? "dots";
	const speedMultiplier = opts?.speedMultiplier ?? 1.0;
	const reverse = opts?.reverse ?? false;
	const orbitType = opts?.orbitType ?? "circular";

	const frameIdx = reverse
		? (7 - (animState.spinnerFrame * speedMultiplier) % 8)
		: animState.spinnerFrame;
	const head = style({ fg: theme.breathPeakColor })(BRAILLE_FRAMES[frameIdx]!);

	let trail = '';
	const effectiveLength = Math.min(trailLength, DOT_TRAIL.length);

	for (let i = 0; i < trailLength; i++) {
		const t = 1 - (i + 1) / (trailLength + 1);

		let char: string;
		switch (trailStyle) {
			case "line":
				char = LINE_TRAIL[Math.min(i, LINE_TRAIL.length - 1)]!;
				break;
			case "dashed":
				char = i % 2 === 0 ? DASH_TRAIL[Math.min(i / 2, DASH_TRAIL.length - 1)]! : ' ';
				break;
			case "gradient":
				char = DOT_TRAIL[Math.min(i, DOT_TRAIL.length - 1)]!;
				break;
			default:
				char = DOT_TRAIL[Math.min(i, DOT_TRAIL.length - 1)]!;
		}

		const color = lerpColor('#1a3348', theme.breathBaseColor, t);
		trail += style({ fg: color })(char);
	}

	if (orbitType === "figure8") {
		const angle = (animState.tickCount * 0.05 * speedMultiplier) % (Math.PI * 2);
		const figure8X = Math.sin(angle * 2);
		const offset = Math.round(figure8X * 3);
		return ' '.repeat(Math.max(0, 3 + offset)) + head + trail + (label ? ' ' + label : '');
	} else if (orbitType === "elliptical") {
		const extra = ' '.repeat(Math.max(0, Math.round(trailLength / 2)));
		return extra + head + trail + (label ? ' ' + label : '');
	}

	return head + trail + (label ? ' ' + label : '');
}

export function renderOrbitArcMulti(
	animState: AnimationState,
	theme: ThemeConfig,
	count: number,
	opts?: OrbitArcOptions,
): string {
	const spacing = 4;
	let result = '';
	for (let i = 0; i < count; i++) {
		const offsetState = { ...animState, spinnerFrame: (animState.spinnerFrame + i * 2) % 8 };
		result += renderOrbitArc(offsetState, theme, opts) + ' '.repeat(spacing);
	}
	return result.trim();
}
