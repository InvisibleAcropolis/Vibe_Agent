# Animation Primitives Expansion — Design Spec

**Date:** 2026-03-20
**Status:** Approved
**Scope:** Add 14 new animation presets to `src/components/animation-primitives.ts`

---

## Goal

Expand the existing 5-preset animation library into a comprehensive drop-in collection of 19 total presets. The file is intentionally large — it is a library, not a component. Presets are designed to be copy-pasted and refined into page-specific widgets.

---

## File Structure

| File | Change |
|---|---|
| `src/components/animation-primitives.ts` | Add 14 new presets (append after existing 5) |
| `src/components/style-primitives.ts` | Add re-exports for all 14 new symbols |

No new files. No changes to `src/themes/index.ts` (already done).

---

## API Conventions

### Stateful presets — `createX(opts?)` factory

For animations that maintain internal simulation buffers (particles, grids, accumulators) that **cannot** be derived from `AnimationState.tickCount` alone.

```typescript
export function createX(opts?: XOptions): (animState: AnimationState, theme: ThemeConfig) => string
```

The returned closure owns its state. Callers instantiate once (module scope or constructor), call each tick.

### Stateless presets — `renderX(animState, theme, opts?)`

For animations that are **pure functions of `tickCount`** — no history needed.

```typescript
export function renderX(animState: AnimationState, theme: ThemeConfig, opts?: XOptions): string
```

---

## The 14 New Presets

### 1. `createDoomFire(opts?)` — Stateful

**Algorithm:** Fabien Sanglard's Doom PSX fire. Flat `Uint8Array` heat buffer `[W×H]`, values 0–255. Bottom row initialized to 255 (max heat). Each tick, for every pixel `(x, y)` above the bottom row:
```
rand = Math.floor(Math.random() * 3)   // 0, 1, or 2
dstX = clamp(x - rand + 1, 0, W-1)    // jitter ±1 horizontally
buf[(y-1)*W + dstX] = max(0, buf[y*W + x] - (rand & 1))
```
`rand & 1` gives 0 or 1 — heat decays by exactly 0 or 1 per step (integer subtraction, NOT a multiplier). The `coolingStrength` option controls how aggressively to reseed the bottom row each tick: `coolingStrength` fraction of bottom-row cells are set to 0 randomly each frame (default 0.15 — makes flame edges irregular).

**Options:**
```typescript
export interface DoomFireOptions {
  width?: number;          // default 20
  height?: number;         // default 8
  coolingStrength?: number; // default 0.15 — fraction of bottom-row cells zeroed per tick (0=steady, 1=fast die)
}
```

**Render:** Map heat 0–255 → char from `' .,:;+=ox#%@'`, color via `lerpColor(breathBaseColor, breathPeakColor, heat/255)` — but override: near-zero heat uses dim `#1a3348`, mid-range lerps through red/orange zone toward peak.

**Returns:** Multi-line string, `height` rows × `width` chars.

---

### 2. `createSpectrumBars(opts?)` — Stateful

**Algorithm:** Array of `cols` bar values (0–1) driven by sine waves at slightly different phases (simulates a live audio visualizer without real audio data). Each bar has an independent phase accumulator that increments at a different rate per tick.

**Options:**
```typescript
export interface SpectrumBarsOptions {
  cols?: number;    // default 12
  rows?: number;    // default 6
  speed?: number;   // default 1.0 — multiplier on phase increment per tick
}
```

**Render:** Eighth-block characters `▁▂▃▄▅▆▇█` for sub-cell height precision. Each bar colored with `lerpColor(breathBaseColor, breathPeakColor, barHeight)`. Empty cells rendered as `·` in dim `#1a3348`.

**Returns:** Multi-line string, `rows` rows × `cols` chars.

---

### 3. `renderPlasma(animState, theme, opts?)` — Stateless

**Algorithm:** Sum of four sine waves per cell — horizontal bands, vertical bands, diagonal bands, circular ripple from a moving center point. All driven by `tickCount * timeScale`.

```
v = sin(x*freq + t) + sin(y*freq + t*0.7) + sin((x+y)*freq2 + t*0.5) + sin(sqrt(cx²+cy²)*freq3 + t)
normalized = (v + 4) / 8  // v ∈ [-4,4]
```

