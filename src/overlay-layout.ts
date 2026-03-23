import type { Component, OverlayOptions } from "@mariozechner/pi-tui";
import type { Rect } from "./mouse.js";
import type { HostedLayoutCapable, HostedSizeRequirements, HostedViewportDimensions } from "./types.js";

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

function getHostedRequirements(component: Component, viewport: HostedViewportDimensions): HostedSizeRequirements {
	return (component as HostedLayoutCapable).getHostedSizeRequirements?.(viewport) ?? {};
}

function coerce(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function resolveOverlayRect(component: Component, options: OverlayOptions, termCols: number, termRows: number): Rect {
	const margin = resolveMargin(options.margin as MarginValue | undefined);
	const usableWidth = Math.max(1, termCols - margin.left - margin.right);
	const usableHeight = Math.max(1, termRows - margin.top - margin.bottom);
	const terminalViewport = { width: usableWidth, height: usableHeight };
	const hosted = getHostedRequirements(component, terminalViewport);
	const minWidth = Math.max(1, hosted.minWidth ?? 1, options.minWidth ?? 1);
	const maxWidth = Math.max(minWidth, Math.min(usableWidth, hosted.maxWidth ?? usableWidth));
	const preferredWidth = hosted.preferredWidth ?? maxWidth;
	const requestedWidth = resolveDimension(options.width, termCols) ?? preferredWidth;
	const width = coerce(requestedWidth, minWidth, maxWidth);

	const minHeight = Math.max(1, hosted.minHeight ?? 1);
	const maxHeightLimit = resolveDimension(options.maxHeight, termRows) ?? hosted.maxHeight ?? usableHeight;
	const maxHeight = Math.max(minHeight, Math.min(usableHeight, maxHeightLimit));
	const preferredHeight = hosted.preferredHeight ?? maxHeight;
	const rendered = component.render(width);
	const intrinsicHeight = rendered.length || preferredHeight;
	const requestedHeight = Math.min(preferredHeight, intrinsicHeight, maxHeight);
	const height = coerce(requestedHeight, minHeight, maxHeight);
	(component as HostedLayoutCapable).setHostedViewportSize?.({ width, height });

	const anchor = options.anchor ?? "center";
	const explicitRow = resolveDimension(options.row, termRows);
	const explicitCol = resolveDimension(options.col, termCols);
	const offsetY = options.offsetY ?? 0;
	const offsetX = options.offsetX ?? 0;

	let row: number;
	let col: number;

	if (explicitRow !== undefined) {
		row = explicitRow;
	} else {
		switch (anchor) {
			case "top-left":
			case "top-center":
			case "top-right":
				row = margin.top + 1;
				break;
			case "left-center":
			case "center":
			case "right-center":
				row = margin.top + 1 + Math.floor((usableHeight - height) / 2);
				break;
			case "bottom-left":
			case "bottom-center":
			case "bottom-right":
				row = termRows - margin.bottom - height + 1;
				break;
			default:
				row = margin.top + 1 + Math.floor((usableHeight - height) / 2);
		}
	}

	if (explicitCol !== undefined) {
		col = explicitCol;
	} else {
		switch (anchor) {
			case "top-left":
			case "left-center":
			case "bottom-left":
				col = margin.left + 1;
				break;
			case "top-center":
			case "center":
			case "bottom-center":
				col = margin.left + 1 + Math.floor((usableWidth - width) / 2);
				break;
			case "top-right":
			case "right-center":
			case "bottom-right":
				col = termCols - margin.right - width + 1;
				break;
			default:
				col = margin.left + 1 + Math.floor((usableWidth - width) / 2);
		}
	}

	return {
		row: Math.max(1, Math.min(termRows - height + 1, row + offsetY)),
		col: Math.max(1, Math.min(termCols - width + 1, col + offsetX)),
		width,
		height,
	};
}
