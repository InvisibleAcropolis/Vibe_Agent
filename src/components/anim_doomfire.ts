import { hslToHex, style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { requireNumberOption, requireStringOption } from "./anim-option-helpers.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface DoomFireOptions {
	width?: number;
	height?: number;
	coolingStrength?: number;
	coolingPattern?: "random" | "wave" | "radial" | "edge";
	bottomHueStep?: number;
	topHueStep?: number;
	saturation?: number;
	lightness?: number;
	renderMode?: "glyph" | "block";
	windStrength?: number;
	windDirection?: -1 | 0 | 1;
	seedInterval?: number;
}

const PAL_DEFAULT = ' .,:;+=ox#%@';
const MODULE_ID = "anim_doomfire";

interface GradientBias {
	bottomHueOffset: number;
	topHueOffset: number;
	saturationOffset: number;
	lightnessOffset: number;
}

function clampHueStep(value: number): number {
	return Math.max(0, Math.min(256, value));
}

function clampUnit(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function getGradientBias(coolingPattern: DoomFireOptions["coolingPattern"]): GradientBias {
	switch (coolingPattern) {
		case "wave":
			return { bottomHueOffset: 10, topHueOffset: 24, saturationOffset: 0.04, lightnessOffset: 0.03 };
		case "radial":
			return { bottomHueOffset: -6, topHueOffset: 30, saturationOffset: 0.08, lightnessOffset: 0.02 };
		case "edge":
			return { bottomHueOffset: 18, topHueOffset: -10, saturationOffset: -0.06, lightnessOffset: -0.04 };
		default:
			return { bottomHueOffset: 0, topHueOffset: 0, saturationOffset: 0, lightnessOffset: 0 };
	}
}

function hueStepToHex(step: number, saturation: number, lightness: number): string {
	const hue = (clampHueStep(step) / 256) * 360;
	return hslToHex(hue, clampUnit(saturation), clampUnit(lightness));
}

export function createDoomFire(opts?: DoomFireOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const W = requireNumberOption(opts?.width, MODULE_ID, "width");
	const H = requireNumberOption(opts?.height, MODULE_ID, "height");
	const coolingStrength = requireNumberOption(opts?.coolingStrength, MODULE_ID, "coolingStrength");
	const coolingPattern = requireStringOption(opts?.coolingPattern, MODULE_ID, "coolingPattern");
	const bottomHueStep = requireNumberOption(opts?.bottomHueStep, MODULE_ID, "bottomHueStep");
	const topHueStep = requireNumberOption(opts?.topHueStep, MODULE_ID, "topHueStep");
	const saturation = requireNumberOption(opts?.saturation, MODULE_ID, "saturation");
	const lightness = requireNumberOption(opts?.lightness, MODULE_ID, "lightness");
	const renderMode = requireStringOption(opts?.renderMode, MODULE_ID, "renderMode");
	const windStrength = requireNumberOption(opts?.windStrength, MODULE_ID, "windStrength");
	const windDirection = requireNumberOption(opts?.windDirection, MODULE_ID, "windDirection");
	const seedInterval = requireNumberOption(opts?.seedInterval, MODULE_ID, "seedInterval");

	const buf = new Uint8Array(W * H);
	for (let x = 0; x < W; x++) buf[(H - 1) * W + x] = 255;

	let tickCounter = 0;
	const gradientBias = getGradientBias(coolingPattern);
	const biasedSaturation = clampUnit(saturation + gradientBias.saturationOffset);
	const biasedLightness = clampUnit(lightness + gradientBias.lightnessOffset);
	const bottomHex = hueStepToHex(bottomHueStep + gradientBias.bottomHueOffset, biasedSaturation, biasedLightness);
	const topHex = hueStepToHex(topHueStep + gradientBias.topHueOffset, biasedSaturation, biasedLightness);

	return (_animState: AnimationState, _theme: ThemeConfig): string => {
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
			const rowT = H <= 1 ? 0 : 1 - (y / (H - 1));
			const rowGradientColor = lerpColor(bottomHex, topHex, rowT);
			let row = '';
			for (let x = 0; x < W; x++) {
				const heat = buf[y * W + x]!;
				const heatT = heat / 255;
				const charIdx = Math.min(PAL_DEFAULT.length - 1, Math.floor(heatT * PAL_DEFAULT.length));
				const char = PAL_DEFAULT[charIdx]!;
				const finalCellColor = lerpColor("#000000", rowGradientColor, heatT);
				row += renderMode === "block"
					? style({ bg: finalCellColor })(" ")
					: style({ fg: finalCellColor })(char);
			}
			rows.push(row);
		}
		return rows.join('\n');
	};
}
