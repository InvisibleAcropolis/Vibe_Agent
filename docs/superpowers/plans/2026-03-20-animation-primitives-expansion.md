# Animation Primitives Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 14 new animation preset functions to `src/components/animation-primitives.ts` and re-export them from `src/components/style-primitives.ts`.

**Architecture:** All 14 presets are appended to the existing `animation-primitives.ts` file. Stateless presets (`renderPlasma`, `renderSynthgrid`, `renderNoiseField`) are pure functions of `tickCount`. All other presets are factory functions (`createX`) returning closures that own their simulation state. Every preset returns a multi-line ANSI string keyed to the active theme via `lerpColor(breathBaseColor, breathPeakColor, t)`.

**Tech Stack:** TypeScript (strict), no new npm dependencies. Build: `npm run build` (tsc --noEmit). Verification: build passes + manual visual smoke test.

---

## Files to Modify

| File | Action |
|---|---|
| `src/components/animation-primitives.ts` | Append 14 presets after existing 5 |
| `src/components/style-primitives.ts` | Append 14 new re-exports to existing block |

**Read before starting:**
- `src/components/animation-primitives.ts` — understand existing pattern (imports, glyph pool, style calls)
- `src/components/style-primitives.ts` — understand existing re-export block structure
- `src/themes/index.ts` — confirm `lerpColor` is exported (done in prior session)
- `src/animation-engine.ts` — confirm `AnimationState` fields available: `tickCount`, `spinnerFrame`, `breathPhase`
- Spec: `docs/superpowers/specs/2026-03-20-animation-primitives-expansion-design.md`

---

## Task 1: Stateless Renders — Plasma, Synthgrid, NoiseField

**Files:**
- Modify: `src/components/animation-primitives.ts` (append)

These three are pure functions of `tickCount`. No closure state.

- [ ] **Step 1: Append `renderPlasma` to `animation-primitives.ts`**

```typescript
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
```

- [ ] **Step 2: Append `renderSynthgrid`**

```typescript
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
```

- [ ] **Step 3: Append `renderNoiseField`**

```typescript
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
```

- [ ] **Step 4: Build to verify no type errors**

Run: `npm run build`
Expected: no output (clean build)

- [ ] **Step 5: Commit**

```bash
git add src/components/animation-primitives.ts
git commit -m "feat: add renderPlasma, renderSynthgrid, renderNoiseField presets"
```

---

## Task 2: Doom Fire + Spectrum Bars

**Files:**
- Modify: `src/components/animation-primitives.ts` (append)

- [ ] **Step 1: Append `createDoomFire`**

```typescript
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
    // Propagate fire upward
    for (let y = 1; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const rand = Math.floor(Math.random() * 3); // 0, 1, or 2
        const srcHeat = buf[y * W + x]!;
        const dstX = Math.max(0, Math.min(W - 1, x - rand + 1));
        buf[(y - 1) * W + dstX] = Math.max(0, srcHeat - (rand & 1));
      }
    }
    // Randomly cool bottom row to create flame shape variation
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
```

- [ ] **Step 2: Append `createSpectrumBars`**

```typescript
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
    // Advance phases
    const vals = phases.map((ph, i) => {
      phases[i] = ph + (0.06 + i * 0.004) * speed;
      return (Math.sin(phases[i]!) * 0.5 + 0.5) * 0.9 + 0.05;
    });

    const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(''));

    for (let x = 0; x < cols; x++) {
      const v = vals[x]!;
      const filledCells = v * rows;
      const fullRows = Math.floor(filledCells);
      const frac = filledCells - fullRows;

      for (let y = 0; y < rows; y++) {
        const fromBottom = rows - 1 - y;
        const t = v;
        const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, t);

        if (fromBottom < fullRows) {
          grid[y][x] = style({ fg: color })('█');
        } else if (fromBottom === fullRows) {
          const eighthIdx = Math.round(frac * 8);
          grid[y][x] = eighthIdx === 0
            ? style({ fg: DIM })('·')
            : style({ fg: color })(EIGHTHS[eighthIdx]!);
        } else {
          grid[y][x] = style({ fg: DIM })('·');
        }
      }
    }

    return grid.map(r => r.join('')).join('\n');
  };
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add src/components/animation-primitives.ts
git commit -m "feat: add createDoomFire, createSpectrumBars presets"
```

