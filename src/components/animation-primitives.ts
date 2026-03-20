import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

const ANIMATION_GLYPHS =
	'▐▓▒░█▄▀◆■•─╌═≡∽╣╗╝╔╩╦╠╬┼┤├┐└│⣾⣽⣻⢿⡿⣟⣯⣷÷×~+#@$%&*=';

// ─── Preset 1: Glyph Cascade ────────────────────────────────────────────────

export interface GlyphCascadeOptions {
	maxCount?: number;     // default 8  — peak glyph count
	historyRows?: number;  // default 11 — trailing rows kept
	ticksPerStep?: number; // default 2  — ticks between count changes
}

export function createGlyphCascade(opts?: GlyphCascadeOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const maxCount = opts?.maxCount ?? 8;
	const historyRows = opts?.historyRows ?? 11;
	const ticksPerStep = opts?.ticksPerStep ?? 2;

	let count = 1;
	let dir: 1 | -1 = 1;
	const history: string[] = [];
	let lastTick = -1;

	return (animState: AnimationState, theme: ThemeConfig): string => {
		const { tickCount } = animState;

		if (tickCount !== lastTick && tickCount % ticksPerStep === 0) {
			// Build one row of `count` glyphs, each colorized along the gradient
			let row = "";
			for (let i = 0; i < count; i++) {
				const t = count <= 1 ? 0.5 : i / (count - 1);
				const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, t);
				const glyph = ANIMATION_GLYPHS[Math.floor(Math.random() * ANIMATION_GLYPHS.length)]!;
				row += style({ fg: color })(glyph);
			}

			history.push(row);
			if (history.length > historyRows) history.shift();

			count += dir;
			if (count >= maxCount) {
				dir = -1;
			} else if (count <= 0) {
				dir = 1;
				count = 1;
			}

			lastTick = tickCount;
		}

		return history.join("\n");
	};
}

// ─── Preset 2: Pulse Meter ──────────────────────────────────────────────────

export interface PulseMeterOptions {
	width?: number;  // default 24
	label?: string;  // default: percentage string
}

export function renderPulseMeter(
	value: number,
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: PulseMeterOptions,
): string {
	void animState; // tickCount not needed here; value drives the display
	const width = opts?.width ?? 24;
	const clamped = Math.max(0, Math.min(1, value));
	const label = opts?.label ?? `${Math.round(clamped * 100)}%`;
	const filled = Math.round(clamped * width);
	const FILL_CHARS = ['░', '▒', '▓', '█'] as const;
	const DIM_COLOR = '#1a3348';

	const cells: string[] = [];
	for (let i = 0; i < width; i++) {
		if (i < filled) {
			const t = i / width;
			const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, t);
			const charIdx = Math.min(3, Math.floor(t * 4));
			const char = FILL_CHARS[charIdx]!;
			cells.push(style({ fg: color })(char));
		} else {
			cells.push(style({ fg: DIM_COLOR })('·'));
		}
	}

	return `▐${cells.join('')}▌ ${label}`;
}

// ─── Preset 3: Orbit Arc ────────────────────────────────────────────────────

export interface OrbitArcOptions {
	trailLength?: number; // default 6
	label?: string;       // default '' (no label)
}

export function renderOrbitArc(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: OrbitArcOptions,
): string {
	const trailLength = opts?.trailLength ?? 6;
	const label = opts?.label ?? '';
	const BRAILLE_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'] as const;
	const TRAIL_CHARS = ['●', '◉', '•', '∙', '·', ' '] as const;

	const head = style({ fg: theme.breathPeakColor })(BRAILLE_FRAMES[animState.spinnerFrame]!);

	let trail = '';
	for (let i = 0; i < trailLength; i++) {
		const t = 1 - (i + 1) / (trailLength + 1);
		const char = TRAIL_CHARS[Math.min(i, TRAIL_CHARS.length - 1)]!;
		const color = lerpColor('#1a3348', theme.breathBaseColor, t);
		trail += style({ fg: color })(char);
	}

	return head + trail + (label ? ' ' + label : '');
}

// ─── Preset 4: Data Rain ────────────────────────────────────────────────────

