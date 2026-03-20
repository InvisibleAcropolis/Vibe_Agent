import { paintBoxLineTwoParts } from "../ansi.js";
import type { Styler } from "../ansi.js";

export interface MenuBarItem {
	key: string;
	label: string;
}

/**
 * Render a full-width menu bar chrome line.
 *
 * Visual output (80 cols):
 *  [F1] Settings  ◆  [F2] Sessions ══════════════════════════════════════════════
 *
 * - Leading space + `[` `]` brackets: styled with `bc` (animated border color)
 * - Key text (F1, F2): styled with `dimStyler`
 * - Label text (Settings, Sessions): styled with `mutedStyler`
 * - `◆` separator between items: styled with `dimStyler`
 * - Trailing `═` fill to right edge: styled with `bc`, using paintBoxLineTwoParts
 */
export function renderMenuBar(
	items: MenuBarItem[],
	cols: number,
	bc: Styler,
	dimStyler: Styler,
	mutedStyler: Styler,
	lineStyler: Styler,
): string {
	// Build the left content: " [F1] Settings  ◆  [F2] Sessions"
	const parts: string[] = [];

	for (let i = 0; i < items.length; i++) {
		const item = items[i]!;
		// Space before each item (leading space for first, separator gap for rest)
		if (i === 0) {
			// Leading space
			const itemStr = ` ${bc("[")}${dimStyler(item.key)}${bc("]")} ${mutedStyler(item.label)}`;
			parts.push(itemStr);
		} else {
			// Separator + item
			const itemStr = `  ${dimStyler("◆")}  ${bc("[")}${dimStyler(item.key)}${bc("]")} ${mutedStyler(item.label)}`;
			parts.push(itemStr);
		}
	}

	const left = parts.join("");

	// Use paintBoxLineTwoParts with fill char "═" styled with bc, right side empty
	return paintBoxLineTwoParts(left, "", cols, "═", bc, lineStyler);
}
