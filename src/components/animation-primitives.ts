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
    const progress = y / (rows - 1); // 0 = horizon, 1 = nearest
    const tColor = progress * 0.8 + 0.2;

    // Horizontal lines: perspective spacing — denser near bottom
    const spacing = Math.max(1, Math.round(8 - progress * 6));
    const phase = (tick * speed) % spacing;
    if (Math.round(y + phase) % spacing === 0) {
      for (let x = 0; x < cols; x++) {
        grid[y][x] = style({ fg: lerpColor(theme.breathBaseColor, theme.breathPeakColor, tColor) })('─');
        isHoriz[y][x] = true;
      }
    }

    // Vertical lines converging to vanishing point at top-center
    for (let vi = 0; vi <= numVLines; vi++) {
      const edgeX = (vi / numVLines) * cols;
      const vx = Math.round(VX + (edgeX - VX) * progress);
      if (vx >= 0 && vx < cols) {
        const vColor = lerpColor(theme.breathBaseColor, theme.breathPeakColor, tColor * 0.85);
        grid[y][vx] = style({ fg: vColor })(isHoriz[y][vx] ? '┼' : '│');
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
