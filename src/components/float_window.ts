import { truncateToWidth, visibleWidth, type Component } from "@mariozechner/pi-tui";
import { paintBoxLineTwoParts, paintLine, paintLineTwoParts } from "../ansi.js";
import type { MouseEvent, Rect } from "../mouse.js";
import { pointInRect } from "../mouse.js";
import { agentTheme } from "../theme.js";
import type { HostedLayoutCapable, HostedSizeRequirements, HostedViewportDimensions } from "../types.js";

export type FloatWindowResizeEdge = "top" | "bottom" | "left" | "right";
export type FloatWindowResizeHandle = FloatWindowResizeEdge | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type FloatWindowViewport = HostedViewportDimensions;
export type FloatWindowSizingRequirements = HostedSizeRequirements;

export interface FloatWindowHostedElement extends HostedLayoutCapable {
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

export interface FloatWindowResolvedConstraints {
	minWidth: number;
	minHeight: number;
	preferredWidth: number;
	preferredHeight: number;
	maxWidth: number;
	maxHeight: number;
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
	constraints: FloatWindowResolvedConstraints;
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

const FRAME_HORIZONTAL_CHROME = 2;
const FRAME_VERTICAL_CHROME = 4;
const TITLE_BAR_HEIGHT = 1;
const FOOTER_HEIGHT = 1;
const MIN_CONTENT_WIDTH = 8;
const MIN_CONTENT_HEIGHT = 1;

function coerce(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function toWindowWidth(contentWidth: number): number {
	return Math.max(FRAME_HORIZONTAL_CHROME + MIN_CONTENT_WIDTH, contentWidth + FRAME_HORIZONTAL_CHROME);
}

function toWindowHeight(contentHeight: number): number {
	return Math.max(FRAME_VERTICAL_CHROME + MIN_CONTENT_HEIGHT, contentHeight + FRAME_VERTICAL_CHROME);
}

function toContentViewport(windowWidth: number, windowHeight: number): FloatWindowViewport {
	return {
		width: Math.max(MIN_CONTENT_WIDTH, windowWidth - FRAME_HORIZONTAL_CHROME),
		height: Math.max(MIN_CONTENT_HEIGHT, windowHeight - FRAME_VERTICAL_CHROME),
	};
}

function mergeConstraints(
	explicit: FloatWindowSizingRequirements,
	hosted: FloatWindowSizingRequirements,
	terminal: HostedViewportDimensions,
): FloatWindowResolvedConstraints {
	const terminalMaxWidth = Math.max(toWindowWidth(MIN_CONTENT_WIDTH), terminal.width);
	const terminalMaxHeight = Math.max(toWindowHeight(MIN_CONTENT_HEIGHT), terminal.height);
	const minWidth = Math.max(
		toWindowWidth(hosted.minWidth ?? MIN_CONTENT_WIDTH),
		explicit.minWidth ?? 0,
		toWindowWidth(MIN_CONTENT_WIDTH),
	);
	const minHeight = Math.max(
		toWindowHeight(hosted.minHeight ?? MIN_CONTENT_HEIGHT),
		explicit.minHeight ?? 0,
		toWindowHeight(MIN_CONTENT_HEIGHT),
	);
	const maxWidth = Math.max(minWidth, Math.min(terminalMaxWidth, explicit.maxWidth ?? hosted.maxWidth ?? terminalMaxWidth));
	const maxHeight = Math.max(minHeight, Math.min(terminalMaxHeight, explicit.maxHeight ?? hosted.maxHeight ?? terminalMaxHeight));
	const preferredWidth = coerce(
		toWindowWidth(hosted.preferredWidth ?? hosted.minWidth ?? MIN_CONTENT_WIDTH),
		minWidth,
		maxWidth,
	);
	const preferredHeight = coerce(
		toWindowHeight(hosted.preferredHeight ?? hosted.minHeight ?? MIN_CONTENT_HEIGHT),
		minHeight,
		maxHeight,
	);
	return {
		minWidth,
		minHeight,
		preferredWidth,
		preferredHeight,
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
	const hosted = component as HostedLayoutCapable;
	return {
		render: (width) => component.render(width),
		handleInput: component.handleInput?.bind(component),
		invalidate: () => component.invalidate(),
		wantsKeyRelease: component.wantsKeyRelease,
		getHostedSizeRequirements: hosted.getHostedSizeRequirements?.bind(component),
		setHostedViewportSize: hosted.setHostedViewportSize?.bind(component),
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
	private lastTerminalViewport: HostedViewportDimensions = { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER };
	private lastRect: Rect;
	readonly model: FloatWindowModel;
	readonly content: FloatWindowHostedElement;

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
			constraints: mergeConstraints(this.explicitConstraints, {}, this.lastTerminalViewport),
		};
		this.lastRect = { row: this.model.row, col: this.model.col, width: this.model.width, height: this.model.height };
		this.reconcileWindowState(false);
	}

	invalidate(): void {
		this.content.invalidate();
	}

	render(width: number): string[] {
		if (width !== this.model.width) {
			this.model.width = width;
		}
		this.reconcileWindowState(false);
		const viewport = toContentViewport(this.model.width, this.model.height);
		this.lastRect = { row: this.model.row, col: this.model.col, width: this.model.width, height: this.model.height };

		const contentLines = this.content.render(viewport.width).slice(0, viewport.height);
		const clipped = contentLines.map((line) => paintLine(line, viewport.width, agentTheme.panelBgActive));
		while (clipped.length < viewport.height) {
			clipped.push(paintLine("", viewport.width, agentTheme.panelBgActive));
		}

		const border = this.model.active ? agentTheme.accentStrong : agentTheme.dim;
		const title = truncateToWidth(this.title, Math.max(0, this.model.width - 18), "…");
		const rightMeta = this.status
			? agentTheme.accent(` ${truncateToWidth(this.status, Math.max(0, this.model.width - 16), "…")} `)
			: this.model.active
				? agentTheme.accent(" ● active ")
				: agentTheme.muted(" ○ idle ");
		const topInner = paintBoxLineTwoParts(agentTheme.accentStrong(` ${title}`), rightMeta, Math.max(0, this.model.width - 2), "─", border);
		const lines: string[] = [`${border("╭")}${topInner}${border("╮")}`];
		for (const contentLine of clipped) {
			lines.push(`${border("│")}${contentLine}${border("│")}`);
		}
		const footerLeft = truncateToWidth(this.footer ?? this.footerText(), Math.max(0, this.model.width - 20), "…");
		const footerRight = agentTheme.dim(`${this.model.width}×${this.model.height}`);
		lines.push(`${border("├")}${paintLineTwoParts(footerLeft, footerRight, Math.max(0, this.model.width - 2), agentTheme.panelBgRaised)}${border("┤")}`);
		lines.push(border(`╰${agentTheme.dim("═".repeat(Math.max(0, this.model.width - 2)))}╯`));

		return this.renderChildren(lines, viewport);
	}

	handleInput(data: string): void {
		this.content.handleInput?.(data);
	}

	getSizingRequirements(viewport: FloatWindowViewport): FloatWindowSizingRequirements {
		return this.getHostedSizeRequirements(viewport);
	}

	getHostedSizeRequirements(viewport: FloatWindowViewport): FloatWindowSizingRequirements {
		this.lastTerminalViewport = viewport;
		this.refreshConstraints();
		return this.model.constraints;
	}

	setViewportSize(viewport: FloatWindowViewport): void {
		this.setHostedViewportSize(viewport);
	}

	setHostedViewportSize(viewport: FloatWindowViewport): void {
		this.lastTerminalViewport = viewport;
		this.reconcileWindowState(true);
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

	private getContentRect(rect: Rect): Rect {
		return {
			row: rect.row + TITLE_BAR_HEIGHT,
			col: rect.col + 1,
			width: Math.max(0, rect.width - FRAME_HORIZONTAL_CHROME),
			height: Math.max(0, rect.height - FRAME_VERTICAL_CHROME),
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

	private refreshConstraints(): void {
		const hostedViewportHint = toContentViewport(this.model.width, this.model.height);
		const hosted = this.content.getHostedSizeRequirements?.(hostedViewportHint) ?? {};
		this.model.constraints = mergeConstraints(this.explicitConstraints, hosted, this.lastTerminalViewport);
	}

	private reconcileWindowState(emit: boolean): void {
		this.refreshConstraints();
		const nextWidth = coerce(this.model.width || this.model.constraints.preferredWidth, this.model.constraints.minWidth, this.model.constraints.maxWidth);
		const nextHeight = coerce(this.model.height || this.model.constraints.preferredHeight, this.model.constraints.minHeight, this.model.constraints.maxHeight);
		const nextRow = Math.max(1, Math.min(this.model.row, Math.max(1, this.lastTerminalViewport.height - nextHeight + 1)));
		const nextCol = Math.max(1, Math.min(this.model.col, Math.max(1, this.lastTerminalViewport.width - nextWidth + 1)));
		const changed = nextWidth !== this.model.width || nextHeight !== this.model.height || nextRow !== this.model.row || nextCol !== this.model.col;
		this.model.width = nextWidth;
		this.model.height = nextHeight;
		this.model.row = nextRow;
		this.model.col = nextCol;
		this.content.setHostedViewportSize?.(toContentViewport(this.model.width, this.model.height));
		if (emit && changed) {
			this.emitStateChange();
		}
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
		this.model.row = Math.max(1, Math.min(nextRow, Math.max(1, this.lastTerminalViewport.height - this.model.height + 1)));
		this.model.col = Math.max(1, Math.min(nextCol, Math.max(1, this.lastTerminalViewport.width - this.model.width + 1)));
		this.emitStateChange();
	}

	private applyResize(event: MouseEvent): void {
		const state = this.model.resizeState;
		if (!state) {
			return;
		}
		this.refreshConstraints();
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
		const nextWidth = coerce(width, this.model.constraints.minWidth, this.model.constraints.maxWidth);
		const nextHeight = coerce(height, this.model.constraints.minHeight, this.model.constraints.maxHeight);
		if (state.handle.includes("left")) {
			col = state.origin.col + (state.origin.width - nextWidth);
		}
		if (state.handle.includes("top")) {
			row = state.origin.row + (state.origin.height - nextHeight);
		}
		this.model.width = nextWidth;
		this.model.height = nextHeight;
		this.model.row = Math.max(1, Math.min(row, Math.max(1, this.lastTerminalViewport.height - nextHeight + 1)));
		this.model.col = Math.max(1, Math.min(col, Math.max(1, this.lastTerminalViewport.width - nextWidth + 1)));
		this.content.setHostedViewportSize?.(toContentViewport(this.model.width, this.model.height));
		this.emitStateChange();
	}
}
