import type { Component, OverlayAnchor, OverlayOptions, SizeValue } from "@mariozechner/pi-tui";
import type { Rect } from "./mouse.js";

function parseSizeValue(value: SizeValue | undefined, referenceSize: number): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number") return value;
	const match = value.match(/^(\d+(?:\.\d+)?)%$/);
	if (!match) {
		return undefined;
	}
	return Math.floor((referenceSize * Number.parseFloat(match[1])) / 100);
}

function resolveAnchorRow(anchor: OverlayAnchor, height: number, availHeight: number, marginTop: number): number {
	switch (anchor) {
		case "top-left":
		case "top-center":
		case "top-right":
			return marginTop;
		case "bottom-left":
		case "bottom-center":
		case "bottom-right":
			return marginTop + availHeight - height;
		default:
			return marginTop + Math.floor((availHeight - height) / 2);
	}
}

function resolveAnchorCol(anchor: OverlayAnchor, width: number, availWidth: number, marginLeft: number): number {
	switch (anchor) {
		case "top-left":
		case "left-center":
		case "bottom-left":
			return marginLeft;
		case "top-right":
		case "right-center":
		case "bottom-right":
			return marginLeft + availWidth - width;
		default:
			return marginLeft + Math.floor((availWidth - width) / 2);
	}
}

export function resolveOverlayRect(
	component: Component,
	options: OverlayOptions,
	termWidth: number,
	termHeight: number,
): Rect {
	const margin =
		typeof options.margin === "number"
			? { top: options.margin, right: options.margin, bottom: options.margin, left: options.margin }
			: (options.margin ?? {});

	const marginTop = Math.max(0, margin.top ?? 0);
	const marginRight = Math.max(0, margin.right ?? 0);
	const marginBottom = Math.max(0, margin.bottom ?? 0);
	const marginLeft = Math.max(0, margin.left ?? 0);

	const availWidth = Math.max(1, termWidth - marginLeft - marginRight);
	const availHeight = Math.max(1, termHeight - marginTop - marginBottom);

	let width = parseSizeValue(options.width, termWidth) ?? Math.min(80, availWidth);
	if (options.minWidth !== undefined) {
		width = Math.max(width, options.minWidth);
	}
	width = Math.max(1, Math.min(width, availWidth));

	let maxHeight = parseSizeValue(options.maxHeight, termHeight);
	if (maxHeight !== undefined) {
		maxHeight = Math.max(1, Math.min(maxHeight, availHeight));
	}

	const lines = component.render(width);
	const overlayHeight = maxHeight !== undefined ? Math.min(lines.length, maxHeight) : lines.length;

	let row: number;
	if (options.row !== undefined) {
		if (typeof options.row === "string") {
			const match = options.row.match(/^(\d+(?:\.\d+)?)%$/);
			if (match) {
				const maxRow = Math.max(0, availHeight - overlayHeight);
				row = marginTop + Math.floor(maxRow * (Number.parseFloat(match[1]) / 100));
			} else {
				row = resolveAnchorRow("center", overlayHeight, availHeight, marginTop);
			}
		} else {
			row = options.row;
		}
	} else {
		row = resolveAnchorRow(options.anchor ?? "center", overlayHeight, availHeight, marginTop);
	}

	let col: number;
	if (options.col !== undefined) {
		if (typeof options.col === "string") {
			const match = options.col.match(/^(\d+(?:\.\d+)?)%$/);
			if (match) {
				const maxCol = Math.max(0, availWidth - width);
				col = marginLeft + Math.floor(maxCol * (Number.parseFloat(match[1]) / 100));
			} else {
				col = resolveAnchorCol("center", width, availWidth, marginLeft);
			}
		} else {
			col = options.col;
		}
	} else {
		col = resolveAnchorCol(options.anchor ?? "center", width, availWidth, marginLeft);
	}

	if (options.offsetY !== undefined) row += options.offsetY;
	if (options.offsetX !== undefined) col += options.offsetX;

	row = Math.max(marginTop, Math.min(row, termHeight - marginBottom - overlayHeight));
	col = Math.max(marginLeft, Math.min(col, termWidth - marginRight - width));

	return {
		row: row + 1,
		col: col + 1,
		width,
		height: overlayHeight,
	};
}