---

## Task 3: Starfield + Vortex

**Files:**
- Modify: `src/components/animation-primitives.ts` (append)

- [ ] **Step 1: Append `createStarfield`**

```typescript
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
  const stars: Star[] = Array.from({ length: count }, () => ({
    x: (Math.random() - 0.5) * 2,
    y: (Math.random() - 0.5) * 2,
    z: Math.random(),
  }));

  const STAR_CHARS = ['.', '·', '✦', '★'] as const;

  function respawn(s: Star): void {
    s.x = (Math.random() - 0.5) * 2;
    s.y = (Math.random() - 0.5) * 2;
    s.z = 1;
  }

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
```

- [ ] **Step 2: Append `createVortex`**

```typescript
// ─── Preset 12: Vortex / Orbital Spiral ─────────────────────────────────────

export interface VortexOptions {
  cols?: number;         // default 24
  rows?: number;         // default 10
  count?: number;        // default 35
  pullStrength?: number; // default 0.04
}

export function createVortex(opts?: VortexOptions): (animState: AnimationState, theme: ThemeConfig) => string {
  const cols = opts?.cols ?? 24;
  const rows = opts?.rows ?? 10;
  const count = opts?.count ?? 35;
  const pullStrength = opts?.pullStrength ?? 0.04;

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
      p.angle += p.angularSpeed * (baseRadius / Math.max(p.radius, 0.5));
      p.radius -= pullStrength;
      if (p.radius <= 0.3) Object.assign(p, spawnParticle());

      const px = Math.floor(cx + p.radius * Math.cos(p.angle));
      const py = Math.floor(cy + p.radius * Math.sin(p.angle) * 0.5); // half-aspect

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
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add src/components/animation-primitives.ts
git commit -m "feat: add createStarfield, createVortex presets"
```

---

## Task 4: Boids + Flow Field

**Files:**
- Modify: `src/components/animation-primitives.ts` (append)

- [ ] **Step 1: Append `createBoids`**

```typescript
// ─── Preset 13: Boids Flocking ───────────────────────────────────────────────

export interface BoidsOptions {
  cols?: number;      // default 28
  rows?: number;      // default 8
  count?: number;     // default 25
  maxSpeed?: number;  // default 0.5
  radius?: number;    // default 6.0 — neighborhood radius
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
      let ax = 0, ay = 0; // alignment
      let cx = 0, cy = 0; // cohesion
      let sx = 0, sy = 0; // separation
      let nc = 0;

      for (const o of boids) {
        if (o === b) continue;
        const dx = o.x - b.x, dy = o.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d < radius && d > 0) {
          nc++;
          ax += o.vx; ay += o.vy;
          cx += o.x; cy += o.y;
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
      if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
      const angle = Math.atan2(b.vy, b.vx);
      const di = Math.round(((angle / (Math.PI * 2)) * 8 + 8)) % 8;
      const spd = Math.hypot(b.vx, b.vy) / maxSpeed;
      const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, 0.3 + spd * 0.7);
      grid[y]![x] = style({ fg: color })(DIRS[di]!);
    }

    return grid.map(r => r.join('')).join('\n');
  };
}
```

- [ ] **Step 2: Append `createFlowField`**

```typescript
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
      // Same trig noise formula as renderNoiseField
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
      const angle = Math.atan2(p.vy, p.vx);
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
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add src/components/animation-primitives.ts
git commit -m "feat: add createBoids, createFlowField presets"
```

---

## Task 5: Game of Life + Water Ripple

**Files:**
- Modify: `src/components/animation-primitives.ts` (append)

- [ ] **Step 1: Append `createGameOfLife`**