export interface DataRainOptions {
	cols?: number;          // default 4
	rows?: number;          // default 3
	refreshEveryN?: number; // default 4 — ticks between glyph changes per column
}

export function renderDataRain(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: DataRainOptions,
): string {
	const cols = opts?.cols ?? 4;
	const rows = opts?.rows ?? 3;
	const refreshEveryN = opts?.refreshEveryN ?? 4;
	const { tickCount } = animState;

	const seededRand = (seed: number) =>
		Math.abs(Math.sin(seed * 9301 + 49297) * 233280) % 1;

	const lines: string[] = [];
	for (let r = 0; r < rows; r++) {
		const t = rows <= 1 ? 1 : 1 - (r / (rows - 1)) * 0.82;
		const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, t);
		const styler = style({ fg: color });

		const cells: string[] = [];
		for (let c = 0; c < cols; c++) {
			const seed = c * 997 + r * 31 + Math.floor(tickCount / refreshEveryN) * 7;
			const glyphIdx = Math.floor(seededRand(seed) * ANIMATION_GLYPHS.length);
			const glyph = ANIMATION_GLYPHS[glyphIdx]!;
			cells.push(styler(glyph));
		}
		lines.push(cells.join(' '));
	}

	return lines.join('\n');
}

// ─── Preset 5: Wave Sweep ───────────────────────────────────────────────────

export interface WaveSweepOptions {
	width?: number;  // default 24
	speed?: number;  // default 0.5 — cells advanced per tick
	sigma?: number;  // default 5.0 — gaussian spread
}

export function renderWaveSweep(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: WaveSweepOptions,
): string {
	const width = opts?.width ?? 24;
	const speed = opts?.speed ?? 0.5;
	const sigma = opts?.sigma ?? 5.0;
	const DIM_COLOR = '#1a3348';
	const WAVE_CHARS = ['·', '∙', '•', '─', '╌', '═', '≡'] as const;

	const wavePos = (animState.tickCount * speed) % width;

	const cells: string[] = [];
	for (let i = 0; i < width; i++) {
		const intensity = Math.exp(-Math.pow(i - wavePos, 2) / (2 * sigma * sigma));
		if (intensity < 0.04) {
			cells.push(style({ fg: DIM_COLOR })('·'));
		} else {
			const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, intensity);
			const charIdx = Math.min(WAVE_CHARS.length - 1, Math.round(intensity * (WAVE_CHARS.length - 1)));
			const char = WAVE_CHARS[charIdx]!;
			cells.push(style({ fg: color })(char));
		}
	}

	return cells.join('');
}

// ─── Preset 6: Plasma Wave ───────────────────────────────────────────────────

export interface PlasmaOptions {
	width?: number;     // default 24
	height?: number;    // default 8
	freq?: number;      // default 0.35
	timeScale?: number; // default 0.06
}

export function renderPlasma(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: PlasmaOptions,
): string {
	const width = opts?.width ?? 24;
	const height = opts?.height ?? 8;
	const freq = opts?.freq ?? 0.35;
	const timeScale = opts?.timeScale ?? 0.06;
	const t = animState.tickCount * timeScale;
	const PAL = ['░', '▒', '▓', '█'] as const;

	const rows: string[] = [];
	for (let y = 0; y < height; y++) {
		let row = '';
		for (let x = 0; x < width; x++) {
			const cx = x + 0.5 * Math.sin(t / 5);
			const cy = y + 0.5 * Math.cos(t / 3);
			const v =
				Math.sin(x * freq + t) +
				Math.sin(y * freq + t * 0.7) +
				Math.sin((x + y) * (freq * 0.6) + t * 0.5) +
				Math.sin(Math.sqrt(cx * cx + cy * cy) * (freq * 0.8) + t);
			const normalized = (v + 4) / 8; // v ∈ [-4,4] → [0,1]
			const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, normalized);
			const charIdx = Math.min(PAL.length - 1, Math.floor(normalized * PAL.length));
			row += style({ fg: color })(PAL[charIdx]!);
		}
		rows.push(row);
	}
	return rows.join('\n');
}

// ─── Preset 7: Synthgrid ─────────────────────────────────────────────────────