**Options:**
```typescript
export interface PlasmaOptions {
  width?: number;   // default 24
  height?: number;  // default 8
  freq?: number;    // default 0.35 — spatial frequency
  timeScale?: number; // default 0.06 — tick→time multiplier
}
```

**Render:** `normalized` → `lerpColor(breathBaseColor, breathPeakColor, normalized)`, char from `'░▒▓█'` by intensity.

**Returns:** Multi-line string.

---

### 4. `createMatrixRain(opts?)` — Stateful

**Algorithm:** Per-column state: `headY` (fractional, incremented by `speed` each tick), `trailLength`, `restartDelay`. Global `glyphs[row][col]` array of random chars that mutate independently at low probability each tick. Illumination is a traveling wave — glyphs don't move, brightness moves.

**Glyph set:** Half-width katakana U+FF66–U+FF9D mixed with digits 0–9.

**Options:**
```typescript
export interface MatrixRainOptions {
  cols?: number;          // default 12
  rows?: number;          // default 8
  mutationRate?: number;  // default 0.05 — probability per glyph per tick of mutation
  speedMin?: number;      // default 0.3 — minimum head fall speed (rows/tick)
  speedMax?: number;      // default 1.2 — maximum head fall speed (rows/tick)
  trailLengthMin?: number; // default 6  — shortest possible trail
  trailLengthMax?: number; // default 18 — longest possible trail
}
// Per-column speed and trailLength are randomized at spawn within [speedMin,speedMax] and [trailLengthMin,trailLengthMax].
```

**Render:** Head cell = `breathPeakColor` (bright white-ish). Trail fades from `breathPeakColor` → `breathBaseColor` → `#1a3348` by distance from head. Inactive cells: dim `#1a3348`.

**Returns:** Multi-line string.

---

### 5. `createGameOfLife(opts?)` — Stateful

**Algorithm:** B3/S23 Conway's Game of Life. Double-buffered `Uint8Array[W×H]` with toroidal wrapping. Tracks cell `age` (frames alive) separately. Auto-reseeds when grid stagnates (no change for 60+ ticks) or after 400 generations.

**Options:**
```typescript
export interface GameOfLifeOptions {
  cols?: number;       // default 24
  rows?: number;       // default 8
  density?: number;    // default 0.35 — initial fill probability
  ticksPerStep?: number; // default 3 — GoL steps per animation tick (speed)
}
```

**Render:** Living cells: `lerpColor(breathBaseColor, breathPeakColor, min(age/20, 1))` — young cells at base color, mature cells at peak. Dead cells: space. Chars: `█` for mature, `▓` for mid-age, `░` for newborn (age < 3).

**Returns:** Multi-line string.

---

### 6. `createStarfield(opts?)` — Stateful

**Algorithm:** N stars with 3D coordinates `{x, y, z}`. Spawn: `x` random in `[-1, 1]`, `y` random in `[-1, 1]`, `z` random in `(0, 1]`. Each tick: `z -= speed`. Project to 2D: `sx = floor(x/z * fovX + W/2)`, `sy = floor(y/z * fovY + H/2)` where `fovX = W/2` and `fovY = H`. Respawn with fresh random `x`, `y`, `z=1` when `z <= 0` or projected position leaves bounds. Brightness = `1 - z`.

**Options:**
```typescript
export interface StarfieldOptions {
  cols?: number;    // default 24
  rows?: number;    // default 8
  count?: number;   // default 80 — number of stars
  speed?: number;   // default 0.015
}
```

**Render:** Brightness 0–1 → char: `'.·✦★'`, color via `lerpColor(breathBaseColor, breathPeakColor, brightness)`. Multiple stars mapping to same cell: brightest wins.

**Returns:** Multi-line string.

---

### 7. `createWaterRipple(opts?)` — Stateful

**Algorithm:** Two `Float32Array[W×H]` buffers (current, previous). Each tick:
```
next[y][x] = (cur[y-1][x] + cur[y+1][x] + cur[y][x-1] + cur[y][x+1]) / 2 - prev[y][x]
next[y][x] *= damping  // 0.98
```
Periodic disturbances: random cell set to amplitude 180 every ~40 ticks.

