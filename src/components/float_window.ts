import { truncateToWidth, visibleWidth, type Component } from "@mariozechner/pi-tui";
import { paintBoxLineTwoParts, paintLine, paintLineTwoParts } from "../ansi.js";
import type { MouseEvent, Rect } from "../mouse.js";
import { pointInRect } from "../mouse.js";
import { agentTheme } from "../theme.js";

export type FloatWindowResizeEdge = "top" | "bottom" | "left" | "right";
export type FloatWindowResizeHandle = FloatWindowResizeEdge | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface FloatWindowViewport {
	width: number;
	height: number;
}

export interface FloatWindowSizingRequirements {
	minWidth?: number;
	minHeight?: number;
	maxWidth?: number;
	maxHeight?: number;
}

export interface FloatWindowHostedElement extends Component {
	getSizingRequirements?(viewport: FloatWindowViewport): FloatWindowSizingRequirements;
	setViewportSize?(viewport: FloatWindowViewport): void;
	handleMouse?(event: MouseEvent, rect: Rect): boolean;
}

export interface FloatWindowHostedAdornment {
	anchor?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
	offsetRow?: number;
	offsetCol?: number;
	render(width: number, height: number): string[];
}

export interface FloatWindowFrameHints {
	drag?: string;
	resize?: string;
	close?: string;
}

export interface FloatWindowModel {
	row: number;
	col: number;
	width: number;
	height: number;
	zIndex: number;
	active: boolean;
	dragState: {
		origin: { row: number; col: number };
		windowOrigin: { row: number; col: number };
	} | null;
	resizeState: {
		handle: FloatWindowResizeHandle;
		origin: Rect;
		pointerOrigin: { row: number; col: number };
	} | null;
	constraints: Required<FloatWindowSizingRequirements>;
}

export interface FloatWindowOptions {
	title?: string;
	footer?: string;
	status?: string;
	content: FloatWindowHostedElement;
	children?: FloatWindowHostedAdornment[];
	hints?: FloatWindowFrameHints;
	minWidth?: number;
	minHeight?: number;
	maxWidth?: number;
	maxHeight?: number;
	initialState: Pick<FloatWindowModel, "row" | "col" | "width" | "height"> & Partial<Pick<FloatWindowModel, "zIndex" | "active">>;
	onStateChange?: (model: FloatWindowModel) => void;
}

const FRAME_WIDTH = 2;
const FRAME_HEIGHT = 3;
const FOOTER_HEIGHT = 1;
const MIN_CONTENT_WIDTH = 8;
const MIN_CONTENT_HEIGHT = 1;