export interface SynthgridOptions {
	cols?: number;      // default 36
	rows?: number;      // default 10
	speed?: number;     // default 0.4
	numVLines?: number; // default 7
}

export function renderSynthgrid(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: SynthgridOptions,
): string {
	const cols = opts?.cols ?? 36;
	const rows = opts?.rows ?? 10;
	const speed = opts?.speed ?? 0.4;
	const numVLines = opts?.numVLines ?? 7;
	const tick = animState.tickCount;

	const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(' '));
	const isHoriz: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));

	const VX = cols / 2;

	for (let y = 0; y < rows; y++) {
		const progress = rows <= 1 ? 1 : y / (rows - 1); // 0 = horizon, 1 = nearest
		const tColor = progress * 0.8 + 0.2;

		// Horizontal lines: perspective spacing — denser near bottom
		const spacing = Math.max(1, Math.round(8 - progress * 6));
		const phase = (tick * speed) % spacing;
		if (Math.round(y + phase) % spacing === 0) {
			for (let x = 0; x < cols; x++) {
				grid[y]![x] = style({ fg: lerpColor(theme.breathBaseColor, theme.breathPeakColor, tColor) })('─');
				isHoriz[y]![x] = true;
			}
		}

		// Vertical lines converging to vanishing point at top-center
		for (let vi = 0; vi <= numVLines; vi++) {
			const edgeX = (vi / numVLines) * cols;
			const vx = Math.round(VX + (edgeX - VX) * progress);
			if (vx >= 0 && vx < cols) {
				const vColor = lerpColor(theme.breathBaseColor, theme.breathPeakColor, tColor * 0.85);
				grid[y]![vx] = style({ fg: vColor })(isHoriz[y]![vx] ? '┼' : '│');
			}
		}
	}

	return grid.map(r => r.join('')).join('\n');
}

// ─── Preset 8: Noise Field ───────────────────────────────────────────────────

export interface NoiseFieldOptions {
	cols?: number;       // default 24
	rows?: number;       // default 8
	timeScale?: number;  // default 0.025
	freqScale?: number;  // default 1.0
}

export function renderNoiseField(
	animState: AnimationState,
	theme: ThemeConfig,
	opts?: NoiseFieldOptions,
): string {
	const cols = opts?.cols ?? 24;
	const rows = opts?.rows ?? 8;
	const timeScale = opts?.timeScale ?? 0.025;
	const freqScale = opts?.freqScale ?? 1.0;
	const t = animState.tickCount * timeScale;
	const PAL = ['░', '▒', '▓', '█'] as const;

	const rowStrings: string[] = [];
	for (let y = 0; y < rows; y++) {
		let row = '';
		for (let x = 0; x < cols; x++) {
			const fx = x * freqScale;
			const fy = y * freqScale;
			const v = (
				Math.sin(fx * 0.7 + t) * Math.cos(fy * 0.5 - t * 0.3) +
				Math.cos(fx * 0.3 + t * 0.7) * Math.sin(fy * 0.8 + t * 0.2) +
				Math.sin((fx + fy) * 0.4 + t * 0.5)
			) / 3; // v ∈ [-1, 1]
			const normalized = (v + 1) / 2; // → [0, 1]
			const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, normalized);
			const charIdx = Math.min(PAL.length - 1, Math.floor(normalized * PAL.length));
			row += style({ fg: color })(PAL[charIdx]!);
		}
		rowStrings.push(row);
	}
	return rowStrings.join('\n');
}

// ─── Preset 9: Doom Fire ─────────────────────────────────────────────────────

export interface DoomFireOptions {
	width?: number;           // default 20
	height?: number;          // default 8
	coolingStrength?: number; // default 0.15 — fraction of bottom-row cells zeroed per tick
}

