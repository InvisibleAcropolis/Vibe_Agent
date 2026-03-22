import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { requireBooleanOption, requireNumberOption, requireStringOption } from "./anim-option-helpers.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface BoidsOptions {
	cols?: number;
	rows?: number;
	count?: number;
	maxSpeed?: number;
	radius?: number;
	boundaryBehavior?: "wrap" | "bounce" | "restrict";
	predatorEnabled?: boolean;
	predatorCount?: number;
	foodSources?: Array<{ x: number; y: number; strength: number }>;
	separationStrength?: number;
	alignmentStrength?: number;
	cohesionStrength?: number;
}

const DIRS = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'] as const;

interface Boid {
	x: number;
	y: number;
	vx: number;
	vy: number;
	isPredator: boolean;
}

interface FoodSource {
	x: number;
	y: number;
	strength: number;
}
const MODULE_ID = "anim_boids";

export function createBoids(opts?: BoidsOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const cols = requireNumberOption(opts?.cols, MODULE_ID, "cols");
	const rows = requireNumberOption(opts?.rows, MODULE_ID, "rows");
	const count = requireNumberOption(opts?.count, MODULE_ID, "count");
	const maxSpeed = requireNumberOption(opts?.maxSpeed, MODULE_ID, "maxSpeed");
	const radius = requireNumberOption(opts?.radius, MODULE_ID, "radius");
	const sepRadius = radius * 0.4;
	const boundaryBehavior = requireStringOption(opts?.boundaryBehavior, MODULE_ID, "boundaryBehavior");
	const predatorEnabled = requireBooleanOption(opts?.predatorEnabled, MODULE_ID, "predatorEnabled");
	const predatorCount = requireNumberOption(opts?.predatorCount, MODULE_ID, "predatorCount");
	const foodSources = opts?.foodSources ?? [];
	const separationStrength = requireNumberOption(opts?.separationStrength, MODULE_ID, "separationStrength");
	const alignmentStrength = requireNumberOption(opts?.alignmentStrength, MODULE_ID, "alignmentStrength");
	const cohesionStrength = requireNumberOption(opts?.cohesionStrength, MODULE_ID, "cohesionStrength");

	const boids: Boid[] = Array.from({ length: count }, () => ({
		x: Math.random() * cols,
		y: Math.random() * rows,
		vx: (Math.random() - 0.5) * 0.4,
		vy: (Math.random() - 0.5) * 0.3,
		isPredator: false,
	}));

	if (predatorEnabled) {
		for (let i = 0; i < predatorCount; i++) {
			boids[i] = {
				x: Math.random() * cols,
				y: Math.random() * rows,
				vx: (Math.random() - 0.5) * 0.6,
				vy: (Math.random() - 0.5) * 0.4,
				isPredator: true,
			};
		}
	}

	return (_animState: AnimationState, theme: ThemeConfig): string => {
		for (const b of boids) {
			let ax = 0, ay = 0;
			let cx = 0, cy = 0;
			let sx = 0, sy = 0;
			let nc = 0;

			for (const o of boids) {
				if (o === b) continue;
				const dx = o.x - b.x, dy = o.y - b.y;
				const d = Math.hypot(dx, dy);

				if (b.isPredator && d < radius * 0.5) {
					sx -= dx / (d + 0.1) * 0.2;
					sy -= dy / (d + 0.1) * 0.2;
					continue;
				}

				if (d < radius && d > 0) {
					nc++;
					ax += o.vx; ay += o.vy;
					cx += o.x; cy += o.y;
					if (d < sepRadius) {
						sx -= dx / d * separationStrength;
						sy -= dy / d * separationStrength;
					}
				}
			}

			for (const food of foodSources) {
				const dx = food.x - b.x;
				const dy = food.y - b.y;
				const d = Math.hypot(dx, dy);
				if (d < radius * 2 && d > 0) {
					sx += dx / d * food.strength * 0.01;
					sy += dy / d * food.strength * 0.01;
				}
			}

			if (nc > 0) {
				b.vx += (ax / nc - b.vx) * alignmentStrength + (cx / nc - b.x) * cohesionStrength + sx;
				b.vy += (ay / nc - b.vy) * alignmentStrength + (cy / nc - b.y) * cohesionStrength + sy;
			} else {
				b.vx += sx;
				b.vy += sy;
			}

			const spd = Math.hypot(b.vx, b.vy);
			const actualMaxSpeed = b.isPredator ? maxSpeed * 1.5 : maxSpeed;
			if (spd > actualMaxSpeed) {
				b.vx = b.vx / spd * actualMaxSpeed;
				b.vy = b.vy / spd * actualMaxSpeed;
			}

			switch (boundaryBehavior) {
				case "bounce":
					if (b.x < 0) { b.vx = Math.abs(b.vx); b.x = 0; }
					if (b.x >= cols) { b.vx = -Math.abs(b.vx); b.x = cols - 0.1; }
					if (b.y < 0) { b.vy = Math.abs(b.vy); b.y = 0; }
					if (b.y >= rows) { b.vy = -Math.abs(b.vy); b.y = rows - 0.1; }
					break;
				case "restrict":
					b.x = Math.max(0, Math.min(cols - 0.1, b.x + b.vx));
					b.y = Math.max(0, Math.min(rows - 0.1, b.y + b.vy));
					break;
				default:
					b.x = (b.x + b.vx + cols) % cols;
					b.y = (b.y + b.vy + rows) % rows;
			}
		}

		const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(' '));

		for (const b of boids) {
			const x = Math.floor(b.x), y = Math.floor(b.y);
			const angle = Math.atan2(-b.vy, b.vx);
			const di = Math.round(((angle / (Math.PI * 2)) * 8 + 8)) % 8;
			const spd = Math.hypot(b.vx, b.vy) / maxSpeed;
			const color = b.isPredator
				? '#ff4444'
				: lerpColor(theme.breathBaseColor, theme.breathPeakColor, 0.3 + spd * 0.7);
			grid[y]![x] = style({ fg: color })(DIRS[di]!);
		}

		return grid.map(r => r.join('')).join('\n');
	};
}