**Options:**
```typescript
export interface WaterRippleOptions {
  cols?: number;          // default 24
  rows?: number;          // default 8
  damping?: number;       // default 0.98
  disturbInterval?: number; // default 40 — ticks between raindrop events
}
```

**Render:** `abs(value)` → char from `' ·:;|+=*#@'`, color via `lerpColor` — wave crests at `breathPeakColor`, troughs at dim.

**Returns:** Multi-line string.

---

### 8. `renderSynthgrid(animState, theme, opts?)` — Stateless

**Algorithm:** Perspective grid. Horizontal lines at depths that scroll toward the viewer (`phase = (tickCount * speed) % lineSpacing`). Vertical lines converge from screen edges toward a vanishing point at top-center. Pure math from `tickCount`.

**Options:**
```typescript
export interface SynthgridOptions {
  cols?: number;       // default 36
  rows?: number;       // default 10
  speed?: number;      // default 0.4 — scroll speed
  numVLines?: number;  // default 7 — converging verticals
}
```

**Render:** `─` for horizontals, `│` for verticals, `┼` at intersections. Color gradient: dim `breathBaseColor` at top (far/horizon), bright `breathPeakColor` at bottom (near). Empty cells: space.

**Returns:** Multi-line string.

---

### 9. `createBoids(opts?)` — Stateful

**Algorithm:** N boids with `{x, y, vx, vy}`. Three steering rules per tick, evaluated within neighborhood radius R:
1. **Separation** — steer away from nearby boids (strong, short range)
2. **Alignment** — match average velocity of neighbors
3. **Cohesion** — steer toward average position of neighbors

Speed clamped to `maxSpeed`. Toroidal wrapping at boundaries.

**Options:**
```typescript
export interface BoidsOptions {
  cols?: number;       // default 28
  rows?: number;       // default 8
  count?: number;      // default 25
  maxSpeed?: number;   // default 0.5
  radius?: number;     // default 6.0 — neighborhood radius for all three rules
}
// Separation acts at range radius*0.4, alignment and cohesion at full radius.
```

**Render:** `→↗↑↖←↙↓↘` directional chars based on velocity angle. Color via `lerpColor(breathBaseColor, breathPeakColor, speed/maxSpeed)`. Empty cells: space.

**Returns:** Multi-line string.

---

### 10. `createVortex(opts?)` — Stateful

**Algorithm:** N particles in polar coordinates `{angle, radius, angularSpeed}`. `baseRadius = min(cols, rows*2) / 2` (derived from widget dimensions). Each tick:
```
angle += angularSpeed * (baseRadius / max(radius, 0.5))  // faster near center
radius -= pullStrength
```
Respawn at `radius = baseRadius * (0.7 + random()*0.3)`, fresh random `angle` and `angularSpeed = 0.03 + random()*0.05`.

**Options:**
```typescript
export interface VortexOptions {
  cols?: number;         // default 24
  rows?: number;         // default 10
  count?: number;        // default 35
  pullStrength?: number; // default 0.04 — inward drift per tick
}
```

**Render:** Proximity to center → char `'✦◉•∙·'`, color from dim at outer edge to `breathPeakColor` at center. Half-aspect correction (`sin * 0.5`) for terminal char proportions.

**Returns:** Multi-line string.

---

### 11. `renderNoiseField(animState, theme, opts?)` — Stateless

**Algorithm:** Smooth 2D animated noise via sum of trigonometric functions (no external library):
```
v = (sin(x*0.7 + t) * cos(y*0.5 - t*0.3) +
     cos(x*0.3 + t*0.7) * sin(y*0.8 + t*0.2) +
     sin((x+y)*0.4 + t*0.5)) / 3
```
`t = tickCount * timeScale`. Produces organic turbulence entirely from math.

**Options:**
```typescript
export interface NoiseFieldOptions {
  cols?: number;       // default 24
  rows?: number;       // default 8
  timeScale?: number;  // default 0.025
  freqScale?: number;  // default 1.0 — spatial frequency multiplier
}
```

**Render:** `v` is in `[-1, 1]`; normalize with `normalized = (v + 1) / 2` before use. `normalized` → `lerpColor(breathBaseColor, breathPeakColor, normalized)`, char from `'░▒▓█'` by `floor(normalized * 4)` clamped to `[0,3]`.