```typescript
// ─── Preset 15: Game of Life ─────────────────────────────────────────────────

export interface GameOfLifeOptions {
  cols?: number;         // default 24
  rows?: number;         // default 8
  density?: number;      // default 0.35
  ticksPerStep?: number; // default 3
}

export function createGameOfLife(opts?: GameOfLifeOptions): (animState: AnimationState, theme: ThemeConfig) => string {
  const cols = opts?.cols ?? 24;
  const rows = opts?.rows ?? 8;
  const density = opts?.density ?? 0.35;
  const ticksPerStep = opts?.ticksPerStep ?? 3;

  function randomSeed(): Uint8Array {
    const g = new Uint8Array(cols * rows);
    for (let i = 0; i < g.length; i++) g[i] = Math.random() < density ? 1 : 0;
    return g;
  }

  let grid = randomSeed();
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
        const born = (!alive && n === 3) ? 1 : 0;
        const survives = (alive && (n === 2 || n === 3)) ? 1 : 0;
        next[y * cols + x] = born | survives;
        nextAge[y * cols + x] = next[y * cols + x] ? Math.min(255, age[y * cols + x]! + 1) : 0;
        if (next[y * cols + x] !== alive) changed = true;
      }
    }

    grid = next;
    age = nextAge;
    gen++;
    stagnantTicks = changed ? 0 : stagnantTicks + 1;

    if (stagnantTicks > 60 || gen > 400) {
      grid = randomSeed();
      age = new Uint8Array(cols * rows);
      gen = 0;
      stagnantTicks = 0;
    }
  }

  const LIVE_CHARS = ['░', '▒', '▓', '█'] as const;

  return (animState: AnimationState, theme: ThemeConfig): string => {
    if (animState.tickCount !== lastTick) {
      lastTick = animState.tickCount;
      if (animState.tickCount % ticksPerStep === 0) step();
    }

    const rows2: string[] = [];
    for (let y = 0; y < rows; y++) {
      let row = '';
      for (let x = 0; x < cols; x++) {
        const alive = grid[y * cols + x]!;
        if (alive) {
          const a = age[y * cols + x]!;
          const t = Math.min(1, a / 20);
          const charIdx = Math.min(LIVE_CHARS.length - 1, Math.floor(t * LIVE_CHARS.length));
          const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, t);
          row += style({ fg: color })(LIVE_CHARS[charIdx]!);
        } else {
          row += ' ';
        }
      }
      rows2.push(row);
    }
    return rows2.join('\n');
  };
}
```

- [ ] **Step 2: Append `createWaterRipple`**

```typescript
// ─── Preset 16: Water Ripple ─────────────────────────────────────────────────

export interface WaterRippleOptions {
  cols?: number;             // default 24
  rows?: number;             // default 8
  damping?: number;          // default 0.98
  disturbInterval?: number;  // default 40
}

export function createWaterRipple(opts?: WaterRippleOptions): (animState: AnimationState, theme: ThemeConfig) => string {
  const cols = opts?.cols ?? 24;
  const rows = opts?.rows ?? 8;
  const damping = opts?.damping ?? 0.98;
  const disturbInterval = opts?.disturbInterval ?? 40;

  let cur = new Float32Array(cols * rows);
  let prv = new Float32Array(cols * rows);
  let lastTick = -1;
  let ticksSinceDisturbance = 0;

  const PAL = [' ', '·', ':', ';', '|', '+', '=', '*', '#', '@'] as const;

  return (animState: AnimationState, theme: ThemeConfig): string => {
    if (animState.tickCount === lastTick) {
      // Render only, no tick
    } else {
      lastTick = animState.tickCount;
      ticksSinceDisturbance++;

      if (ticksSinceDisturbance >= disturbInterval) {
        ticksSinceDisturbance = 0;
        const rx = 1 + Math.floor(Math.random() * (cols - 2));
        const ry = 1 + Math.floor(Math.random() * (rows - 2));
        cur[ry * cols + rx] = 180;
      }

      const next = new Float32Array(cols * rows);
      for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
          next[y * cols + x] = (
            cur[(y - 1) * cols + x] +
            cur[(y + 1) * cols + x] +
            cur[y * cols + x - 1] +
            cur[y * cols + x + 1]
          ) / 2 - prv[y * cols + x];
          next[y * cols + x] *= damping;
        }
      }
      prv = cur;
      cur = next;
    }

    const rowStrings: string[] = [];
    for (let y = 0; y < rows; y++) {
      let row = '';
      for (let x = 0; x < cols; x++) {
        const v = Math.abs(cur[y * cols + x]!);
        const t = Math.min(1, v / 120);
        if (t < 0.04) {
          row += style({ fg: '#1a3348' })('·');
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
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add src/components/animation-primitives.ts
git commit -m "feat: add createGameOfLife, createWaterRipple presets"
```

