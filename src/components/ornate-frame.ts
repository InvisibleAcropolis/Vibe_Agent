import { style, type Styler } from "../ansi.js";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { getActiveTheme, resolveOrnateFrameColors, type OrnateFrameColors } from "../themes/index.js";
import { getTileSet, type OrnateFrameVariant } from "../ornate-frame-tiles/index.js";
import { agentTheme } from "../theme.js";

export type { OrnateFrameVariant };

export interface OrnateFrameOptions {
  variant: OrnateFrameVariant;
  /** Optional per-slot color overrides. Partial — unset slots use theme defaults. */
  colors?: Partial<OrnateFrameColors>;
}

/**
 * Characters that map to each depth slot.
 * All other non-space characters map to shade3 (structural/box-drawing).
 */
const SHADE1_CHARS = new Set(["░"]);
const SHADE2_CHARS = new Set(["▒"]);
const SHADE3_CHARS = new Set(["▓"]);
const SHADE4_CHARS = new Set(["█"]);

function buildStylers(colors: OrnateFrameColors): {
  s1: Styler; s2: Styler; s3: Styler; s4: Styler;
} {
  return {
    s1: style({ fg: colors.shade1 }),
    s2: style({ fg: colors.shade2 }),
    s3: style({ fg: colors.shade3 }),
    s4: style({ fg: colors.shade4 }),
  };
}

/** Apply per-character depth-mapped color styling to a raw tile row string. */
function colorizeRow(
  row: string,
  stylers: { s1: Styler; s2: Styler; s3: Styler; s4: Styler },
): string {
  let out = "";
  for (const ch of row) {
    if (ch === " ") {
      out += " ";
    } else if (SHADE1_CHARS.has(ch)) {
      out += stylers.s1(ch);
    } else if (SHADE2_CHARS.has(ch)) {
      out += stylers.s2(ch);
    } else if (SHADE3_CHARS.has(ch)) {
      out += stylers.s3(ch);
    } else if (SHADE4_CHARS.has(ch)) {
      out += stylers.s4(ch);
    } else {
      // box-drawing chars and all others → shade3
      out += stylers.s3(ch);
    }
  }
  return out;
}

/**
 * Repeat a tile string horizontally until it fills `targetWidth` chars exactly.
 * Tiles are raw (no ANSI codes), so plain .length is safe here.
 */
function tileFillH(tile: string, targetWidth: number): string {
  if (targetWidth <= 0 || tile.length === 0) return " ".repeat(Math.max(0, targetWidth));
  let out = "";
  while (out.length < targetWidth) {
    out += tile;
  }
  return out.slice(0, targetWidth);
}

export class OrnateFrame {
  private readonly options: OrnateFrameOptions;

  constructor(options: OrnateFrameOptions) {
    this.options = options;
  }

  private resolveColors(): OrnateFrameColors {
    const themeConfig = getActiveTheme();
    const base = resolveOrnateFrameColors(
      themeConfig,
      agentTheme.border,
      agentTheme.borderActive,
    );
    if (!this.options.colors) return base;
    return { ...base, ...this.options.colors };
  }

  /**
   * Render content wrapped in the ornate frame.
   *
   * @param content - Lines of content to display inside the frame.
   *   Each line will be truncated/padded to the inner width.
   * @param width - Total outer width of the frame in terminal columns.
   * @param height - Optional fixed inner height. If omitted, uses content.length.
   *   If content has fewer lines, empty lines fill the remainder.
   */
  render(content: string[], width: number, height?: number): string[] {
    const tiles = getTileSet(this.options.variant);
    const colors = this.resolveColors();
    const st = buildStylers(colors);

    const innerW = width - tiles.cornerW * 2;
    const innerH = height ?? content.length;

    if (innerW < 1) {
      // Frame too narrow to hold content — return plain content
      return content.map((l) => truncateToWidth(l, width, ""));
    }

    const out: string[] = [];

    // ── Top section ─────────────────────────────────────────────────────────
    const topEdgeTileRows = tiles.topEdge.length;
    for (let row = 0; row < tiles.cornerH; row++) {
      const tlRow = tiles.topLeft[row] ?? " ".repeat(tiles.cornerW);
      const trRow = tiles.topRight[row] ?? " ".repeat(tiles.cornerW);
      const edgeRow = tiles.topEdge[row % topEdgeTileRows] ?? "";
      const edgeFill = tileFillH(edgeRow, innerW);

      out.push(
        colorizeRow(tlRow, st) +
        colorizeRow(edgeFill, st) +
        colorizeRow(trRow, st),
      );
    }

    // ── Middle section (content) ─────────────────────────────────────────────
    const leftEdgeTileRows = tiles.leftEdge.length;
    const rightEdgeTileRows = tiles.rightEdge.length;

    for (let row = 0; row < innerH; row++) {
      const leftRow = tiles.leftEdge[row % leftEdgeTileRows] ?? " ".repeat(tiles.cornerW);
      const rightRow = tiles.rightEdge[row % rightEdgeTileRows] ?? " ".repeat(tiles.cornerW);

      const rawContent = content[row] ?? "";
      // Truncate to inner width, then pad to exact inner width
      const truncated = truncateToWidth(rawContent, innerW, "");
      const contentPadded = truncated + " ".repeat(Math.max(0, innerW - visibleWidth(truncated)));

      out.push(
        colorizeRow(leftRow, st) +
        contentPadded +
        colorizeRow(rightRow, st),
      );
    }

    // ── Bottom section ───────────────────────────────────────────────────────
    const bottomEdgeTileRows = tiles.bottomEdge.length;
    for (let row = 0; row < tiles.cornerH; row++) {
      const blRow = tiles.bottomLeft[row] ?? " ".repeat(tiles.cornerW);
      const brRow = tiles.bottomRight[row] ?? " ".repeat(tiles.cornerW);
      const edgeRow = tiles.bottomEdge[row % bottomEdgeTileRows] ?? "";
      const edgeFill = tileFillH(edgeRow, innerW);

      out.push(
        colorizeRow(blRow, st) +
        colorizeRow(edgeFill, st) +
        colorizeRow(brRow, st),
      );
    }

    return out;
  }
}
