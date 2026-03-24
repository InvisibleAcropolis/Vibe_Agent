# Ornate ASCII Frame Borders — Design Spec

**Date:** 2026-03-23
**Status:** Approved

---

## Context

The TUI runs inside a host that renders in dense mode, enabling effective use of high-density ASCII block graphics (`░▒▓█`). The existing border system uses standard Unicode box-drawing characters (`╭╮╰╯─│╔╗╚╝`) which are functional but not visually distinctive.

The goal is to introduce a new `OrnateFrame` component — a series of **6 ornate border styles** inspired by antique picture frames and renaissance decorative arts — that wraps any content with elaborate block-character art without modifying or replacing any existing components.

---

## Requirements

- **New standalone component** — does not replace existing borders in float_window, animbox, overlays, etc.
- **9-patch scalable** — fixed corner tile art + tiling edge strips; adapts to any terminal width/height
- **6 frame variants**: Baroque (reference), Gothic, Art Nouveau, Celtic Knotwork, Art Deco, Egyptian/Classical
- **Per-theme color mapping** — each active theme provides `shade1`–`shade4` defaults for frame rendering
- **User-assignable** — callers can override any shade slot per-frame instance
- **Pure wrapper API** — takes `string[]` content, returns `string[]` with frame applied

---

## Architecture

### 9-Patch Tile Model

Each frame variant is defined as a `FrameTileSet` — a set of pre-drawn string arrays composited at render time:

```
[TL corner]  [topEdge tile → repeats to fill width]  [TR corner]
[leftEdge ↓]         [content lines pass-through]        [rightEdge ↓]
[BL corner]  [bottomEdge tile → repeats to fill width]  [BR corner]
```

- **Corners**: Fixed pixel art, `cornerW × cornerH` characters. Never scaled.
- **Top/Bottom edges**: A tile that repeats horizontally between corners.
- **Left/Right edges**: A tile that repeats vertically between corners.

### FrameTileSet Interface

```typescript
export interface FrameTileSet {
  variant: OrnateFrameVariant;
  cornerW: number;          // width of each corner tile in chars (~10–14)
  cornerH: number;          // height of each corner tile in rows (~8–12)
  topLeft: string[];        // cornerH rows, each cornerW chars
  topRight: string[];
  bottomLeft: string[];
  bottomRight: string[];
  topEdge: string[];        // repeating tile (1–4 rows tall) for top edge
  bottomEdge: string[];     // repeating tile for bottom edge
  leftEdge: string[];       // repeating tile for left edge
  rightEdge: string[];      // repeating tile for right edge
}
```

### Color System: Depth Mapping

Block characters encode depth/density. The renderer maps them automatically to 4 theme color slots:

| Char | Slot     | Semantic         |
|------|----------|------------------|
| `░`  | shade1   | shadow / darkest |
| `▒`  | shade2   | mid-shadow       |
| `▓`  | shade3   | mid-highlight    |
| `█`  | shade4   | brightest / foreground |
| box-drawing (`─│╔` etc.) | shade3 | structural lines |
| other (` ` space, etc.)  | —      | pass-through     |

### OrnateFrameColors Interface

```typescript
export interface OrnateFrameColors {
  shade1: string;  // hex color
  shade2: string;
  shade3: string;
  shade4: string;
}
```

### Theme Integration

`ThemeConfig` in `src/themes/index.ts` gains an optional `ornateFrame` property:

```typescript
interface ThemeConfig {
  // ... existing fields ...
  ornateFrame?: OrnateFrameColors;
}
```

Each theme file provides defaults that match its aesthetic:

| Theme     | Mood                          | Shade palette direction         |
|-----------|-------------------------------|---------------------------------|
| default   | Cyan/blue tech                | Dark navy → bright cyan         |
| cyberpunk | Neon magenta/pink             | Deep purple → hot pink          |
| matrix    | Green phosphor                | Black → bright green            |
| synthwave | Purple/orange sunset          | Deep purple → orange highlight  |
| amber     | Warm amber terminal           | Dark brown → bright amber       |