---

## Task 6: Matrix Rain + Laser Scan

**Files:**
- Modify: `src/components/animation-primitives.ts` (append)

- [ ] **Step 1: Append `createMatrixRain`**

```typescript
// ─── Preset 17: Matrix Rain ──────────────────────────────────────────────────

export interface MatrixRainOptions {
  cols?: number;           // default 12
  rows?: number;           // default 8
  mutationRate?: number;   // default 0.05
  speedMin?: number;       // default 0.3
  speedMax?: number;       // default 1.2
  trailLengthMin?: number; // default 6
  trailLengthMax?: number; // default 18
}

export function createMatrixRain(opts?: MatrixRainOptions): (animState: AnimationState, theme: ThemeConfig) => string {
  const cols = opts?.cols ?? 12;
  const rows = opts?.rows ?? 8;
  const mutationRate = opts?.mutationRate ?? 0.05;
  const speedMin = opts?.speedMin ?? 0.3;
  const speedMax = opts?.speedMax ?? 1.2;
  const trailLengthMin = opts?.trailLengthMin ?? 6;
  const trailLengthMax = opts?.trailLengthMax ?? 18;

  // Half-width katakana U+FF66–U+FF9D + digits
  const KATAKANA = Array.from({ length: 0xFF9D - 0xFF66 + 1 }, (_, i) => String.fromCodePoint(0xFF66 + i));
  const GLYPH_SET = [...KATAKANA, ...'0123456789'.split('')];

  function randGlyph(): string { return GLYPH_SET[Math.floor(Math.random() * GLYPH_SET.length)]!; }

  // Per-cell glyph grid
  const glyphs: string[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, randGlyph)
  );

  interface Column {
    headY: number;
    speed: number;
    trailLength: number;
    tickAcc: number;
    active: boolean;
    restartDelay: number;
  }

  function spawnCol(): Column {
    return {
      headY: -Math.floor(Math.random() * rows),
      speed: speedMin + Math.random() * (speedMax - speedMin),
      trailLength: trailLengthMin + Math.floor(Math.random() * (trailLengthMax - trailLengthMin)),
      tickAcc: 0,
      active: true,
      restartDelay: 0,
    };
  }

  const columns: Column[] = Array.from({ length: cols }, spawnCol);

  return (_animState: AnimationState, theme: ThemeConfig): string => {
    // Mutate glyphs
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (Math.random() < mutationRate) glyphs[r]![c] = randGlyph();
      }
    }

    // Advance column heads
    for (const col of columns) {
      if (!col.active) {
        col.restartDelay--;
        if (col.restartDelay <= 0) Object.assign(col, spawnCol());
        continue;
      }
      col.tickAcc += col.speed;
      while (col.tickAcc >= 1) { col.headY++; col.tickAcc--; }
      if (col.headY >= rows + col.trailLength) {
        col.active = false;
        col.restartDelay = 20 + Math.floor(Math.random() * 60);
      }
    }

    const rowStrings: string[] = [];
    for (let y = 0; y < rows; y++) {
      let row = '';
      for (let x = 0; x < cols; x++) {
        const col = columns[x]!;
        const glyph = glyphs[y]![x]!;

        if (!col.active) {
          row += style({ fg: '#1a3348' })(glyph);
          continue;
        }

        const dist = col.headY - y;
        if (dist < 0) {
          row += style({ fg: '#1a3348' })(glyph);
        } else if (dist === 0) {
          // Head — peak color (brightest)
          row += style({ fg: theme.breathPeakColor })(glyph);
        } else if (dist < col.trailLength) {
          const t = 1 - dist / col.trailLength;
          const color = lerpColor('#1a3348', theme.breathBaseColor, t);
          row += style({ fg: color })(glyph);
        } else {
          row += style({ fg: '#1a3348' })(glyph);
        }
      }
      rowStrings.push(row);
    }
    return rowStrings.join('\n');
  };
}
```

