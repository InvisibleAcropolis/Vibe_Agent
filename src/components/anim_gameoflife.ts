import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { requireBooleanOption, requireNumberOption, requireStringOption } from "./anim-option-helpers.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface GameOfLifeOptions {
	cols?: number;
	rows?: number;
	density?: number;
	ticksPerStep?: number;
	rule?: string;
	randomSeed?: boolean;
	cellAging?: boolean;
	agingSpeed?: number;
	reseedOnStagnation?: boolean;
	stagnationThreshold?: number;
	maxGenerations?: number;
}

const LIVE_CHARS = ['░', '▒', '▓', '█'] as const;
const MODULE_ID = "anim_gameoflife";

function parseRule(rule: string): { born: Set<number>; survives: Set<number> } {
	const parts = rule.split('/');
	const born = new Set(parts[1] ? parts[1].split('').map(Number) : [3]);
	const survives = new Set(parts[0] ? parts[0].split('').map(Number) : [2, 3]);
	return { born, survives };
}

export function createGameOfLife(opts?: GameOfLifeOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const cols = requireNumberOption(opts?.cols, MODULE_ID, "cols");
	const rows = requireNumberOption(opts?.rows, MODULE_ID, "rows");
	const density = requireNumberOption(opts?.density, MODULE_ID, "density");
	const ticksPerStep = requireNumberOption(opts?.ticksPerStep, MODULE_ID, "ticksPerStep");
	const rule = requireStringOption(opts?.rule, MODULE_ID, "rule");
	const randomSeed = requireBooleanOption(opts?.randomSeed, MODULE_ID, "randomSeed");
	const cellAging = requireBooleanOption(opts?.cellAging, MODULE_ID, "cellAging");
	const agingSpeed = requireNumberOption(opts?.agingSpeed, MODULE_ID, "agingSpeed");
	const reseedOnStagnation = requireBooleanOption(opts?.reseedOnStagnation, MODULE_ID, "reseedOnStagnation");
	const stagnationThreshold = requireNumberOption(opts?.stagnationThreshold, MODULE_ID, "stagnationThreshold");
	const maxGenerations = requireNumberOption(opts?.maxGenerations, MODULE_ID, "maxGenerations");

	const { born, survives } = parseRule(rule);

	function createSeed(): Uint8Array {
		const g = new Uint8Array(cols * rows);
		for (let i = 0; i < g.length; i++) g[i] = Math.random() < density ? 1 : 0;
		return g;
	}

	let grid = createSeed();
	let age = new Uint8Array(cols * rows);
	let gen = 0;
	let stagnantTicks = 0;
	let lastTick = -1;

	function step(): void {
		const next = new Uint8Array(cols * rows);
		const nextAge = new Uint8Array(cols * rows);
		let changed = false;

		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < cols; x++) {
				let n = 0;
				for (let dy = -1; dy <= 1; dy++) {
					for (let dx = -1; dx <= 1; dx++) {
						if (dx === 0 && dy === 0) continue;
						n += grid[((y + dy + rows) % rows) * cols + ((x + dx + cols) % cols)]!;
					}
				}
				const alive = grid[y * cols + x]!;
				const a = age[y * cols + x]!;
				const willSurvive = alive && survives.has(n);
				const willBeBorn = !alive && born.has(n);
				next[y * cols + x] = willSurvive || willBeBorn ? 1 : 0;
				nextAge[y * cols + x] = next[y * cols + x] ? Math.min(255, a + 1) : 0;
				if (next[y * cols + x] !== alive) changed = true;
			}
		}

		grid = next;
		age = nextAge;
		gen++;
		stagnantTicks = changed ? 0 : stagnantTicks + 1;

		if ((reseedOnStagnation && stagnantTicks > stagnationThreshold) || gen > maxGenerations) {
			grid = createSeed();
			age = new Uint8Array(cols * rows);
			gen = 0;
			stagnantTicks = 0;
		}
	}

	return (animState: AnimationState, theme: ThemeConfig): string => {
		if (animState.tickCount !== lastTick) {
			lastTick = animState.tickCount;
			if (animState.tickCount % ticksPerStep === 0) step();
		}

		const rowStrings: string[] = [];
		for (let y = 0; y < rows; y++) {
			let row = '';
			for (let x = 0; x < cols; x++) {
				const alive = grid[y * cols + x]!;
				if (alive) {
					const a = cellAging ? age[y * cols + x]! : 0;
					const t = Math.min(1, a / agingSpeed);
					const charIdx = Math.min(LIVE_CHARS.length - 1, Math.floor(t * LIVE_CHARS.length));
					const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, t);
					row += style({ fg: color })(LIVE_CHARS[charIdx]!);
				} else {
					row += ' ';
				}
			}
			rowStrings.push(row);
		}
		return rowStrings.join('\n');
	};
}