If no `ornateFrame` is defined in a theme, the renderer falls back to interpolating between the theme's existing `border` and `borderActive` hex colors using 4 equal HSL steps (shade1 = border, shade4 = borderActive, shade2/3 linearly interpolated in HSL space).

### OrnateFrame Class API

```typescript
export type OrnateFrameVariant =
  | 'baroque' | 'gothic' | 'art-nouveau'
  | 'celtic'  | 'art-deco' | 'egyptian';

export interface OrnateFrameOptions {
  variant: OrnateFrameVariant;
  colors?: Partial<OrnateFrameColors>;  // overrides theme defaults per slot
}

export class OrnateFrame {
  constructor(options: OrnateFrameOptions) {}

  render(content: string[], width: number, height?: number): string[] {
    // 1. Load tile set for variant
    // 2. Resolve colors (theme defaults + caller overrides)
    // 3. Build top rows: TL corner + tiled top edge + TR corner
    // 4. Build middle rows: left edge + content line + right edge
    //    (pad/trim content lines to fit; if height given, pad with blank lines)
    // 5. Build bottom rows: BL corner + tiled bottom edge + BR corner
    // 6. Apply depth-mapped color styling char-by-char
    return lines;
  }
}
```

---

## Files

### New Files

| File | Purpose |
|------|---------|
| `src/components/ornate-frame.ts` | `OrnateFrame` class, renderer, color mapper |
| `src/ornate-frame-tiles/index.ts` | `FrameTileSet` interface, variant registry, tile lookup |
| `src/ornate-frame-tiles/baroque.ts` | Baroque tile art (derived from user reference) |
| `src/ornate-frame-tiles/gothic.ts` | Gothic tracery tile art |
| `src/ornate-frame-tiles/art-nouveau.ts` | Art Nouveau organic tile art |
| `src/ornate-frame-tiles/celtic.ts` | Celtic knotwork tile art |
| `src/ornate-frame-tiles/art-deco.ts` | Art Deco geometric tile art |
| `src/ornate-frame-tiles/egyptian.ts` | Egyptian/Classical column tile art |

### Modified Files

| File | Change |
|------|--------|
| `src/themes/index.ts` | Add `OrnateFrameColors` interface; add optional `ornateFrame` to `ThemeConfig`; add fallback resolution in `createDynamicTheme()` |
| `src/themes/default.ts` | Add `ornateFrame` color defaults |
| `src/themes/cyberpunk.ts` | Add `ornateFrame` color defaults |
| `src/themes/matrix.ts` | Add `ornateFrame` color defaults |
| `src/themes/synthwave.ts` | Add `ornateFrame` color defaults |
| `src/themes/amber.ts` | Add `ornateFrame` color defaults |

### Reference Material

- User reference art: `C:\Users\docwh\Downloads\ascii-art (7).txt` (Baroque frame, 44 rows × ~130 cols) — local path only; implementer should read this file directly to derive the Baroque tile art during implementation
- User reference image: `C:\Users\docwh\Downloads\ascii-art (3).png` — visual reference; local path only
- The Baroque tile art will be hand-extracted from these references and embedded as TypeScript string constants during implementation

---

## Existing Utilities to Reuse

From `src/ansi.ts`:
- `style(options: StyleOptions): Styler` — for creating per-depth color functions
- `visibleWidth(text: string): number` — for measuring line widths (respecting ANSI codes)
- `truncateToWidth(text, width): string` — for fitting content lines to frame interior
- `paintLine(text, width, lineStyle?)` — for padding content lines

From `src/themes/index.ts`:
- `createDynamicTheme(config, animState)` — extend this to resolve `ornateFrame` colors
- `hslToHex(h, s, l)` — for generating shade interpolations from theme hue

---

## Frame Variant Details

