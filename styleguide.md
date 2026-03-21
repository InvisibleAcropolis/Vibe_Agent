# VibeAgent TUI Styleguide

## Table of Contents

1. [File Inventory](#file-inventory)
2. [Design Principles](#design-principles)
3. [Animation System](#animation-system)
4. [Animation Presets](#animation-presets)
5. [Styling Conventions](#styling-conventions)
6. [Creating New Animations](#creating-new-animations)
7. [Component Patterns](#component-patterns)

---

## File Inventory

### Core Animation System

| File | Purpose |
|------|---------|
| `src/animation-engine.ts` | Central animation driver. Manages `AnimationState`, tick loop (80ms intervals), hue cycling, spinner frames, breath phase, glitch ticks, focus flash, wipe transitions, and typewriter effects. |
| `src/components/animation-primitives.ts` | **Base presets** - 19 original animation factory functions. These are the canonical implementations other enhanced versions derive from. |

### Enhanced Animation Files (Specialized Presets)

| File | Base Preset | Enhancements |
|------|-------------|--------------|
| `src/components/anim_glyphcascade.ts` | GlyphCascade | Configurable glyph sets (default, hex, binary, symbol, block), direction control (up/down/alternate), multi-row mode, seeded randomness |
| `src/components/anim_pulsemeter.ts` | PulseMeter | Segment modes (smooth/discrete/gradient), orientation (left/right/center), dual-mode mirrored display, peak hold tracking |
| `src/components/anim_orbitarc.ts` | OrbitArc | Trail styles (dots/line/dashed/gradient), speed multiplier, reverse direction, orbit types (circular/elliptical/figure8) |
| `src/components/anim_datarain.ts` | DataRain | Multiple glyph sets (default/hex/binary/katakana/symbols), per-column speed control, seeded randomness |
| `src/components/anim_wavesweep.ts` | WaveSweep | Multi-wave superposition, phase offset, interference modes (add/multiply/max), damping |
| `src/components/anim_plasma.ts` | Plasma | Color cycling, palette selection (default/fire/ocean/toxic), frequency modulation |
| `src/components/anim_synthgrid.ts` | Synthgrid | Animated/moving vanishing point, configurable perspective factor, wide variant |
| `src/components/anim_noisefield.ts` | NoiseField | Fractal brownian motion (FBM) with octaves, palette control, flow integration |
| `src/components/anim_doomfire.ts` | DoomFire | Color mappings (default/electric/lava/plasma), cooling patterns (random/wave/radial/edge), wind effect |
| `src/components/anim_spectrumbars.ts` | SpectrumBars | Peak hold with decay, value smoothing, bar gaps, stereo visualization |
| `src/components/anim_starfield.ts` | Starfield | Comet tails, depth-of-field blur, custom star colors, color variety |
| `src/components/anim_vortex.ts` | Vortex | Spawn patterns (random/ring/spiral/burst), color trails, magnetic field influence |
| `src/components/anim_boids.ts` | Boids | Boundary behaviors (wrap/bounce/restrict), predator mode, food sources, tunable separation/alignment/cohesion |
| `src/components/anim_flowfield.ts` | FlowField | Turbulence, curl noise, configurable inertia, particle speed |
| `src/components/anim_gameoflife.ts` | GameOfLife | Rule string parsing (e.g., "B3/S23"), cell aging, configurable stagnation/max generations |
| `src/components/anim_waterripple.ts` | WaterRipple | Multiple simultaneous raindrops, reflection/refraction simulation, configurable raindrop chance/strength |
| `src/components/anim_matrixrain.ts` | MatrixRain | Glyph sets (katakana/hex/binary/mixed/fullwidth), char density, brightness gradient (top/bottom/center), fade modes |
| `src/components/anim_laserscan.ts` | LaserScan | Multi-beam support, beam styles (gaussian/sharp/sine), reverse scan, reflection passes |
| `src/components/anim_lissajous.ts` | Lissajous | 3D projection, phase shifting, resonance mode (amplifies at curve peaks), configurable stroke width |

### Styling Primitives

| File | Purpose |
|------|---------|
| `src/ansi.ts` | Core styling utilities: `style()` for ANSI colors/bold/italic, `composeStylers()`, `padLine()`, `paintLine()`, `paintLineTwoParts()`, `paintBoxLineTwoParts()`, box drawing helpers (`innerBoxTop`, `innerBoxSep`, `innerBoxBottom`, `innerBoxLine`), `horizontalRule()`, `separatorLine()` (crawling line), `dissolveTextRows()`, `glitchLine()`, color conversion (`hslToHex`, `hexToHsl`) |
| `src/components/style-primitives.ts` | Re-exports from `ansi.js` plus wrapper functions `renderBoxLine()` and `renderSeparator()` |

### Theme System

| File | Purpose |
|------|---------|
| `src/themes/index.ts` | Theme registry, `ThemeConfig` interface, `lerpColor()` for gradient interpolation, `createDynamicTheme()` for animated border colors |
| `src/themes/default.ts` | Default theme (blue: hue 190-220, `#254560` → `#60d2ff`) |
| `src/themes/amber.ts` | Amber theme (hue 30-55, `#1a0f00` → `#ffb030`) |
| `src/themes/cyberpunk.ts` | Cyberpunk theme (hue 280-360, `#4a0a6b` → `#ff00ff`) |
| `src/themes/matrix.ts` | Matrix theme (green palette) |
| `src/themes/synthwave.ts` | Synthwave theme (retro colors) |

### UI Components

| File | Purpose |
|------|---------|
| `src/components/logo-block-view.ts` | Logo display with dissolve animation. Uses `dissolveTextRows()` for reveal effect. |
| `src/components/transcript-viewport.ts` | Scrollable viewport for transcript messages. Supports follow-tail mode, scroll offset tracking, and layout change handling. |
| `src/components/thinking-tray.ts` | Expandable "Thinking" panel with markdown rendering, bordered box layout. |
| `src/components/side-by-side-container.ts` | Horizontal split container with optional wipe transition support. |
| `src/components/menu-bar.ts` | Top menu bar with key hints (F1, F2) and animated border fill. |
| `src/components/sessions-panel.ts` | Session list panel |
| `src/components/shell-menu-overlay.ts` | Shell/command palette overlay |
| `src/components/help-overlay.ts` | Keybinding help overlay with scrollable content |
| `src/components/artifact-viewer.ts` | File artifact display |
| `src/components/text-prompt-overlay.ts` | Text input overlay |
| `src/components/session-stats-overlay.ts` | Session statistics display |
| `src/components/filter-select-overlay.ts` | Filterable selection overlay |
| `src/components/editor-overlay.ts` | Code editor overlay |

---

## Design Principles

### 1. Breath Color System

All animations derive color from two theme properties:

```typescript
interface ThemeConfig {
  breathBaseColor: string;  // "#254560" (dark blue)
  breathPeakColor: string;  // "#60d2ff" (bright cyan)
}
```

`lerpColor(base, peak, t)` interpolates between these colors, creating a cohesive gradient across all animations. Animations pass a `t` value (0.0–1.0) representing intensity/progress/brightness.

### 2. Animation State

`AnimationState` drives all time-based animation:

```typescript
interface AnimationState {
  tickCount: number;      // Increments every 80ms
  hueOffset: number;      // 0-359, cycles slowly for border colors
  spinnerFrame: number;    // 0-7, braille spinner
  breathPhase: number;     // 0.0-1.0 sine wave
  glitchActive: boolean;   // True every ~6 seconds for 3 ticks
  separatorOffset: number; // Crawling separator phase
  typewriter: { ... };     // Character-by-character reveal
}
```

### 3. Factory Pattern

Animations use factory functions returning render functions:

```typescript
// Stateful factory
export function createDoomFire(opts?: DoomFireOptions): 
  (animState: AnimationState, theme: ThemeConfig) => string

// Stateless direct render
export function renderPulseMeter(
  value: number,
  animState: AnimationState,
  theme: ThemeConfig,
  opts?: PulseMeterOptions,
): string
```

Stateful factories maintain internal buffers/particle arrays across frames. Stateless renders compute each frame fresh.

### 4. Theme-Agnostic Rendering

All animations accept `ThemeConfig` and use `lerpColor()` for color mapping. This ensures animations work with any theme (default, amber, cyberpunk, matrix, synthwave).

### 5. ANSI Safety

All styling uses the `style()` helper which wraps text in ANSI escape sequences and properly closes them with `\x1b[0m`. Text measurement uses `visibleWidth()` from pi-tui to handle ANSI-aware truncation.

---

## Animation System

### AnimationEngine

Located in `src/animation-engine.ts`, runs at 80ms tick intervals:

```typescript
class AnimationEngine {
  private state: AnimationState = {
    hueOffset: 190,
    spinnerFrame: 0,
    breathPhase: 0,
    tickCount: 0,
    // ...
  };

  start(): void { /* 80ms interval tick */ }
  stop(): void;
  getState(): AnimationState;
  setOnTick(cb: (state: AnimationState) => void): void;
}
```

### Tick Behavior

Each tick (80ms):
- `tickCount++`
- `hueOffset += streaming ? 2 : 0.8` (faster during streaming)
- `spinnerFrame = (spinnerFrame + 1) % 8`
- `breathPhase = sin(tickCount / 50 * 2π)` (0→1→0 triangle)
- Glitch triggered every 75 ticks (6 seconds)
- Separator offset increments every 8 ticks
- Typewriter advances when target differs from displayed

### Spinner Characters

```typescript
const BRAILLE_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
```

---

## Animation Presets

### 1. Glyph Cascade (`anim_glyphcascade.ts`)

**Visual**: Rows of random glyphs that oscillate in count (1→max→1), forming a cascade effect.

**Options**:
- `maxCount` (8): Peak glyph count per row
- `historyRows` (11): Trailing rows to keep
- `ticksPerStep` (2): Ticks between count changes
- `glyphSet`: Custom glyph string
- `direction`: "up" | "down" | "alternate"
- `multiRow`: Boolean for stacked rows
- `rowHeight`: Number of rows per step
- `colorShift`: 0-1 color offset along gradient
- `seeded`: Use deterministic randomness

**Use case**: Loading indicators, processing feedback

---

### 2. Pulse Meter (`anim_pulsemeter.ts`)

**Visual**: Horizontal progress bar with gradient fill.

**Options**:
- `width` (24): Bar width in cells
- `label`: Optional text label
- `segmentMode`: "smooth" | "discrete" | "gradient"
- `orientation`: "left" | "right" | "center"
- `dualMode`: Render mirrored bars
- `peakHold`: Show peak indicator
- `peakHoldTime` (30): Ticks to hold peak

**Use case**: Progress indicators, volume meters, CPU usage

---

### 3. Orbit Arc (`anim_orbitarc.ts`)

**Visual**: Spinner head with trailing dots/lines.

**Options**:
- `trailLength` (6): Number of trail segments
- `label`: Optional text
- `trailStyle`: "dots" | "line" | "dashed" | "gradient"
- `speedMultiplier`: Spin speed factor
- `reverse`: Reverse spin direction
- `orbitType`: "circular" | "elliptical" | "figure8"

**Use case**: Loading spinners, processing indicators

---

### 4. Data Rain (`anim_datarain.ts`)

**Visual**: Matrix of random glyphs that refresh periodically.

**Options**:
- `cols` (4): Number of columns
- `rows` (3): Number of rows
- `refreshEveryN` (4): Ticks between refreshes
- `glyphSet`: "default" | "hex" | "binary" | "katakana" | "symbols"
- `columnSpeed`: Per-column speed multipliers
- `seeded`: Deterministic randomness

**Use case**: Data visualization, Matrix-style rain

---

### 5. Wave Sweep (`anim_wavesweep.ts`)

**Visual**: Gaussian wave pulse sweeping across a line.

**Options**:
- `width` (24): Line width
- `speed` (0.5): Cells advanced per tick
- `sigma` (5.0): Gaussian spread
- `phaseOffset`: Wave phase offset
- `waveCount`: Number of overlapping waves
- `interference`: "add" | "multiply" | "max"
- `damping`: Wave damping factor

**Use case**: Audio visualization, signal processing

---

### 6. Plasma (`anim_plasma.ts`)

**Visual**: Multi-wave interference pattern creating organic blobs.

**Options**:
- `width` (24), `height` (8): Grid dimensions
- `freq` (0.35): Wave frequency
- `timeScale` (0.06): Animation speed
- `colorCycle`: Cycle through colors
- `palette`: "default" | "fire" | "ocean" | "toxic"
- `freqModulation`: Frequency oscillation

**Use case**: Retro screensaver effect, ambient background

---

### 7. Synthgrid (`anim_synthgrid.ts`)

**Visual**: Perspective grid with vanishing point, animated horizontal lines.

**Options**:
- `cols` (36), `rows` (10): Grid dimensions
- `speed` (0.4): Animation speed
- `numVLines` (7): Vertical lines converging
- `vanishingPointX/Y`: Fixed or "center"/"top"
- `perspectiveFactor` (0.6): Perspective strength
- `animateVanishingPoint`: Moving viewpoint
- `animateSpeed`: Viewpoint animation speed

**Use case**: Retrowave aesthetic, retro gaming

---

### 8. Noise Field (`anim_noisefield.ts`)

**Visual**: Trigonometric noise pattern with smooth gradients.

**Options**:
- `cols` (24), `rows` (8): Grid dimensions
- `timeScale` (0.025): Animation speed
- `freqScale` (1.0): Spatial frequency
- `octaves`: FBM octaves (default 3)
- `octavePersistence` (0.5): FBM persistence
- `palette`: "default" | "fire" | "ice" | "toxic"
- `flowIntegration`: Use FBM instead of basic noise

**Use case**: Procedural textures, terrain-like patterns

---

### 9. Doom Fire (`anim_doomfire.ts`)

**Visual**: Classic Doom fire propagation from bottom to top.

**Options**:
- `width` (20), `height` (8): Grid dimensions
- `coolingStrength` (0.15): Bottom row cooling rate
- `coolingPattern`: "random" | "wave" | "radial" | "edge"
- `colorMapping`: "default" | "electric" | "lava" | "plasma"
- `windStrength`: Horizontal wind effect
- `windDirection`: -1 | 0 | 1
- `seedInterval`: Ticks between auto-seeds

**Use case**: Fire effects, heat visualization

---

### 10. Spectrum Bars (`anim_spectrumbars.ts`)

**Visual**: Audio spectrum analyzer bars with fractional fill.

**Options**:
- `cols` (12): Number of bars
- `rows` (6): Bar height
- `speed` (1.0): Animation speed
- `decay` (0.92): Bar decay rate
- `peakHold`: Show peak markers
- `peakDecay` (0.98): Peak decay rate
- `smoothing` (0.3): Value smoothing
- `barGap`: Gap between bars

**Use case**: Audio visualization, activity monitoring

---

### 11. Starfield (`anim_starfield.ts`)

**Visual**: 3D starfield with perspective depth.

**Options**:
- `cols` (24), `rows` (8): Field dimensions
- `count` (80): Number of stars
- `speed` (0.015): Star velocity
- `cometTail`: Enable comet tails
- `tailLength` (4): Tail segment count
- `depthOfField`: Simulate DOF blur
- `starColors`: Custom color array
- `colorVariety`: Random color probability

**Use case**: Space theme, ambient background

---

### 12. Vortex (`anim_vortex.ts`)

**Visual**: Orbital spiral of particles moving inward.

**Options**:
- `cols` (24), `rows` (10): Arena dimensions
- `count` (35): Particle count
- `pullStrength` (0.04): Inward drift per tick
- `trailLength` (3): Trail segments
- `spawnPattern`: "random" | "ring" | "spiral" | "burst"
- `colorTrail`: Color trail segments
- `magneticField`: Angular velocity modulation

**Use case**: Galaxy effect, particle systems

---

### 13. Boids (`anim_boids.ts`)

**Visual**: Craig Reynolds flocking simulation with directional boids.

**Options**:
- `cols` (28), `rows` (8): Arena dimensions
- `count` (25): Boid count
- `maxSpeed` (0.5): Maximum velocity
- `radius` (6.0): Neighbor detection radius
- `boundaryBehavior`: "wrap" | "bounce" | "restrict"
- `predatorEnabled`: Enable predator boids
- `predatorCount` (2): Number of predators
- `foodSources`: Array of attractor points
- `separationStrength` (0.06)
- `alignmentStrength` (0.02)
- `cohesionStrength` (0.005)

**Use case**: Flocking simulation, emergent behavior

---

### 14. Flow Field (`anim_flowfield.ts`)

**Visual**: Particles following a noise-driven vector field.

**Options**:
- `cols` (28), `rows` (8): Arena dimensions
- `count` (40): Particle count
- `timeScale` (0.015): Field evolution speed
- `turbulence` (0.1): Random noise injection
- `trailLength` (4): Trail segments
- `particleSpeed` (0.25): Base particle speed
- `inertia` (0.85): Velocity smoothing
- `curlStrength`: Curl noise force

**Use case**: Fluid dynamics, particle systems

---

### 15. Game of Life (`anim_gameoflife.ts`)

**Visual**: Conway's cellular automaton with cell aging.

**Options**:
- `cols` (24), `rows` (8): Grid dimensions
- `density` (0.35): Initial live cell probability
- `ticksPerStep` (3): Simulation steps per render
- `rule`: Rule string (e.g., "B3/S23")
- `cellAging`: Track cell age for color
- `agingSpeed` (20): Age color transition rate
- `reseedOnStagnation`: Auto-reseed when stable
- `stagnationThreshold` (60): Ticks before reseed
- `maxGenerations` (400): Generation limit

**Use case**: Cellular automata visualization

---

### 16. Water Ripple (`anim_waterripple.ts`)

**Visual**: 2D wave propagation with raindrop disturbances.

**Options**:
- `cols` (24), `rows` (8): Grid dimensions
- `damping` (0.98): Wave damping
- `disturbInterval` (40): Ticks between drops
- `raindropChance` (0.3): Drop probability
- `raindropStrength` (180): Drop amplitude
- `reflectionEnabled`: Enable reflection effect
- `refractionStrength` (0.5): Reflection strength
- `multipleDrops`: Multiple simultaneous drops

**Use case**: Water surface, rain effects

---

### 17. Matrix Rain (`anim_matrixrain.ts`)

**Visual**: Katakana column rain with fading trails.

**Options**:
- `cols` (12), `rows` (8): Grid dimensions
- `mutationRate` (0.05): Glyph mutation chance
- `speedMin/Max` (0.3/1.2): Speed range
- `trailLengthMin/Max` (6/18): Trail length range
- `glyphSet`: "katakana" | "hex" | "binary" | "mixed" | "fullwidth"
- `charDensity` (1.0): Character visibility probability
- `brightnessGradient`: "top" | "bottom" | "center"
- `fadeMode`: "solid" | "gradient" | "sharp"

**Use case**: Matrix-style rain, digital rain

---

### 18. Laser Scan (`anim_laserscan.ts`)

**Visual**: Horizontal beam scanning across random data.

**Options**:
- `cols` (28), `rows` (6): Grid dimensions
- `speed` (0.5): Scan speed
- `beamWidth` (5): Beam radius (Gaussian sigma)
- `beamCount` (1): Number of beams
- `glyphSet`: Custom glyph string
- `beamStyle`: "gaussian" | "sharp" | "sine"
- `reverseScan`: Reverse scan direction
- `reflectionPasses`: Reflection simulation passes

**Use case**: Laser show, frequency analysis

---

### 19. Lissajous (`anim_lissajous.ts`)

**Visual**: Parametric curve with density accumulation.

**Options**:
- `cols` (24), `rows` (12): Grid dimensions
- `a` (3), `b` (2): X/Y frequencies
- `deltaSpeed` (0.008): Phase shift speed
- `trailPoints` (300): Samples per frame
- `decay` (0.92): Density decay
- `threeDimensional`: 3D projection
- `phaseShift`: Initial phase offset
- `resonanceMode`: Amplify at curve peaks
- `strokeWidth`: Line thickness

**Use case**: Oscilloscope display, audio visualization

---

## Styling Conventions

### Box Drawing

Use `paintBoxLineTwoParts()` for bordered content:

```typescript
paintBoxLineTwoParts(left, right, width, fillChar, fillStyler?, lineStyler?)
```

For inner boxes, use helpers:
- `innerBoxTop(title, width, borderStyler?, titleStyler?, margin?)`
- `innerBoxSep(title, width, borderStyler?, titleStyler?, margin?)`
- `innerBoxBottom(width, borderStyler?, margin?)`
- `innerBoxLine(content, width, borderStyler?, margin?)`

### Separators

Crawling separator using prime number rotation:

```typescript
separatorLine(width: number, offset: number, borderColor: string): string
```

### Color Interpolation

Always use `lerpColor(from, to, t)` for theme-consistent gradients:

```typescript
const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, intensity);
```

### Text Effects

- `dissolveTextRows()`: Wipe/dissolve reveal animation
- `glitchLine()`: Corrupt characters with block glyphs

### Styler Composition

```typescript
const combined = composeStylers(styler1, styler2, styler3);
```

---

## Creating New Animations

### Template for Stateful Animation

```typescript
import { style } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { lerpColor } from "../themes/index.js";
import type { ThemeConfig } from "../themes/index.js";

export interface MyAnimationOptions {
  width?: number;
  height?: number;
  // ... custom options
}

export function createMyAnimation(opts?: MyAnimationOptions): 
  (animState: AnimationState, theme: ThemeConfig) => string {
  
  // Initialize state
  const width = opts?.width ?? 24;
  const height = opts?.height ?? 8;
  const buffer = new SomeType(/* ... */);
  
  return (_animState: AnimationState, theme: ThemeConfig): string => {
    // Update state based on animState.tickCount if needed
    
    // Render frame using theme colors
    const rows: string[] = [];
    for (let y = 0; y < height; y++) {
      let row = '';
      for (let x = 0; x < width; x++) {
        const intensity = /* ... compute 0-1 value ... */;
        const color = lerpColor(theme.breathBaseColor, theme.breathPeakColor, intensity);
        const char = /* ... pick character based on intensity ... */;
        row += style({ fg: color })(char);
      }
      rows.push(row);
    }
    return rows.join('\n');
  };
}
```

### Template for Stateless Animation

```typescript
export function renderMyMeter(
  value: number,
  _animState: AnimationState,
  theme: ThemeConfig,
  opts?: MyMeterOptions,
): string {
  const width = opts?.width ?? 24;
  // ... compute and render
}
```

### Guidelines

1. **Always accept `ThemeConfig`** and use `lerpColor()` for colors
2. **Use factory functions** for animations with persistent state (particles, grids)
3. **Use direct render functions** for stateless, input-driven animations
4. **Handle edge cases**: zero dimensions, empty states, etc.
5. **Use readonly arrays** for character sets (`as const`)
6. **Document options** with JSDoc and default values
7. **Prefer `tickCount % N`** for time-based updates to avoid state accumulation

---

## Component Patterns

### Component Interface

All UI components implement the `Component` interface from pi-tui:

```typescript
interface Component {
  render(width: number): string[];
  invalidate?(): void;
}
```

### Viewport Pattern

For scrollable content, use `TranscriptViewport`:

```typescript
const viewport = new TranscriptViewport();
viewport.setViewportHeight(20);
viewport.setComponents([contentComponent]);
const lines = viewport.render(width);
```

### Side-by-Side Layout

```typescript
const container = new SideBySideContainer(leftComponent, rightComponent, rightWidth);
// Supports wipe transition via wipeChar property
```

### Dynamic Styling

Use theme functions that return stylers:

```typescript
const border = agentTheme.accent;  // (text: string) => string
const dim = agentTheme.dim;
const text = agentTheme.text;
```

### Overlay Pattern

Overlays implement both `MouseAwareOverlay` and `Focusable`:

```typescript
class MyOverlay implements MouseAwareOverlay, Focusable {
  private _focused = false;
  
  get focused() { return this._focused; }
  set focused(value: boolean) { this._focused = value; }
  
  handleInput(data: string): void { /* ... */ }
  render(width: number): string[] { /* ... */ }
}
```
