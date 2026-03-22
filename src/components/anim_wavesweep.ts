import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { requireNumberOption, requireStringOption } from "./anim-option-helpers.js";
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
const MODULE_ID = "anim_wavesweep";

export function renderWaveSweep(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: WaveSweepOptions,
): string {
	const width = requireNumberOption(opts?.width, MODULE_ID, "width");
	const speed = requireNumberOption(opts?.speed, MODULE_ID, "speed");
	const sigma = requireNumberOption(opts?.sigma, MODULE_ID, "sigma");
	const phaseOffset = requireNumberOption(opts?.phaseOffset, MODULE_ID, "phaseOffset");
	const waveCount = requireNumberOption(opts?.waveCount, MODULE_ID, "waveCount");
	const interference = requireStringOption(opts?.interference, MODULE_ID, "interference");
	const damping = requireNumberOption(opts?.damping, MODULE_ID, "damping");

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
	const width = requireNumberOption(opts?.width, MODULE_ID, "width");
	const wave1 = renderWaveSweep(animState, theme, { ...opts, width, phaseOffset: 0 });
	const wave2 = renderWaveSweep(animState, theme, { ...opts, width, phaseOffset: Math.PI });
	return `${wave1}  ${wave2}`;
}