### 1. Baroque (reference-derived)
- **Source**: User's reference ASCII art file
- **Character set**: Primarily `░▒▓█` block chars with occasional `│` column markers
- **Corner size**: ~12w × ~12h
- **Edge pattern**: Dense `░▒▓` band, 3 rows tall
- **Aesthetic**: Organic scrollwork, asymmetric within each corner

### 2. Gothic
- **Character set**: `╔╦╗╠╬╣╚╩╝═║` box-drawing + `/\` arch forms
- **Corner size**: ~8w × ~8h
- **Edge pattern**: Repeating `╦` spire motifs, 2 rows tall
- **Aesthetic**: Pointed arches, tracery panels, lancet windows

### 3. Art Nouveau
- **Character set**: `░▒` light blocks + `~()` curve chars + `│`
- **Corner size**: ~8w × ~8h
- **Edge pattern**: Flowing wave motif `~`, 2 rows tall
- **Aesthetic**: Light, organic, floral — uses lighter density chars

### 4. Celtic Knotwork
- **Character set**: `╔╦╗╠╬╣╚╩╝═║╝╚` box-drawing with over/under illusion
- **Corner size**: ~10w × ~6h
- **Edge pattern**: Interlace repeat unit, 2 rows tall
- **Aesthetic**: Geometric interlace, weave illusion via box-drawing

### 5. Art Deco
- **Character set**: `░▒▓█` gradient + symmetrical patterns
- **Corner size**: ~10w × ~8h
- **Edge pattern**: Chevron/step gradient, 2 rows tall
- **Aesthetic**: Bold geometric sunburst, high-contrast, symmetric

### 6. Egyptian / Classical
- **Character set**: `▓█` solid + `║` columns + `∩∪` arch forms
- **Corner size**: ~10w × ~8h
- **Edge pattern**: Column capital repeat (`∩∩∩`), 2 rows tall
- **Aesthetic**: Papyrus columns, lotus arch motifs, cartouche-style header band

---

## Rendering Algorithm

```
function render(content, width, height):
  tiles = getTileSet(variant)
  colors = resolveColors(variant, themeColors, overrides)

  // cornerW == edgeW by design: left/right edge tiles are exactly cornerW chars wide
  innerW = width - tiles.cornerW * 2

  // top section
  for row in 0..cornerH:
    line = colorize(tiles.topLeft[row])
         + colorize(tile(tiles.topEdge[row % topEdge.length], innerW))
         + colorize(tiles.topRight[row])
    output.push(line)

  // middle section
  innerH = height ?? content.length
  for row in 0..innerH:
    leftPiece = colorize(tiles.leftEdge[row % leftEdge.length])
    rightPiece = colorize(tiles.rightEdge[row % rightEdge.length])
    contentLine = padOrTrim(content[row] ?? '', innerW)
    output.push(leftPiece + contentLine + rightPiece)

  // bottom section
  for row in 0..cornerH:
    line = colorize(tiles.bottomLeft[row])
         + colorize(tile(tiles.bottomEdge[row % bottomEdge.length], innerW))
         + colorize(tiles.bottomRight[row])
    output.push(line)

  return output
```

---

## Verification

1. **Unit smoke test**: Instantiate each of 6 variants, call `render(["hello"], 80, 10)`, assert output has correct number of lines and correct width.
2. **Visual inspection**: Render each frame to stdout at 80-wide — corners should be crisp, edges should tile cleanly with no seams.
3. **Width stress test**: Render at minimum viable width (= `cornerW * 2 + 1`) and at wide terminal (200 chars) — should not crash or produce ragged lines.
4. **Color override test**: Pass `{ shade4: '#ff0000' }` — only `█` chars should appear red.
5. **Theme integration test**: Switch active theme via `setActiveTheme()`, re-render — frame colors should change to match new theme's `ornateFrame` palette.
6. **Content clipping test**: Pass content lines wider than inner width — should truncate cleanly without breaking ANSI codes.
