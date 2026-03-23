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