- [ ] **Step 2: Append `createLaserScan`**

```typescript
// ─── Preset 18: Laser Scan Beam ──────────────────────────────────────────────

export interface LaserScanOptions {
  cols?: number;       // default 28
  rows?: number;       // default 6
  speed?: number;      // default 0.5 — cells per tick
  beamWidth?: number;  // default 5 — Gaussian σ
}

export function createLaserScan(opts?: LaserScanOptions): (animState: AnimationState, theme: ThemeConfig) => string {
  const cols = opts?.cols ?? 28;
  const rows = opts?.rows ?? 6;
  const speed = opts?.speed ?? 0.5;
  const beamWidth = opts?.beamWidth ?? 5;

  // Static randomized glyph grid
  const data: string[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ANIMATION_GLYPHS[Math.floor(Math.random() * ANIMATION_GLYPHS.length)]!)
  );

  let beamPos = 0;
  let lastBeamCol = -1;

  return (_animState: AnimationState, theme: ThemeConfig): string => {
    beamPos = (beamPos + speed) % (cols + beamWidth * 2);
    // Re-randomize the column the beam just passed through
    const currentCol = Math.floor(beamPos - beamWidth);
    if (currentCol !== lastBeamCol && currentCol >= 0 && currentCol < cols) {
      for (let y = 0; y < rows; y++) {
        data[y]![currentCol] = ANIMATION_GLYPHS[Math.floor(Math.random() * ANIMATION_GLYPHS.length)]!;
      }
      lastBeamCol = currentCol;
    }

    const rowStrings: string[] = [];
    for (let y = 0; y < rows; y++) {
      let row = '';
      for (let x = 0; x < cols; x++) {
        const glyph = data[y]![x]!;
        const dist = x - (beamPos - beamWidth); // offset so beam enters from left
        const intensity = Math.exp(-(dist * dist) / (2 * beamWidth * beamWidth));
        if (intensity < 0.04) {
          row += style({ fg: '#1a3348' })(glyph);
        } else {
          const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, intensity);
          row += style({ fg: color })(glyph);
        }
      }
      rowStrings.push(row);
    }
    return rowStrings.join('\n');
  };
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add src/components/animation-primitives.ts
git commit -m "feat: add createMatrixRain, createLaserScan presets"
```

---

## Task 7: Lissajous

**Files:**
- Modify: `src/components/animation-primitives.ts` (append)

- [ ] **Step 1: Append `createLissajous`**

