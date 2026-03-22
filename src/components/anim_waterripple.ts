import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { requireBooleanOption, requireNumberOption } from "./anim-option-helpers.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface WaterRippleOptions {
	cols?: number;
	rows?: number;
	damping?: number;
	disturbInterval?: number;
	raindropChance?: number;
	raindropStrength?: number;
	reflectionEnabled?: boolean;
	refractionStrength?: number;
	multipleDrops?: boolean;
}

const PAL = [' ', '·', ':', ';', '|', '+', '=', '*', '#', '@'] as const;
const DIM_COLOR = '#1a3348';

interface Raindrop {
	x: number;
	y: number;
	strength: number;
}
const MODULE_ID = "anim_waterripple";

export function createWaterRipple(opts?: WaterRippleOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const cols = requireNumberOption(opts?.cols, MODULE_ID, "cols");
	const rows = requireNumberOption(opts?.rows, MODULE_ID, "rows");
	const damping = requireNumberOption(opts?.damping, MODULE_ID, "damping");
	const disturbInterval = requireNumberOption(opts?.disturbInterval, MODULE_ID, "disturbInterval");
	const raindropChance = requireNumberOption(opts?.raindropChance, MODULE_ID, "raindropChance");
	const raindropStrength = requireNumberOption(opts?.raindropStrength, MODULE_ID, "raindropStrength");
	const reflectionEnabled = requireBooleanOption(opts?.reflectionEnabled, MODULE_ID, "reflectionEnabled");
	const refractionStrength = requireNumberOption(opts?.refractionStrength, MODULE_ID, "refractionStrength");
	const multipleDrops = requireBooleanOption(opts?.multipleDrops, MODULE_ID, "multipleDrops");

	let cur = new Float32Array(cols * rows);
	let prv = new Float32Array(cols * rows);
	let lastTick = -1;
	let ticksSinceDisturbance = 0;
	const raindrops: Raindrop[] = [];

	return (animState: AnimationState, theme: ThemeConfig): string => {
		if (animState.tickCount !== lastTick) {
			lastTick = animState.tickCount;
			ticksSinceDisturbance++;

			if (ticksSinceDisturbance >= disturbInterval) {
				ticksSinceDisturbance = 0;

				if (multipleDrops) {
					const dropCount = Math.floor(Math.random() * 3) + 1;
					for (let d = 0; d < dropCount; d++) {
						const rx = 1 + Math.floor(Math.random() * (cols - 2));
						const ry = 1 + Math.floor(Math.random() * (rows - 2));
						const strength = raindropStrength * (0.5 + Math.random() * 0.5);
						cur[ry * cols + rx] = strength;
						if (reflectionEnabled) {
							raindrops.push({ x: rx, y: ry, strength });
						}
					}
				} else {
					const rx = 1 + Math.floor(Math.random() * (cols - 2));
					const ry = 1 + Math.floor(Math.random() * (rows - 2));
					cur[ry * cols + rx] = raindropChance > Math.random() ? raindropStrength : 0;
					if (reflectionEnabled && Math.random() < raindropChance) {
						raindrops.push({ x: rx, y: ry, strength: raindropStrength });
					}
				}
			}

			const next = new Float32Array(cols * rows);
			for (let y = 1; y < rows - 1; y++) {
				for (let x = 1; x < cols - 1; x++) {
					let avg = (
						cur[(y - 1) * cols + x] +
						cur[(y + 1) * cols + x] +
						cur[y * cols + x - 1] +
						cur[y * cols + x + 1]
					) / 2 - prv[y * cols + x];

					if (reflectionEnabled) {
						for (const drop of raindrops) {
							const dx = x - drop.x;
							const dy = y - drop.y;
							const dist = Math.sqrt(dx * dx + dy * dy);
							if (dist < 3 && dist > 0) {
								avg += drop.strength * refractionStrength / (dist + 1);
							}
						}
					}

					next[y * cols + x] = avg * damping;
				}
			}
			prv = cur;
			cur = next;

			for (let i = raindrops.length - 1; i >= 0; i--) {
				raindrops[i]!.strength *= 0.9;
				if (raindrops[i]!.strength < 5) {
					raindrops.splice(i, 1);
				}
			}
		}

		const rowStrings: string[] = [];
		for (let y = 0; y < rows; y++) {
			let row = '';
			for (let x = 0; x < cols; x++) {
				const v = Math.abs(cur[y * cols + x]!);
				const t = Math.min(1, v / 120);
				if (t < 0.04) {
					row += style({ fg: DIM_COLOR })('·');
				} else {
					const charIdx = Math.min(PAL.length - 1, Math.floor(t * PAL.length));
					const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, t);
					row += style({ fg: color })(PAL[charIdx]!);
				}
			}
			rowStrings.push(row);
		}
		return rowStrings.join('\n');
	};
}
