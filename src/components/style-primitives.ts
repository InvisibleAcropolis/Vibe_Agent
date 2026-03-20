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
