import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface VortexOptions {
	cols?: number;
	rows?: number;
	count?: number;
	pullStrength?: number;
	trailLength?: number;
	spawnPattern?: "random" | "ring" | "spiral" | "burst";
	colorTrail?: boolean;
	magneticField?: boolean;
}

const CHARS = ['✦', '◉', '•', '∙', '·'] as const;

interface Particle {
	angle: number;
	radius: number;
	angularSpeed: number;
	trail: Array<{ x: number; y: number; t: number }>;
}

function spawnParticle(baseRadius: number, pattern: string): Particle {
	switch (pattern) {
		case "ring":
			return {
				angle: Math.random() * Math.PI * 2,
				radius: baseRadius * (0.8 + Math.random() * 0.2),
				angularSpeed: 0.03 + Math.random() * 0.05,
				trail: [],
			};
		case "spiral":
			return {
				angle: Math.random() * Math.PI * 2,
				radius: baseRadius,
				angularSpeed: 0.05 + Math.random() * 0.03,
				trail: [],
			};
		case "burst":
			return {
				angle: Math.random() * Math.PI * 2,
				radius: baseRadius * 0.5,
				angularSpeed: 0.08 + Math.random() * 0.04,
				trail: [],
			};
		default:
			return {
				angle: Math.random() * Math.PI * 2,
				radius: baseRadius * (0.7 + Math.random() * 0.3),
				angularSpeed: 0.03 + Math.random() * 0.05,
				trail: [],
			};
	}
}

export function createVortex(opts?: VortexOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const cols = opts?.cols ?? 24;
	const rows = opts?.rows ?? 10;
	const count = opts?.count ?? 35;
	const pullStrength = opts?.pullStrength ?? 0.04;
	const trailLength = opts?.trailLength ?? 3;
	const spawnPattern = opts?.spawnPattern ?? "random";
	const colorTrail = opts?.colorTrail ?? true;
	const magneticField = opts?.magneticField ?? false;

	const baseRadius = Math.min(cols, rows * 2) / 2;

	const particles: Particle[] = Array.from({ length: count }, () => spawnParticle(baseRadius, spawnPattern));

	return (_animState: AnimationState, theme: ThemeConfig): string => {
		const cx = cols / 2;
		const cy = rows / 2;

		const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(' '));
		const brig: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

		for (const p of particles) {
			let angularVel = p.angularSpeed * (baseRadius / Math.max(p.radius, 0.5));

			if (magneticField) {
				const fieldInfluence = Math.sin(p.angle * 3) * 0.02;
				angularVel += fieldInfluence;
			}

			p.angle += angularVel;
			p.radius -= pullStrength;

			if (p.radius <= 0.3) {
				Object.assign(p, spawnParticle(baseRadius, spawnPattern));
				continue;
			}

			p.trail.push({ x: p.radius * Math.cos(p.angle), y: p.radius * Math.sin(p.angle) * 0.5, t: 1 });
			if (p.trail.length > trailLength) p.trail.shift();

			const px = Math.floor(cx + p.radius * Math.cos(p.angle));
			const py = Math.floor(cy + p.radius * Math.sin(p.angle) * 0.5);

			if (px < 0 || px >= cols || py < 0 || py >= rows) continue;

			const t = 1 - p.radius / baseRadius;

			if (colorTrail) {
				for (let i = 0; i < p.trail.length; i++) {
					const tp = p.trail[i]!;
					const tx = Math.floor(cx + tp.x);
					const ty = Math.floor(cy + tp.y * 0.5);
					if (tx >= 0 && tx < cols && ty >= 0 && ty < rows) {
						const trailT = (i + 1) / p.trail.length * t;
						const trailColor = lerpColor(theme.breathBaseColor, theme.breathPeakColor, trailT * 0.5);
						if (trailT > brig[ty]![tx]!) {
							brig[ty]![tx] = trailT;
							grid[ty]![tx] = style({ fg: trailColor })('·');
						}
					}
				}
			}

			if (t > brig[py]![px]!) {
				brig[py]![px] = t;
				const charIdx = Math.min(CHARS.length - 1, Math.floor(t * CHARS.length));
				const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, t);
				grid[py]![px] = style({ fg: color })(CHARS[charIdx]!);
			}
		}

		return grid.map(r => r.join('')).join('\n');
	};
}
