import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface WaveSweepOptions {
	width?: number;
	speed?: number;
	sigma?: number;
	phaseOffset?: number;
	waveCount?: number;
	interference?: "add" | "multiply" | "max";
	damping?: number;
}

const DIM_COLOR = '#1a3348';
const WAVE_CHARS = ['·', '∙', '•', '─', '╌', '═', '≡'] as const;

export function renderWaveSweep(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: WaveSweepOptions,
): string {
	const width = opts?.width ?? 24;
	const speed = opts?.speed ?? 0.5;
	const sigma = opts?.sigma ?? 5.0;
	const phaseOffset = opts?.phaseOffset ?? 0;
	const waveCount = opts?.waveCount ?? 1;
	const interference = opts?.interference ?? "add";
	const damping = opts?.damping ?? 0.3;

	const wavePos = (animState.tickCount * speed + phaseOffset) % width;

	const cells: number[] = new Array(width).fill(0);

	for (let w = 0; w < waveCount; w++) {
		const waveOffset = (w / waveCount) * Math.PI * 2;
		const waveSigma = sigma * (1 + w * damping);

		for (let i = 0; i < width; i++) {
			const dist = i - wavePos;
			const phase = dist * 0.3 + waveOffset;
			const gaussian = Math.exp(-Math.pow(dist, 2) / (2 * waveSigma * waveSigma));
			const sine = Math.sin(phase) * 0.3 + 0.7;

			let intensity: number;
			switch (interference) {
				case "multiply":
					intensity = cells[i] === 0 ? gaussian * sine : cells[i] * gaussian * sine;
					break;
				case "max":
					intensity = Math.max(cells[i], gaussian * sine);
					break;
				default:
					intensity = cells[i] + gaussian * sine;
			}
			cells[i] = Math.min(1, intensity);
		}
	}

	let result = '';
	for (let i = 0; i < width; i++) {
		const intensity = cells[i];
		if (intensity < 0.04) {
			result += style({ fg: DIM_COLOR })('·');
		} else {
			const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, intensity);
			const charIdx = Math.min(WAVE_CHARS.length - 1, Math.round(intensity * (WAVE_CHARS.length - 1)));
			const char = WAVE_CHARS[charIdx]!;
			result += style({ fg: color })(char);
		}
	}

	return result;
}

export function renderWaveSweepDual(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: WaveSweepOptions,
): string {
	const width = opts?.width ?? 12;
	const wave1 = renderWaveSweep(animState, theme, { ...opts, width, phaseOffset: 0 });
	const wave2 = renderWaveSweep(animState, theme, { ...opts, width, phaseOffset: Math.PI });
	return `${wave1}  ${wave2}`;
}
