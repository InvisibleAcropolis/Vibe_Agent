export { paintBoxLineTwoParts, separatorLine, paintLine, style } from "../ansi.js";
export type { Styler } from "../ansi.js";

import { paintBoxLineTwoParts, separatorLine } from "../ansi.js";
import type { Styler } from "../ansi.js";

/**
 * Wrapper around paintBoxLineTwoParts for rendering a box-drawing row with
 * left/right content and a fill character (e.g. '═') spanning the gap.
 */
export function renderBoxLine(
	left: string,
	right: string,
	width: number,
	fillChar: string,
	fillStyler?: Styler,
	lineStyler?: Styler,
): string {
	return paintBoxLineTwoParts(left, right, width, fillChar, fillStyler, lineStyler);
}

/**
 * Wrapper around separatorLine for rendering an animated crawling separator.
 */
export function renderSeparator(width: number, offset: number, borderColor: string): string {
	return separatorLine(width, offset, borderColor);
}

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
