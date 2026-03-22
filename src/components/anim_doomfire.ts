import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { requireNumberOption, requireStringOption } from "./anim-option-helpers.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface DoomFireOptions {
	width?: number;
	height?: number;
	coolingStrength?: number;
	coolingPattern?: "random" | "wave" | "radial" | "edge";
	colorMapping?: "default" | "electric" | "lava" | "plasma";
	windStrength?: number;
	windDirection?: -1 | 0 | 1;
	seedInterval?: number;
}

const PAL_DEFAULT = ' .,:;+=ox#%@';
const PAL_ELECTRIC = ' .━┄┅┃◤◢❖✦';
const PAL_LAVA = ' .oO@#%&8%B@';
const PAL_PLASMA = ' ░▒▓█◐◑◒◓';
const MODULE_ID = "anim_doomfire";

export function createDoomFire(opts?: DoomFireOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const W = requireNumberOption(opts?.width, MODULE_ID, "width");
	const H = requireNumberOption(opts?.height, MODULE_ID, "height");
	const coolingStrength = requireNumberOption(opts?.coolingStrength, MODULE_ID, "coolingStrength");
	const coolingPattern = requireStringOption(opts?.coolingPattern, MODULE_ID, "coolingPattern");
	const colorMapping = requireStringOption(opts?.colorMapping, MODULE_ID, "colorMapping");
	const windStrength = requireNumberOption(opts?.windStrength, MODULE_ID, "windStrength");
	const windDirection = requireNumberOption(opts?.windDirection, MODULE_ID, "windDirection");
	const seedInterval = requireNumberOption(opts?.seedInterval, MODULE_ID, "seedInterval");

	let pal: string;
	switch (colorMapping) {
		case "electric": pal = PAL_ELECTRIC; break;
		case "lava": pal = PAL_LAVA; break;
		case "plasma": pal = PAL_PLASMA; break;
		default: pal = PAL_DEFAULT;
	}

	const buf = new Uint8Array(W * H);
	for (let x = 0; x < W; x++) buf[(H - 1) * W + x] = 255;

	let tickCounter = 0;

	return (_animState: AnimationState, theme: ThemeConfig): string => {
		tickCounter++;

		for (let y = 1; y < H; y++) {
			for (let x = 0; x < W; x++) {
				let rand = Math.floor(Math.random() * 3);
				if (windDirection !== 0 && windStrength > 0) {
					const windOffset = Math.round(windStrength * windDirection);
					rand = Math.max(0, Math.min(2, rand + windOffset));
				}
				const srcHeat = buf[y * W + x]!;
				let dstX = x - rand + 1;
				dstX = Math.max(0, Math.min(W - 1, dstX));
				buf[(y - 1) * W + dstX] = Math.max(0, srcHeat - (rand & 1));
			}
		}

		for (let x = 0; x < W; x++) {
			let shouldCool = false;
			switch (coolingPattern) {
				case "wave":
					shouldCool = Math.sin(tickCounter * 0.1 + x * 0.3) > 0.7;
					break;
				case "radial":
					const centerX = W / 2;
					const dist = Math.abs(x - centerX) / centerX;
					shouldCool = Math.sin(tickCounter * 0.05 + dist * Math.PI) > 0.8;
					break;
				case "edge":
					shouldCool = x < 2 || x > W - 3;
					break;
				default:
					shouldCool = Math.random() < coolingStrength;
			}

			if (shouldCool) buf[(H - 1) * W + x] = 0;
			else buf[(H - 1) * W + x] = 255;
		}

		if (tickCounter % seedInterval === 0 && H > 2) {
			const seedX = Math.floor(Math.random() * W);
			buf[(H - 1) * W + seedX] = 255;
		}

		const rows: string[] = [];
		for (let y = 0; y < H; y++) {
			let row = '';
			for (let x = 0; x < W; x++) {
				const heat = buf[y * W + x]!;
				const t = heat / 255;
				const charIdx = Math.min(pal.length - 1, Math.floor(t * pal.length));
				const char = pal[charIdx]!;
				if (heat < 8) {
					row += style({ fg: '#1a3348' })(char);
				} else {
					row += style({ fg: lerpColor(theme.breathBaseColor, theme.breathPeakColor, t) })(char);
				}
			}
			rows.push(row);
		}
		return rows.join('\n');
	};
}
