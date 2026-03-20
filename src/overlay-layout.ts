import type { Component, OverlayOptions } from "@mariozechner/pi-tui";
import type { Rect } from "./mouse.js";

type MarginValue = number | { top?: number; bottom?: number; left?: number; right?: number };

function resolveMargin(margin: MarginValue | undefined): { top: number; bottom: number; left: number; right: number } {
	if (margin === undefined) return { top: 0, bottom: 0, left: 0, right: 0 };
	if (typeof margin === "number") return { top: margin, bottom: margin, left: margin, right: margin };
	return { top: margin.top ?? 0, bottom: margin.bottom ?? 0, left: margin.left ?? 0, right: margin.right ?? 0 };
}

function resolveDimension(value: number | string | undefined, total: number): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number") return value;
	if (value.endsWith("%")) {
		const percent = Number.parseFloat(value.slice(0, -1));
		return Math.floor((total * percent) / 100);
	}
	return Number.parseInt(value, 10) || undefined;
}

export function resolveOverlayRect(component: Component, options: OverlayOptions, termCols: number, termRows: number): Rect {
	const margin = resolveMargin(options.margin as MarginValue | undefined);
	const usableWidth = termCols - margin.left - margin.right;
	const usableHeight = termRows - margin.top - margin.bottom;
	const width = Math.min(resolveDimension(options.width, termCols) ?? usableWidth, usableWidth);
	const maxHeight = Math.min(resolveDimension(options.maxHeight, termRows) ?? usableHeight, usableHeight);
	const rendered = component.render(width);
	const height = Math.min(rendered.length, maxHeight);
	const anchor = options.anchor ?? "center";

	let row: number;
	let col: number;

	switch (anchor) {
		case "top-left":
			row = margin.top + 1;
			col = margin.left + 1;
			break;
		case "top-center":
			row = margin.top + 1;
			col = margin.left + 1 + Math.floor((usableWidth - width) / 2);
			break;
		case "top-right":
			row = margin.top + 1;
			col = termCols - margin.right - width + 1;
			break;
		case "left-center":
			row = margin.top + 1 + Math.floor((usableHeight - height) / 2);
			col = margin.left + 1;
			break;
		case "center":
			row = margin.top + 1 + Math.floor((usableHeight - height) / 2);
			col = margin.left + 1 + Math.floor((usableWidth - width) / 2);
			break;
		case "right-center":
			row = margin.top + 1 + Math.floor((usableHeight - height) / 2);
			col = termCols - margin.right - width + 1;
			break;
		case "bottom-left":
			row = termRows - margin.bottom - height + 1;
			col = margin.left + 1;
			break;
		case "bottom-center":
			row = termRows - margin.bottom - height + 1;
			col = margin.left + 1 + Math.floor((usableWidth - width) / 2);
			break;
		case "bottom-right":
			row = termRows - margin.bottom - height + 1;
			col = termCols - margin.right - width + 1;
			break;
		default:
			row = margin.top + 1 + Math.floor((usableHeight - height) / 2);
			col = margin.left + 1 + Math.floor((usableWidth - width) / 2);
			break;
	}

	return { row: Math.max(1, row), col: Math.max(1, col), width, height };
}