**Returns:** Multi-line string.

---

### 12. `createFlowField(opts?)` — Stateful

**Algorithm:** N particles with `{x, y, vx, vy}`. Each tick: compute local angle using the same trig formula as `renderNoiseField`:
```
t = tickCount * timeScale
angle = (sin(x*0.7 + t) * cos(y*0.5 - t*0.3) + cos(x*0.3 + t*0.7) * sin(y*0.8 + t*0.2) + sin((x+y)*0.4 + t*0.5)) * Math.PI
vx = vx*0.85 + cos(angle)*0.25
vy = vy*0.85 + sin(angle)*0.25
```
Position advances by `(vx, vy)`, wraps toroidally. Each particle maintains a ring buffer of its last 4 grid positions.

**Options:**
```typescript
export interface FlowFieldOptions {
  cols?: number;      // default 28
  rows?: number;      // default 8
  count?: number;     // default 40
  timeScale?: number; // default 0.015 — intentionally slower than renderNoiseField's 0.025 for smoother trails
}
```

**Render:** Trail positions → `'·'`, head position → directional char `→↗↑↖←↙↓↘` based on velocity. Brightness increases toward head. Color via `lerpColor`.

**Returns:** Multi-line string.

---

### 13. `createLaserScan(opts?)` — Stateful

**Algorithm:** A beam position sweeps horizontally across the widget at constant speed (fractional `x` position, wraps at `cols + beamWidth`). Background is a static randomized glyph grid (re-randomized column-by-column on wrap). Cells near the beam get boosted brightness; cells behind it decay exponentially.

**Options:**
```typescript
export interface LaserScanOptions {
  cols?: number;       // default 28
  rows?: number;       // default 6
  speed?: number;      // default 0.5 — cells per tick
  beamWidth?: number;  // default 5 — gaussian half-width
}
```

**Render:** Per-cell brightness = `exp(-(x - beamPos)² / (2 * beamWidth²))`. Threshold < 0.04 → dim char, else `lerpColor(breathBaseColor, breathPeakColor, brightness)` with denser glyph chars near peak. Underlying glyph grid uses `ANIMATION_GLYPHS`.

**Returns:** Multi-line string.

---

### 14. `createLissajous(opts?)` — Stateful

**Algorithm:** Parametric curve `x = A * sin(a * t + delta)`, `y = B * sin(b * t)`. `delta` accumulates each tick (morphs the shape). Samples `trailPoints` positions along the full curve each frame, accumulates into a density buffer `Float32Array[cols×rows]`. Buffer decays by `decay` each frame.

**Options:**
```typescript
export interface LissajousOptions {
  cols?: number;         // default 24
  rows?: number;         // default 12
  a?: number;            // default 3 — x frequency
  b?: number;            // default 2 — y frequency
  deltaSpeed?: number;   // default 0.008 — phase shift per tick
  trailPoints?: number;  // default 300 — curve samples per frame
  decay?: number;        // default 0.92 — brightness decay per tick
}
```

**Render:** Density buffer normalized → `lerpColor(breathBaseColor, breathPeakColor, density)`, chars from `'·•●◉'` by density. Cells below threshold (< 0.05): space.

**Returns:** Multi-line string.

---

## Re-export additions to `style-primitives.ts`

Append to the existing animation presets re-export block:

```typescript
export {
  createDoomFire, createSpectrumBars, renderPlasma, createMatrixRain,
  createGameOfLife, createStarfield, createWaterRipple, renderSynthgrid,
  createBoids, createVortex, renderNoiseField, createFlowField,
  createLaserScan, createLissajous,
} from "./animation-primitives.js";
export type {
  DoomFireOptions, SpectrumBarsOptions, PlasmaOptions, MatrixRainOptions,
  GameOfLifeOptions, StarfieldOptions, WaterRippleOptions, SynthgridOptions,
  BoidsOptions, VortexOptions, NoiseFieldOptions, FlowFieldOptions,
  LaserScanOptions, LissajousOptions,
} from "./animation-primitives.js";
```

---

## Verification

1. `npm run build` — zero TypeScript errors
2. No external dependencies added — all math is self-contained
3. All presets follow the `(animState, theme) => string` return contract
4. All options have sensible defaults (zero-config usage)