export function createDoomFire(opts?: DoomFireOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const W = opts?.width ?? 20;
	const H = opts?.height ?? 8;
	const coolingStrength = opts?.coolingStrength ?? 0.15;

	const buf = new Uint8Array(W * H);
	// Seed bottom row to max heat
	for (let x = 0; x < W; x++) buf[(H - 1) * W + x] = 255;

	const PAL = ' .,:;+=ox#%@';

	return (_animState: AnimationState, theme: ThemeConfig): string => {
		// Propagate fire upward: y iterates from bottom-1 UP to 0 so that row y-1
		// (already processed this frame) receives heat from row y (not yet overwritten).
		// Sanglard algorithm: integer subtraction only (rand & 1 gives 0 or 1), NOT a multiplier.
		for (let y = 1; y < H; y++) {
			for (let x = 0; x < W; x++) {
				const rand = Math.floor(Math.random() * 3); // 0, 1, or 2
				const srcHeat = buf[y * W + x]!;
				const dstX = Math.max(0, Math.min(W - 1, x - rand + 1));
				buf[(y - 1) * W + dstX] = Math.max(0, srcHeat - (rand & 1));
			}
		}
		// Randomly cool bottom row cells to create flame shape variation
		for (let x = 0; x < W; x++) {
			if (Math.random() < coolingStrength) buf[(H - 1) * W + x] = 0;
			else buf[(H - 1) * W + x] = 255;
		}

		const rows: string[] = [];
		for (let y = 0; y < H; y++) {
			let row = '';
			for (let x = 0; x < W; x++) {
				const heat = buf[y * W + x]!;
				const t = heat / 255;
				const charIdx = Math.min(PAL.length - 1, Math.floor(t * PAL.length));
				const char = PAL[charIdx]!;
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

// ─── Preset 10: Spectrum Bars ────────────────────────────────────────────────

export interface SpectrumBarsOptions {
	cols?: number;   // default 12
	rows?: number;   // default 6
	speed?: number;  // default 1.0
}

export function createSpectrumBars(opts?: SpectrumBarsOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const cols = opts?.cols ?? 12;
	const rows = opts?.rows ?? 6;
	const speed = opts?.speed ?? 1.0;

	// Each bar has an independent phase accumulator, slightly different rate
	const phases = Array.from({ length: cols }, (_, i) => i * 0.4);

	const EIGHTHS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;
	const DIM = '#1a3348';

	return (_animState: AnimationState, theme: ThemeConfig): string => {
		// Advance phases and compute bar values
		const vals = phases.map((ph, i) => {
			const newPhase = ph + (0.06 + i * 0.004) * speed;
			phases[i] = newPhase;
			return (Math.sin(newPhase) * 0.5 + 0.5) * 0.9 + 0.05;
		});

		const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(''));

		for (let x = 0; x < cols; x++) {
			const v = vals[x]!;
			const filledCells = v * rows;
			const fullRows = Math.floor(filledCells);
			const frac = filledCells - fullRows;

			for (let y = 0; y < rows; y++) {
				const fromBottom = rows - 1 - y;
				const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, v);

				if (fromBottom < fullRows) {
					grid[y]![x] = style({ fg: color })('█');
				} else if (fromBottom === fullRows) {
					const eighthIdx = Math.round(frac * 8);
					grid[y]![x] = eighthIdx === 0
						? style({ fg: DIM })('·')
						: style({ fg: color })(EIGHTHS[eighthIdx]!);
				} else {
					grid[y]![x] = style({ fg: DIM })('·');
				}
			}
		}

		return grid.map(r => r.join('')).join('\n');
	};
}

// ─── Preset 11: Starfield ────────────────────────────────────────────────────

export interface StarfieldOptions {
	cols?: number;   // default 24
	rows?: number;   // default 8
	count?: number;  // default 80
	speed?: number;  // default 0.015
}

export function createStarfield(opts?: StarfieldOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const cols = opts?.cols ?? 24;
	const rows = opts?.rows ?? 8;
	const count = opts?.count ?? 80;
	const speed = opts?.speed ?? 0.015;

	interface Star { x: number; y: number; z: number; }

	function respawn(s: Star): void {
		s.x = (Math.random() - 0.5) * 2;
		s.y = (Math.random() - 0.5) * 2;
		s.z = 1;
	}

	const stars: Star[] = Array.from({ length: count }, () => ({
		x: (Math.random() - 0.5) * 2,
		y: (Math.random() - 0.5) * 2,
		z: Math.random() * 0.9 + 0.1, // (0.1, 1.0] — avoids z=0 division risk
	}));

	const STAR_CHARS = ['.', '·', '✦', '★'] as const;

	return (_animState: AnimationState, theme: ThemeConfig): string => {
		const fovX = cols / 2;
		const fovY = rows;

		const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(' '));
		const brightness: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

		for (const s of stars) {
			s.z -= speed;
			if (s.z <= 0) { respawn(s); continue; }

			const sx = Math.floor(s.x / s.z * fovX + cols / 2);
			const sy = Math.floor(s.y / s.z * fovY + rows / 2);

			if (sx < 0 || sx >= cols || sy < 0 || sy >= rows) { respawn(s); continue; }

			const b = 1 - s.z;
			if (b > brightness[sy]![sx]!) {
				brightness[sy]![sx] = b;
				const charIdx = Math.min(STAR_CHARS.length - 1, Math.floor(b * STAR_CHARS.length));
				const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, b * 0.9 + 0.1);
				grid[sy]![sx] = style({ fg: color })(STAR_CHARS[charIdx]!);
			}
		}

		return grid.map(r => r.join('')).join('\n');
	};
}

