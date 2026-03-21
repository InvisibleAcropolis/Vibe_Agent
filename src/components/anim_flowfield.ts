import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface FlowFieldOptions {
	cols?: number;
	rows?: number;
	count?: number;
	timeScale?: number;
	turbulence?: number;
	trailLength?: number;
	particleSpeed?: number;
	inertia?: number;
	curlStrength?: number;
}

const DIRS = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'] as const;

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	trail: Array<{ x: number; y: number }>;
}

function noise(x: number, y: number, t: number): number {
	return (
		Math.sin(x * 0.7 + t) * Math.cos(y * 0.5 - t * 0.3) +
		Math.cos(x * 0.3 + t * 0.7) * Math.sin(y * 0.8 + t * 0.2) +
		Math.sin((x + y) * 0.4 + t * 0.5)
	) / 3;
}

function curl(x: number, y: number, t: number, scale: number): number {
	const eps = 0.01;
	const n1 = noise(x, y + eps, t);
	const n2 = noise(x, y - eps, t);
	const n3 = noise(x + eps, y, t);
	const n4 = noise(x - eps, y, t);
	return ((n1 - n2) - (n3 - n4)) / (2 * eps) * scale;
}

export function createFlowField(opts?: FlowFieldOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const cols = opts?.cols ?? 28;
	const rows = opts?.rows ?? 8;
	const count = opts?.count ?? 40;
	const timeScale = opts?.timeScale ?? 0.015;
	const turbulence = opts?.turbulence ?? 0.1;
	const trailLength = opts?.trailLength ?? 4;
	const particleSpeed = opts?.particleSpeed ?? 0.25;
	const inertia = opts?.inertia ?? 0.85;
	const curlStrength = opts?.curlStrength ?? 0;

	const particles: Particle[] = Array.from({ length: count }, () => ({
		x: Math.random() * cols,
		y: Math.random() * rows,
		vx: 0,
		vy: 0,
		trail: [],
	}));

	return (animState: AnimationState, theme: ThemeConfig): string => {
		const t = animState.tickCount * timeScale;

		for (const p of particles) {
			const fx = p.x, fy = p.y;
			let noiseVal = noise(fx * 0.5, fy * 0.5, t);

			if (turbulence > 0) {
				noiseVal += (Math.random() - 0.5) * turbulence;
			}

			let curlForce = 0;
			if (curlStrength > 0) {
				curlForce = curl(fx * 0.5, fy * 0.5, t, curlStrength);
			}

			const angle = noiseVal * Math.PI + curlForce;

			p.vx = p.vx * inertia + Math.cos(angle) * particleSpeed;
			p.vy = p.vy * inertia + Math.sin(angle) * particleSpeed;

			p.trail.push({ x: Math.floor(p.x), y: Math.floor(p.y) });
			if (p.trail.length > trailLength) p.trail.shift();

			p.x = (p.x + p.vx + cols) % cols;
			p.y = (p.y + p.vy + rows) % rows;
		}

		const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(' '));
		const brightnessGrid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

		for (const p of particles) {
			const angle = Math.atan2(-p.vy, p.vx);
			const di = Math.round(((angle / (Math.PI * 2)) * 8 + 8)) % 8;

			p.trail.forEach((pos, i) => {
				if (pos.x < 0 || pos.x >= cols || pos.y < 0 || pos.y >= rows) return;
				const t2 = (i + 1) / p.trail.length;
				if (t2 > brightnessGrid[pos.y]![pos.x]!) {
					brightnessGrid[pos.y]![pos.x] = t2;
					const isHead = i === p.trail.length - 1;
					const char = isHead ? (DIRS[di] ?? '→') : '·';
					const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, t2 * 0.7 + 0.2);
					grid[pos.y]![pos.x] = style({ fg: color })(char);
				}
			});
		}

		return grid.map(r => r.join('')).join('\n');
	};
}
