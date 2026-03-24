import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { agentTheme } from "../../../src/theme.js";
import type { MouseEvent, Rect } from "../../../src/mouse.js";

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function padVisible(text: string, width: number): string {
	return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

export function calculatePanelWidths(totalWidth: number): { browserWidth: number; inspectorWidth: number; previewWidth: number; contentRightWidth: number } {
	const browserWidth = clamp(Math.floor(totalWidth * 0.24), 28, 38);
	const inspectorWidth = clamp(Math.floor(totalWidth * 0.28), 28, 42);
	const contentRightWidth = Math.max(20, totalWidth - browserWidth - 1);
	const previewWidth = Math.max(10, contentRightWidth - inspectorWidth - 1);
	return { browserWidth, inspectorWidth, previewWidth, contentRightWidth };
}

export function calculateBodyHeight(totalRows: number): number {
	return Math.max(10, totalRows - 5);
}

export function calculatePaneRects(totalWidth: number, contentTop: number, contentHeight: number, outerRightWidth: number, innerRightWidth: number): Record<"browser" | "preview" | "controls", Rect> {
	const browserWidth = totalWidth - outerRightWidth - 1;
	const previewWidth = Math.max(10, outerRightWidth - innerRightWidth - 1);
	return {
		browser: { row: contentTop, col: 1, width: browserWidth, height: contentHeight },
		preview: { row: contentTop, col: browserWidth + 2, width: previewWidth, height: contentHeight },
		controls: { row: contentTop, col: browserWidth + previewWidth + 3, width: innerRightWidth, height: contentHeight },
	};
}

export function renderPreviewFallback(width: number): string {
	return agentTheme.warning(truncateToWidth("No preview runtime available.", Math.max(1, width), ""));
}

export function eventHitsRect(event: MouseEvent, rect: Rect): boolean {
	return event.row >= rect.row && event.row < rect.row + rect.height && event.col >= rect.col && event.col < rect.col + rect.width;
}