```typescript
// ─── Preset 19: Lissajous Curve ──────────────────────────────────────────────

export interface LissajousOptions {
  cols?: number;         // default 24
  rows?: number;         // default 12
  a?: number;            // default 3 — x frequency
  b?: number;            // default 2 — y frequency
  deltaSpeed?: number;   // default 0.008 — phase shift per tick
  trailPoints?: number;  // default 300 — curve samples per frame
  decay?: number;        // default 0.92 — density buffer decay per tick
}

export function createLissajous(opts?: LissajousOptions): (animState: AnimationState, theme: ThemeConfig) => string {
  const cols = opts?.cols ?? 24;
  const rows = opts?.rows ?? 12;
  const a = opts?.a ?? 3;
  const b = opts?.b ?? 2;
  const deltaSpeed = opts?.deltaSpeed ?? 0.008;
  const trailPoints = opts?.trailPoints ?? 300;
  const decay = opts?.decay ?? 0.92;

  const A = cols / 2 - 1; // x amplitude in cells
  const B = rows / 2 - 1; // y amplitude in cells
  const cx = cols / 2;
  const cy = rows / 2;

  const density = new Float32Array(cols * rows);
  let delta = 0;

  const CHARS = ['·', '•', '●', '◉'] as const;

  return (_animState: AnimationState, theme: ThemeConfig): string => {
    delta += deltaSpeed;

    // Decay existing density
    for (let i = 0; i < density.length; i++) density[i]! > 0 && (density[i] = density[i]! * decay);

    // Sample curve and accumulate density
    for (let i = 0; i < trailPoints; i++) {
      const param = (i / trailPoints) * Math.PI * 2;
      const px = cx + A * Math.sin(a * param + delta);
      const py = cy + B * Math.sin(b * param);
      const ix = Math.round(px), iy = Math.round(py);
      if (ix >= 0 && ix < cols && iy >= 0 && iy < rows) {
        density[iy * cols + ix] = Math.min(1, (density[iy * cols + ix]! + 0.15));
      }
    }

    const rowStrings: string[] = [];
    for (let y = 0; y < rows; y++) {
      let row = '';
      for (let x = 0; x < cols; x++) {
        const d = density[y * cols + x]!;
        if (d < 0.05) {
          row += ' ';
        } else {
          const charIdx = Math.min(CHARS.length - 1, Math.floor(d * CHARS.length));
          const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, d);
          row += style({ fg: color })(CHARS[charIdx]!);
        }
      }
      rowStrings.push(row);
    }
    return rowStrings.join('\n');
  };
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add src/components/animation-primitives.ts
git commit -m "feat: add createLissajous preset"
```

---

## Task 8: Re-exports + Final Build

**Files:**
- Modify: `src/components/style-primitives.ts`

- [ ] **Step 1: Append new exports to `style-primitives.ts`**

Find the existing animation presets export block at the bottom of the file and replace it with:

```typescript
// Animation presets — drop-in reusable animations keyed to the active theme
export {
  createGlyphCascade,
  renderPulseMeter,
  renderOrbitArc,
  renderDataRain,
  renderWaveSweep,
  // Expansion presets
  renderPlasma,
  renderSynthgrid,
  renderNoiseField,
  createDoomFire,
  createSpectrumBars,
  createStarfield,
  createVortex,
  createBoids,
  createFlowField,
  createGameOfLife,
  createWaterRipple,
  createMatrixRain,
  createLaserScan,
  createLissajous,
} from "./animation-primitives.js";
export type {
  GlyphCascadeOptions,
  PulseMeterOptions,
  OrbitArcOptions,
  DataRainOptions,
  WaveSweepOptions,
  // Expansion types
  PlasmaOptions,
  SynthgridOptions,
  NoiseFieldOptions,
  DoomFireOptions,
  SpectrumBarsOptions,
  StarfieldOptions,
  VortexOptions,
  BoidsOptions,
  FlowFieldOptions,
  GameOfLifeOptions,
  WaterRippleOptions,
  MatrixRainOptions,
  LaserScanOptions,
  LissajousOptions,
} from "./animation-primitives.js";
```

- [ ] **Step 2: Final build — full verification**

Run: `npm run build`
Expected: clean (zero errors, zero warnings)

- [ ] **Step 3: Final commit**

```bash
git add src/components/style-primitives.ts
git commit -m "feat: re-export 14 new animation presets from style-primitives"
```

---

## Verification Checklist

After all tasks complete:

- [ ] `npm run build` passes cleanly
- [ ] `animation-primitives.ts` contains exactly 19 presets (5 original + 14 new)
- [ ] `style-primitives.ts` re-exports all 19 functions and their option types
- [ ] All `createX` functions return `(animState: AnimationState, theme: ThemeConfig) => string`
- [ ] All `renderX` functions have signature `(animState: AnimationState, theme: ThemeConfig, opts?) => string`
- [ ] No external npm packages imported
