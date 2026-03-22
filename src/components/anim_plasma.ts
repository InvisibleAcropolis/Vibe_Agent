import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { requireBooleanOption, requireNumberOption, requireStringOption } from "./anim-option-helpers.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface PlasmaOptions {
	width?: number;
	height?: number;
	freq?: number;
	timeScale?: number;
	colorCycle?: boolean;
	palette?: "default" | "fire" | "ocean" | "toxic";
	freqModulation?: number;
}

const PAL_DEFAULT = ['░', '▒', '▓', '█'] as const;
const PAL_FIRE = [' ', '.', ':', ';', '|', 'i', 't', 'S', '8', '#', '@'] as const;
const PAL_OCEAN = [' ', '·', ':', '=', '≡', '▒', '▓', '█'] as const;
const PAL_TOXIC = ['░', '▒', '▓', '█', '◐', '◑', '◒', '◓'] as const;
const MODULE_ID = "anim_plasma";

export function renderPlasma(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: PlasmaOptions,
): string {
	const width = requireNumberOption(opts?.width, MODULE_ID, "width");
	const height = requireNumberOption(opts?.height, MODULE_ID, "height");
	const freq = requireNumberOption(opts?.freq, MODULE_ID, "freq");
	const timeScale = requireNumberOption(opts?.timeScale, MODULE_ID, "timeScale");
	const colorCycle = requireBooleanOption(opts?.colorCycle, MODULE_ID, "colorCycle");
	const palette = requireStringOption(opts?.palette, MODULE_ID, "palette");
	const freqModulation = requireNumberOption(opts?.freqModulation, MODULE_ID, "freqModulation");

	let pal: readonly string[];
	switch (palette) {
		case "fire": pal = PAL_FIRE; break;
		case "ocean": pal = PAL_OCEAN; break;
		case "toxic": pal = PAL_TOXIC; break;
		default: pal = PAL_DEFAULT;
	}

	const t = animState.tickCount * timeScale;
	const modFreq = freq + Math.sin(t * freqModulation) * 0.1;

	const rows: string[] = [];
	for (let y = 0; y < height; y++) {
		let row = '';
		for (let x = 0; x < width; x++) {
			const cx = x + 0.5 * Math.sin(t / 5);
			const cy = y + 0.5 * Math.cos(t / 3);
			const v =
				Math.sin(x * modFreq + t) +
				Math.sin(y * modFreq + t * 0.7) +
				Math.sin((x + y) * (modFreq * 0.6) + t * 0.5) +
				Math.sin(Math.sqrt(cx * cx + cy * cy) * (modFreq * 0.8) + t);
			let normalized = (v + 4) / 8;

			if (colorCycle) {
				normalized = (normalized + t * 0.05) % 1;
			}

			const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, normalized);
			const charIdx = Math.min(pal.length - 1, Math.floor(normalized * pal.length));
			row += style({ fg: color })(pal[charIdx]!);
		}
		rows.push(row);
	}
	return rows.join('\n');
}
