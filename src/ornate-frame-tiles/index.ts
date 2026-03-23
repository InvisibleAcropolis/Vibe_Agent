export type OrnateFrameVariant =
  | "baroque"
  | "gothic"
  | "art-nouveau"
  | "celtic"
  | "art-deco"
  | "egyptian";

/**
 * A 9-patch tile set defining an ornate frame variant.
 *
 * Tile layout:
 *   [topLeft]   [topEdge repeats →]   [topRight]
 *   [leftEdge ↓]   [content]           [rightEdge ↓]
 *   [bottomLeft] [bottomEdge repeats →] [bottomRight]
 *
 * IMPORTANT: cornerW === leftEdge/rightEdge tile width.
 * All rows within a tile must be exactly cornerW characters wide (no ANSI codes).
 * topEdge/bottomEdge tiles must be exactly edgeTileW characters wide.
 */
export interface FrameTileSet {
  variant: OrnateFrameVariant;
  cornerW: number;
  cornerH: number;
  edgeTileW: number;

  topLeft: string[];
  topRight: string[];
  bottomLeft: string[];
  bottomRight: string[];

  topEdge: string[];
  bottomEdge: string[];
  leftEdge: string[];
  rightEdge: string[];
}

const TILE_REGISTRY = new Map<OrnateFrameVariant, FrameTileSet>();

export function registerTileSet(tiles: FrameTileSet): void {
  TILE_REGISTRY.set(tiles.variant, tiles);
}

export function getTileSet(variant: OrnateFrameVariant): FrameTileSet {
  const tiles = TILE_REGISTRY.get(variant);
  if (!tiles) throw new Error(`OrnateFrame: unknown variant "${variant}"`);
  return tiles;
}

export function getRegisteredVariants(): OrnateFrameVariant[] {
  return Array.from(TILE_REGISTRY.keys());
}

/**
 * Eagerly register every built-in tile set.
 *
 * This MUST be called (and awaited) before getTileSet() is used, unless the
 * consumer imports the individual tile modules themselves.
 *
 * We use dynamic imports so the tile modules resolve *after* TILE_REGISTRY
 * has been initialised — static imports would be hoisted and hit a TDZ
 * because baroque.ts etc. import from this very file.
 */
export async function loadAllTileSets(): Promise<void> {
  await Promise.all([
    import("./baroque.js"),
    import("./gothic.js"),
    import("./art-nouveau.js"),
    import("./celtic.js"),
    import("./art-deco.js"),
    import("./egyptian.js"),
  ]);
}
