import { paintBoxLineTwoParts } from "../ansi.js";
import { createTextRuntime } from "../style-test-fixtures.js";
import { defineStyleTestDemos } from "../style-test-contract.js";
import { agentTheme } from "../theme.js";
import type { Styler } from "../ansi.js";

export interface MenuBarItem {
	key: string;
	label: string;
}

export interface MenuBarItemLayout extends MenuBarItem {
	startCol: number;
	endCol: number;
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

export function measureMenuBarItems(items: MenuBarItem[]): MenuBarItemLayout[] {
	const layouts: MenuBarItemLayout[] = [];
	let cursor = 1;

	for (let i = 0; i < items.length; i++) {
		const item = items[i]!;
		if (i === 0) {
			cursor += 1;
		} else {
			cursor += 5;
		}
		const text = `[${item.key}] ${item.label}`;
		const startCol = cursor;
		const endCol = startCol + text.length - 1;
		layouts.push({
			...item,
			startCol,
			endCol,
		});
		cursor = endCol + 1;
	}

	return layouts;
}

export const styleTestDemos = defineStyleTestDemos({
	exports: {
		renderMenuBar: {
			title: "Menu Bar",
			category: "Components",
			kind: "component",
			description: "Top chrome bar rendered with the shared menu-bar renderer.",
			controls: [
				{ id: "width", label: "Width", type: "number", defaultValue: 64, min: 24, max: 96, step: 1 },
				{ id: "labelA", label: "Item A", type: "text", defaultValue: "Library" },
				{ id: "labelB", label: "Item B", type: "text", defaultValue: "Overlays" },
			],
			createRuntime: (_moduleNamespace, _exportName, _exportValue, _context, values) =>
				createTextRuntime([
					renderMenuBar(
						[
							{ key: "F1", label: String(values.labelA) },
							{ key: "F2", label: String(values.labelB) },
							{ key: "F3", label: "Themes" },
						],
						Number(values.width),
						agentTheme.accent,
						agentTheme.dim,
						agentTheme.muted,
						agentTheme.dim,
					),
				]),
		},
	},
});