// ─── Preset 12: Vortex / Orbital Spiral ─────────────────────────────────────

export interface VortexOptions {
	cols?: number;         // default 24
	rows?: number;         // default 10
	count?: number;        // default 35
	pullStrength?: number; // default 0.04 — inward drift per tick
}

export function createVortex(opts?: VortexOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const cols = opts?.cols ?? 24;
	const rows = opts?.rows ?? 10;
	const count = opts?.count ?? 35;
	const pullStrength = opts?.pullStrength ?? 0.04;

	// baseRadius derived from widget dimensions (half the smaller span, accounting for 2:1 char aspect)
	const baseRadius = Math.min(cols, rows * 2) / 2;

	interface Particle { angle: number; radius: number; angularSpeed: number; }

	function spawnParticle(): Particle {
		return {
			angle: Math.random() * Math.PI * 2,
			radius: baseRadius * (0.7 + Math.random() * 0.3),
			angularSpeed: 0.03 + Math.random() * 0.05,
		};
	}

	const particles: Particle[] = Array.from({ length: count }, spawnParticle);
	const CHARS = ['✦', '◉', '•', '∙', '·'] as const;

	return (_animState: AnimationState, theme: ThemeConfig): string => {
		const cx = cols / 2;
		const cy = rows / 2;

		const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(' '));
		const brig: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

		for (const p of particles) {
			// Angular velocity increases near center (baseRadius / radius amplifies when radius is small)
			p.angle += p.angularSpeed * (baseRadius / Math.max(p.radius, 0.5));
			p.radius -= pullStrength;
			if (p.radius <= 0.3) Object.assign(p, spawnParticle());

			const px = Math.floor(cx + p.radius * Math.cos(p.angle));
			const py = Math.floor(cy + p.radius * Math.sin(p.angle) * 0.5); // 0.5 = half-aspect for terminal chars

			if (px < 0 || px >= cols || py < 0 || py >= rows) continue;

			const t = 1 - p.radius / baseRadius;
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

// ─── Preset 13: Boids Flocking ───────────────────────────────────────────────

export interface BoidsOptions {
	cols?: number;      // default 28
	rows?: number;      // default 8
	count?: number;     // default 25
	maxSpeed?: number;  // default 0.5
	radius?: number;    // default 6.0 — neighborhood radius; separation at radius*0.4
}

export function createBoids(opts?: BoidsOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const cols = opts?.cols ?? 28;
	const rows = opts?.rows ?? 8;
	const count = opts?.count ?? 25;
	const maxSpeed = opts?.maxSpeed ?? 0.5;
	const radius = opts?.radius ?? 6.0;
	const sepRadius = radius * 0.4;

	interface Boid { x: number; y: number; vx: number; vy: number; }
	const boids: Boid[] = Array.from({ length: count }, () => ({
		x: Math.random() * cols,
		y: Math.random() * rows,
		vx: (Math.random() - 0.5) * 0.4,
		vy: (Math.random() - 0.5) * 0.3,
	}));

	const DIRS = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'] as const;

	return (_animState: AnimationState, theme: ThemeConfig): string => {
		for (const b of boids) {
			let ax = 0, ay = 0; // alignment accumulator
			let cx = 0, cy = 0; // cohesion accumulator
			let sx = 0, sy = 0; // separation accumulator
			let nc = 0;

			for (const o of boids) {
				if (o === b) continue;
				const dx = o.x - b.x, dy = o.y - b.y;
				const d = Math.hypot(dx, dy);
				if (d < radius && d > 0) {
					nc++;
					ax += o.vx; ay += o.vy;
					cx += o.x;  cy += o.y;
					if (d < sepRadius) { sx -= dx / d * 0.06; sy -= dy / d * 0.06; }
				}
			}

			if (nc > 0) {
				b.vx += (ax / nc - b.vx) * 0.02 + (cx / nc - b.x) * 0.005 + sx;
				b.vy += (ay / nc - b.vy) * 0.02 + (cy / nc - b.y) * 0.005 + sy;
			}

			const spd = Math.hypot(b.vx, b.vy);
			if (spd > maxSpeed) { b.vx = b.vx / spd * maxSpeed; b.vy = b.vy / spd * maxSpeed; }

			b.x = (b.x + b.vx + cols) % cols;
			b.y = (b.y + b.vy + rows) % rows;
		}

		const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(' '));

		for (const b of boids) {
			const x = Math.floor(b.x), y = Math.floor(b.y);
			const angle = Math.atan2(-b.vy, b.vx); // negate vy: screen y-axis points down
			const di = Math.round(((angle / (Math.PI * 2)) * 8 + 8)) % 8;
			const spd = Math.hypot(b.vx, b.vy) / maxSpeed;
			const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, 0.3 + spd * 0.7);
			grid[y]![x] = style({ fg: color })(DIRS[di]!);
		}

		return grid.map(r => r.join('')).join('\n');
	};
}

