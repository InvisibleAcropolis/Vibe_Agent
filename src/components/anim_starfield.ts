import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface StarfieldOptions {
	cols?: number;
	rows?: number;
	count?: number;
	speed?: number;
	cometTail?: boolean;
	tailLength?: number;
	depthOfField?: boolean;
	starColors?: string[];
	colorVariety?: number;
}

const STAR_CHARS = ['.', '·', '✦', '★', '◆', '▰'] as const;

interface Star {
	x: number;
	y: number;
	z: number;
	trail: Array<{ x: number; y: number }>;
	vx: number;
	vy: number;
	colorIdx: number;
}

function respawn(s: Star, cols: number, rows: number): void {
	s.x = (Math.random() - 0.5) * 2;
	s.y = (Math.random() - 0.5) * 2;
	s.z = 1;
	s.trail = [];
	s.colorIdx = Math.floor(Math.random() * STAR_CHARS.length);
}

export function createStarfield(opts?: StarfieldOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const cols = opts?.cols ?? 24;
	const rows = opts?.rows ?? 8;
	const count = opts?.count ?? 80;
	const speed = opts?.speed ?? 0.015;
	const cometTail = opts?.cometTail ?? false;
	const tailLength = opts?.tailLength ?? 4;
	const depthOfField = opts?.depthOfField ?? false;
	const starColors = opts?.starColors ?? [];
	const colorVariety = opts?.colorVariety ?? 0.3;

	const stars: Star[] = Array.from({ length: count }, () => ({
		x: (Math.random() - 0.5) * 2,
		y: (Math.random() - 0.5) * 2,
		z: Math.random() * 0.9 + 0.1,
		trail: [],
		vx: 0,
		vy: 0,
		colorIdx: 0,
	}));

	return (_animState: AnimationState, theme: ThemeConfig): string => {
		const fovX = cols / 2;
		const fovY = rows;

		const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(' '));
		const brightness: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

		for (const s of stars) {
			s.z -= speed;
			s.vx = s.vx * 0.95 + (Math.random() - 0.5) * 0.01;
			s.vy = s.vy * 0.95 + (Math.random() - 0.5) * 0.01;
			s.x += s.vx;
			s.y += s.vy;

			if (s.z <= 0) { respawn(s, cols, rows); continue; }

			const sx = Math.floor(s.x / s.z * fovX + cols / 2);
			const sy = Math.floor(s.y / s.z * fovY + rows / 2);

			if (sx < 0 || sx >= cols || sy < 0 || sy >= rows) { respawn(s, cols, rows); continue; }

			const b = depthOfField ? 1 - s.z * (0.5 + Math.random() * 0.5) : 1 - s.z;

			if (cometTail && b > brightness[sy]![sx]!) {
				for (let t = 0; t < tailLength; t++) {
					const tx = sx - Math.floor(s.vx * t * 3);
					const ty = sy - Math.floor(s.vy * t * 3);
					if (tx >= 0 && tx < cols && ty >= 0 && ty < rows) {
						const tb = b * (1 - t / tailLength);
						if (tb > brightness[ty]![tx]!) {
							brightness[ty]![tx] = tb;
							const trailChar = t === tailLength - 1 ? STAR_CHARS[s.colorIdx]! : '·';
							const trailColor = starColors.length > 0
								? starColors[s.colorIdx % starColors.length]!
								: lerpColor(theme.breathBaseColor, theme.breathPeakColor, tb * 0.9 + 0.1);
							grid[ty]![tx] = style({ fg: trailColor })(trailChar);
						}
					}
				}
			}

			if (b > brightness[sy]![sx]!) {
				brightness[sy]![sx] = b;
				const charIdx = Math.min(STAR_CHARS.length - 1, Math.floor(b * STAR_CHARS.length));
				let starColor: string;
				if (starColors.length > 0 && Math.random() < colorVariety) {
					starColor = starColors[Math.floor(Math.random() * starColors.length)]!;
				} else if (starColors.length > 0) {
					starColor = starColors[s.colorIdx % starColors.length]!;
				} else {
					starColor = lerpColor(theme.breathBaseColor, theme.breathPeakColor, b * 0.9 + 0.1);
				}
				grid[sy]![sx] = style({ fg: starColor })(STAR_CHARS[charIdx]!);
			}
		}

		return grid.map(r => r.join('')).join('\n');
	};
}
