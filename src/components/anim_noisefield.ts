import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { requireBooleanOption, requireNumberOption, requireStringOption } from "./anim-option-helpers.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface NoiseFieldOptions {
	cols?: number;
	rows?: number;
	timeScale?: number;
	freqScale?: number;
	octaves?: number;
	octavePersistence?: number;
	palette?: "default" | "fire" | "ice" | "toxic";
	flowIntegration?: boolean;
}
const MODULE_ID = "anim_noisefield";

const PAL_DEFAULT = ['░', '▒', '▓', '█'] as const;
const PAL_FIRE = [' ', '.', ':', ';', '|', 'i', 't', 'S', '8', '#', '@'] as const;
const PAL_ICE = [' ', '·', ':', '≋', '▒', '▓', '█', '❄'] as const;
const PAL_TOXIC = ['░', '▒', '▓', '█', '◐', '◑', '◒', '◓'] as const;

function fbm(x: number, y: number, t: number, octaves: number, persistence: number): number {
	let value = 0;
	let amplitude = 1;
	let frequency = 1;
	let maxValue = 0;

	for (let i = 0; i < octaves; i++) {
		value += amplitude * (
			Math.sin(x * frequency * 0.7 + t) * Math.cos(y * frequency * 0.5 - t * 0.3) +
			Math.cos(x * frequency * 0.3 + t * 0.7) * Math.sin(y * frequency * 0.8 + t * 0.2) +
			Math.sin((x + y) * frequency * 0.4 + t * 0.5)
		) / 3;
		maxValue += amplitude;
		amplitude *= persistence;
		frequency *= 2;
	}

	return (value + maxValue) / (2 * maxValue);
}

export function renderNoiseField(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: NoiseFieldOptions,
): string {
	const cols = requireNumberOption(opts?.cols, MODULE_ID, "cols");
	const rows = requireNumberOption(opts?.rows, MODULE_ID, "rows");
	const timeScale = requireNumberOption(opts?.timeScale, MODULE_ID, "timeScale");
	const freqScale = requireNumberOption(opts?.freqScale, MODULE_ID, "freqScale");
	const octaves = requireNumberOption(opts?.octaves, MODULE_ID, "octaves");
	const octavePersistence = requireNumberOption(opts?.octavePersistence, MODULE_ID, "octavePersistence");
	const palette = requireStringOption(opts?.palette, MODULE_ID, "palette");
	const flowIntegration = requireBooleanOption(opts?.flowIntegration, MODULE_ID, "flowIntegration");

	let pal: readonly string[];
	switch (palette) {
		case "fire": pal = PAL_FIRE; break;
		case "ice": pal = PAL_ICE; break;
		case "toxic": pal = PAL_TOXIC; break;
		default: pal = PAL_DEFAULT;
	}

	const t = animState.tickCount * timeScale;

	const rowStrings: string[] = [];
	for (let y = 0; y < rows; y++) {
		let row = '';
		for (let x = 0; x < cols; x++) {
			const fx = x * freqScale;
			const fy = y * freqScale;

			let v: number;
			if (flowIntegration) {
				v = fbm(fx, fy, t, octaves, octavePersistence);
			} else {
				v = (
					Math.sin(fx * 0.7 + t) * Math.cos(fy * 0.5 - t * 0.3) +
					Math.cos(fx * 0.3 + t * 0.7) * Math.sin(fy * 0.8 + t * 0.2) +
					Math.sin((fx + fy) * 0.4 + t * 0.5)
				) / 3;
			}

			const normalized = (v + 1) / 2;
			const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, normalized);
			const charIdx = Math.min(pal.length - 1, Math.floor(normalized * pal.length));
			row += style({ fg: color })(pal[charIdx]!);
		}
		rowStrings.push(row);
	}
	return rowStrings.join('\n');
}