// ─── Preset 14: Flow Field Particles ────────────────────────────────────────

export interface FlowFieldOptions {
	cols?: number;      // default 28
	rows?: number;      // default 8
	count?: number;     // default 40
	timeScale?: number; // default 0.015 — intentionally slower than renderNoiseField's 0.025
}

export function createFlowField(opts?: FlowFieldOptions): (animState: AnimationState, theme: ThemeConfig) => string {
	const cols = opts?.cols ?? 28;
	const rows = opts?.rows ?? 8;
	const count = opts?.count ?? 40;
	const timeScale = opts?.timeScale ?? 0.015;

	interface Particle {
		x: number; y: number;
		vx: number; vy: number;
		trail: Array<{ x: number; y: number }>;
	}

	const particles: Particle[] = Array.from({ length: count }, () => ({
		x: Math.random() * cols,
		y: Math.random() * rows,
		vx: 0, vy: 0,
		trail: [],
	}));

	const DIRS = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'] as const;

	return (animState: AnimationState, theme: ThemeConfig): string => {
		const t = animState.tickCount * timeScale;

		for (const p of particles) {
			// Same trig noise formula as renderNoiseField, but with FlowField's own timeScale
			const fx = p.x, fy = p.y;
			const noiseVal = (
				Math.sin(fx * 0.7 + t) * Math.cos(fy * 0.5 - t * 0.3) +
				Math.cos(fx * 0.3 + t * 0.7) * Math.sin(fy * 0.8 + t * 0.2) +
				Math.sin((fx + fy) * 0.4 + t * 0.5)
			) / 3;
			const angle = noiseVal * Math.PI;

			p.vx = p.vx * 0.85 + Math.cos(angle) * 0.25;
			p.vy = p.vy * 0.85 + Math.sin(angle) * 0.25;

			p.trail.push({ x: Math.floor(p.x), y: Math.floor(p.y) });
			if (p.trail.length > 4) p.trail.shift();

			p.x = (p.x + p.vx + cols) % cols;
			p.y = (p.y + p.vy + rows) % rows;
		}

		const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(' '));
		const brightnessGrid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

		for (const p of particles) {
			const angle = Math.atan2(-p.vy, p.vx); // negate vy: screen y-axis points down
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