function coerce(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function mergeConstraints(
	explicit: FloatWindowSizingRequirements,
	content: FloatWindowSizingRequirements,
	viewport: FloatWindowViewport,
): Required<FloatWindowSizingRequirements> {
	const contentMinWidth = Math.max(MIN_CONTENT_WIDTH, content.minWidth ?? MIN_CONTENT_WIDTH);
	const contentMinHeight = Math.max(MIN_CONTENT_HEIGHT, content.minHeight ?? MIN_CONTENT_HEIGHT);
	const baseMinWidth = FRAME_WIDTH + contentMinWidth;
	const baseMinHeight = FRAME_HEIGHT + contentMinHeight + FOOTER_HEIGHT;
	const maxWidth = Math.max(baseMinWidth, explicit.maxWidth ?? content.maxWidth ?? viewport.width);
	const maxHeight = Math.max(baseMinHeight, explicit.maxHeight ?? content.maxHeight ?? viewport.height);
	return {
		minWidth: Math.min(maxWidth, Math.max(baseMinWidth, explicit.minWidth ?? baseMinWidth)),
		minHeight: Math.min(maxHeight, Math.max(baseMinHeight, explicit.minHeight ?? baseMinHeight)),
		maxWidth,
		maxHeight,
	};
}

function composite(baseLines: string[], childLines: string[], row: number, col: number): string[] {
	const canvas = baseLines.map((line) => line.split(""));
	for (let lineIndex = 0; lineIndex < childLines.length; lineIndex++) {
		const targetRow = row + lineIndex;
		if (targetRow < 0 || targetRow >= canvas.length) {
			continue;
		}
		const source = childLines[lineIndex] ?? "";
		for (let charIndex = 0; charIndex < source.length; charIndex++) {
			const targetCol = col + charIndex;
			if (targetCol < 0 || targetCol >= canvas[targetRow]!.length) {
				continue;
			}
			canvas[targetRow]![targetCol] = source[charIndex]!;
		}
	}
	return canvas.map((rowChars) => rowChars.join(""));
}

export function adaptHostedComponent(component: Component): FloatWindowHostedElement {
	return {
		render: (width) => component.render(width),
		handleInput: component.handleInput?.bind(component),
		invalidate: () => component.invalidate(),
		wantsKeyRelease: component.wantsKeyRelease,
	};
}

export class FloatWindow implements FloatWindowHostedElement {
	private readonly title: string;
	private readonly children: FloatWindowHostedAdornment[];
	private readonly hints: Required<FloatWindowFrameHints>;
	private readonly onStateChange?: (model: FloatWindowModel) => void;
	private readonly explicitConstraints: FloatWindowSizingRequirements;
	private readonly footer?: string;
	private readonly status?: string;
	private lastViewport: FloatWindowViewport = { width: 0, height: 0 };
	private lastRect: Rect;
	readonly model: FloatWindowModel;

	constructor(options: FloatWindowOptions) {
		this.title = options.title ?? "Window";
		this.children = options.children ?? [];
		this.hints = {
			drag: options.hints?.drag ?? "Drag title bar",
			resize: options.hints?.resize ?? "Resize edges/corners",
			close: options.hints?.close ?? "Ctrl+C closes owner",
		};
		this.onStateChange = options.onStateChange;
		this.footer = options.footer;
		this.status = options.status;
		this.explicitConstraints = {
			minWidth: options.minWidth,
			minHeight: options.minHeight,
			maxWidth: options.maxWidth,
			maxHeight: options.maxHeight,
		};
		this.content = options.content;
		this.model = {
			row: options.initialState.row,
			col: options.initialState.col,
			width: options.initialState.width,
			height: options.initialState.height,
			zIndex: options.initialState.zIndex ?? 0,
			active: options.initialState.active ?? true,
			dragState: null,
			resizeState: null,
			constraints: mergeConstraints(this.explicitConstraints, {}, { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER }),
		};
		this.lastRect = { row: this.model.row, col: this.model.col, width: this.model.width, height: this.model.height };
		this.syncViewport();
	}

	readonly content: FloatWindowHostedElement;

	invalidate(): void {
		this.content.invalidate();
	}

	render(width: number): string[] {
		const windowWidth = Math.max(3, width);
		const viewport = this.getViewport(windowWidth, this.model.height);
		this.refreshConstraints(viewport);
		this.model.width = coerce(windowWidth, this.model.constraints.minWidth, this.model.constraints.maxWidth);
		const windowHeight = coerce(this.model.height, this.model.constraints.minHeight, this.model.constraints.maxHeight);
		this.model.height = windowHeight;
		this.lastRect = { row: this.model.row, col: this.model.col, width: this.model.width, height: this.model.height };
		this.syncViewport();

		const contentLines = this.content.render(viewport.width).slice(0, viewport.height);
		const clipped = contentLines.map((line) => paintLine(line, viewport.width, agentTheme.panelBgActive));
		while (clipped.length < viewport.height) {
			clipped.push(paintLine("", viewport.width, agentTheme.panelBgActive));
		}

		const border = this.model.active ? agentTheme.accentStrong : agentTheme.dim;
		const title = truncateToWidth(this.title, Math.max(0, windowWidth - 18), "…");
		const rightMeta = this.status
			? agentTheme.accent(` ${truncateToWidth(this.status, Math.max(0, windowWidth - 16), "…")} `)
			: this.model.active
				? agentTheme.accent(" ● active ")
				: agentTheme.muted(" ○ idle ");
		const topInner = paintBoxLineTwoParts(agentTheme.accentStrong(` ${title}`), rightMeta, Math.max(0, windowWidth - 2), "─", border);
		const lines: string[] = [`${border("╭")}${topInner}${border("╮")}`];
		for (const contentLine of clipped) {
			lines.push(`${border("│")}${contentLine}${border("│")}`);
		}
		const footerLeft = truncateToWidth(this.footer ?? this.footerText(), Math.max(0, windowWidth - 20), "…");
		const footerRight = agentTheme.dim(`${this.model.width}×${this.model.height}`);
		lines.push(`${border("├")}${paintLineTwoParts(footerLeft, footerRight, Math.max(0, windowWidth - 2), agentTheme.panelBgRaised)}${border("┤")}`);
		lines.push(border(`╰${agentTheme.dim("═".repeat(Math.max(0, windowWidth - 2)))}╯`));

		return this.renderChildren(lines, viewport);
	}

	handleInput(data: string): void {
		this.content.handleInput?.(data);
	}

	getSizingRequirements(viewport: FloatWindowViewport): FloatWindowSizingRequirements {
		this.refreshConstraints(viewport);
		return this.model.constraints;
	}

	setViewportSize(viewport: FloatWindowViewport): void {
		this.lastViewport = viewport;
		this.refreshConstraints(viewport);
		this.model.width = coerce(this.model.width, this.model.constraints.minWidth, this.model.constraints.maxWidth);
		this.model.height = coerce(this.model.height, this.model.constraints.minHeight, this.model.constraints.maxHeight);
		this.model.row = Math.max(1, Math.min(this.model.row, Math.max(1, viewport.height - this.model.height + 1)));
		this.model.col = Math.max(1, Math.min(this.model.col, Math.max(1, viewport.width - this.model.width + 1)));
		this.syncViewport();
		this.emitStateChange();
	}

	handleMouse(event: MouseEvent, rect: Rect): boolean {
		this.lastRect = rect;
		if (event.action === "down" && event.button === "left") {
			this.model.active = true;
			const handle = this.hitResizeHandle(event, rect);
			if (handle) {
				this.model.resizeState = {
					handle,
					origin: { ...rect },
					pointerOrigin: { row: event.row, col: event.col },
				};
				this.emitStateChange();
				return true;
			}
			if (event.row === rect.row) {
				this.model.dragState = {
					origin: { row: event.row, col: event.col },
					windowOrigin: { row: this.model.row, col: this.model.col },
				};
				this.emitStateChange();
				return true;
			}
			const viewportRect = this.getContentRect(rect);
			if (pointInRect(event, viewportRect)) {
				return this.content.handleMouse?.(event, viewportRect) ?? true;
			}
			return true;
		}

		if (event.action === "drag" && event.button === "left") {
			if (this.model.resizeState) {
				this.applyResize(event);
				return true;
			}
			if (this.model.dragState) {
				this.applyDrag(event);
				return true;
			}
		}

		if (event.action === "up") {
			if (this.model.dragState || this.model.resizeState) {
				this.model.dragState = null;
				this.model.resizeState = null;
				this.emitStateChange();
				return true;
			}
		}

		const viewportRect = this.getContentRect(rect);
		if (pointInRect(event, viewportRect)) {
			return this.content.handleMouse?.(event, viewportRect) ?? true;
		}
		return pointInRect(event, rect);
	}

	private footerText(): string {
		return [this.hints.drag, this.hints.resize, this.hints.close].filter(Boolean).join("  •  ");
	}

	private getViewport(windowWidth: number, windowHeight: number): FloatWindowViewport {
		return {
			width: Math.max(MIN_CONTENT_WIDTH, windowWidth - FRAME_WIDTH),
			height: Math.max(MIN_CONTENT_HEIGHT, windowHeight - FRAME_HEIGHT - FOOTER_HEIGHT),
		};
	}

	private getContentRect(rect: Rect): Rect {
		return {
			row: rect.row + 1,
			col: rect.col + 1,
			width: Math.max(0, rect.width - FRAME_WIDTH),
			height: Math.max(0, rect.height - FRAME_HEIGHT - FOOTER_HEIGHT),
		};
	}

	private renderChildren(baseLines: string[], viewport: FloatWindowViewport): string[] {
		let rendered = baseLines;
		for (const child of this.children) {
			const childLines = child.render(viewport.width, viewport.height);
			const childWidth = Math.max(0, ...childLines.map((line) => visibleWidth(line)));
			const row = child.anchor?.startsWith("bottom") ? Math.max(1, viewport.height - childLines.length) : 1;
			const col = child.anchor?.endsWith("right") ? Math.max(0, viewport.width - childWidth) : 0;
			rendered = composite(rendered, childLines, row + (child.offsetRow ?? 0), 1 + col + (child.offsetCol ?? 0));
		}
		return rendered;
	}

	private refreshConstraints(viewport: FloatWindowViewport): void {
		const hosted = this.content.getSizingRequirements?.(viewport) ?? {};
		this.model.constraints = mergeConstraints(this.explicitConstraints, hosted, {
			width: Math.max(viewport.width + FRAME_WIDTH, this.lastViewport.width || viewport.width + FRAME_WIDTH),
			height: Math.max(viewport.height + FRAME_HEIGHT + FOOTER_HEIGHT, this.lastViewport.height || viewport.height + FRAME_HEIGHT + FOOTER_HEIGHT),
		});
	}

	private syncViewport(): void {
		this.content.setViewportSize?.(this.getViewport(this.model.width, this.model.height));
	}

	private emitStateChange(): void {
		this.onStateChange?.(this.model);
	}

	private hitResizeHandle(event: MouseEvent, rect: Rect): FloatWindowResizeHandle | null {
		const top = event.row === rect.row;
		const bottom = event.row === rect.row + rect.height - 1;
		const left = event.col === rect.col;
		const right = event.col === rect.col + rect.width - 1;
		if (top && left) return "top-left";
		if (top && right) return "top-right";
		if (bottom && left) return "bottom-left";
		if (bottom && right) return "bottom-right";
		if (top) return "top";
		if (bottom) return "bottom";
		if (left) return "left";
		if (right) return "right";
		return null;
	}

	private applyDrag(event: MouseEvent): void {
		const state = this.model.dragState;
		if (!state) {
			return;
		}
		const nextRow = state.windowOrigin.row + (event.row - state.origin.row);
		const nextCol = state.windowOrigin.col + (event.col - state.origin.col);
		this.model.row = Math.max(1, Math.min(nextRow, Math.max(1, this.lastViewport.height - this.model.height + 1)));
		this.model.col = Math.max(1, Math.min(nextCol, Math.max(1, this.lastViewport.width - this.model.width + 1)));
		this.emitStateChange();
	}

	private applyResize(event: MouseEvent): void {
		const state = this.model.resizeState;
		if (!state) {
			return;
		}
		const deltaRow = event.row - state.pointerOrigin.row;
		const deltaCol = event.col - state.pointerOrigin.col;
		let { row, col, width, height } = state.origin;
		if (state.handle.includes("right")) width += deltaCol;
		if (state.handle.includes("left")) {
			width -= deltaCol;
			col += deltaCol;
		}
		if (state.handle.includes("bottom")) height += deltaRow;
		if (state.handle.includes("top")) {
			height -= deltaRow;
			row += deltaRow;
		}
		width = coerce(width, this.model.constraints.minWidth, this.model.constraints.maxWidth);
		height = coerce(height, this.model.constraints.minHeight, this.model.constraints.maxHeight);
		this.model.width = width;
		this.model.height = height;
		this.model.row = Math.max(1, Math.min(row, Math.max(1, this.lastViewport.height - height + 1)));
		this.model.col = Math.max(1, Math.min(col, Math.max(1, this.lastViewport.width - width + 1)));
		this.syncViewport();
		this.emitStateChange();
	}
}
