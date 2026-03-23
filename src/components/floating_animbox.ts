import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { paintBoxLineTwoParts, paintLine, paintLineTwoParts } from "../ansi.js";
import type { MouseEvent, Rect } from "../mouse.js";
import { pointInRect } from "../mouse.js";
import { createPlaceholderRuntime } from "../style-test-fixtures.js";
import { defineStyleTestDemos, type StyleTestRuntimeContext } from "../style-test-contract.js";
import { agentTheme, createDynamicTheme } from "../theme.js";
import type { HostedLayoutCapable, HostedSizeRequirements, HostedViewportDimensions } from "../types.js";
import { animPreloadService } from "./animpreload-service.js";

export interface FloatingAnimBoxPreset {
	sourceFile: string;
	exportName: string;
	animationPresetId: string;
	cols: number;
	rows: number;
	x: number;
	y: number;
}

export type FloatingAnimBoxResizeEdge = "top" | "bottom" | "left" | "right";
export type FloatingAnimBoxResizeHandle =
	| FloatingAnimBoxResizeEdge
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right";

export interface FloatingAnimBoxConstraints {
	minWidth: number;
	minHeight: number;
	preferredWidth: number;
	preferredHeight: number;
	maxWidth: number;
	maxHeight: number;
}

export interface FloatingAnimBoxWindowState {
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
		handle: FloatingAnimBoxResizeHandle;
		origin: Rect;
		pointerOrigin: { row: number; col: number };
	} | null;
	constraints: FloatingAnimBoxConstraints;
}

export interface FloatingAnimBoxWindowOptions {
	title?: string;
	instanceId?: string;
	active?: boolean;
	zIndex?: number;
	minCols?: number;
	minRows?: number;
	maxCols?: number;
	maxRows?: number;
	onStateChange?: (model: FloatingAnimBoxWindowState) => void;
	onViewportChange?: (viewport: HostedViewportDimensions) => void;
}

const FRAME_HORIZONTAL_CHROME = 2;
const FRAME_VERTICAL_CHROME = 4;
const TITLE_BAR_HEIGHT = 1;
const MIN_CONTENT_WIDTH = 8;
const MIN_CONTENT_HEIGHT = 4;

export const DEFAULT_FLOATING_ANIMBOX_PRESET: FloatingAnimBoxPreset = {
	sourceFile: "src/components/anim_plasma.ts",
	exportName: "renderPlasma",
	animationPresetId: "default",
	cols: 40,
	rows: 12,
	x: 10,
	y: 5,
};

function coerce(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function toWindowWidth(contentWidth: number): number {
	return Math.max(FRAME_HORIZONTAL_CHROME + MIN_CONTENT_WIDTH, contentWidth + FRAME_HORIZONTAL_CHROME);
}

function toWindowHeight(contentHeight: number): number {
	return Math.max(FRAME_VERTICAL_CHROME + MIN_CONTENT_HEIGHT, contentHeight + FRAME_VERTICAL_CHROME);
}

function toContentViewport(windowWidth: number, windowHeight: number): HostedViewportDimensions {
	return {
		width: Math.max(MIN_CONTENT_WIDTH, windowWidth - FRAME_HORIZONTAL_CHROME),
		height: Math.max(MIN_CONTENT_HEIGHT, windowHeight - FRAME_VERTICAL_CHROME),
	};
}

function resolveConstraints(
	limits: { minCols: number; minRows: number; maxCols: number; maxRows: number },
	preferredCols: number,
	preferredRows: number,
	terminal: HostedViewportDimensions,
): FloatingAnimBoxConstraints {
	const terminalMaxWidth = Math.max(toWindowWidth(limits.minCols), terminal.width);
	const terminalMaxHeight = Math.max(toWindowHeight(limits.minRows), terminal.height);
	const minWidth = Math.max(toWindowWidth(limits.minCols), toWindowWidth(MIN_CONTENT_WIDTH));
	const minHeight = Math.max(toWindowHeight(limits.minRows), toWindowHeight(MIN_CONTENT_HEIGHT));
	const maxWidth = Math.max(minWidth, Math.min(terminalMaxWidth, toWindowWidth(limits.maxCols)));
	const maxHeight = Math.max(minHeight, Math.min(terminalMaxHeight, toWindowHeight(limits.maxRows)));
	return {
		minWidth,
		minHeight,
		preferredWidth: coerce(toWindowWidth(preferredCols), minWidth, maxWidth),
		preferredHeight: coerce(toWindowHeight(preferredRows), minHeight, maxHeight),
		maxWidth,
		maxHeight,
	};
}

function sliceVisibleAnsi(text: string, start: number, width: number): string {
	if (width <= 0) {
		return "";
	}
	let visibleIndex = 0;
	let inEscape = false;
	let output = "";
	for (let index = 0; index < text.length; index++) {
		const char = text[index] ?? "";
		if (char === "\x1b") {
			inEscape = true;
			if (visibleIndex >= start && visibleIndex < start + width) {
				output += char;
			}
			continue;
		}
		if (inEscape) {
			if (visibleIndex >= start && visibleIndex < start + width) {
				output += char;
			}
			if (char === "m") {
				inEscape = false;
			}
			continue;
		}
		if (visibleIndex >= start && visibleIndex < start + width) {
			output += char;
		}
		visibleIndex++;
		if (visibleIndex >= start + width) {
			break;
		}
	}
	return output;
}

function padViewportLine(text: string, width: number): string {
	const clipped = sliceVisibleAnsi(text, 0, width);
	const truncated = truncateToWidth(clipped, width, "");
	return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function buildFallbackLines(message: string, preset: FloatingAnimBoxPreset, height: number): string[] {
	const base = [
		agentTheme.warning("Floating Animbox target unavailable"),
		agentTheme.text(message),
		agentTheme.dim(`${preset.sourceFile}#${preset.exportName}`),
		agentTheme.dim(`animation preset: ${preset.animationPresetId}`),
	];
	return [...base, ...Array.from({ length: Math.max(0, height - base.length) }, () => "")];
}

export class FloatingAnimBoxWindow implements HostedLayoutCapable {
	private readonly title: string;
	private readonly instanceId: string;
	private readonly onStateChange?: (model: FloatingAnimBoxWindowState) => void;
	private readonly onViewportChange?: (viewport: HostedViewportDimensions) => void;
	private readonly limits: { minCols: number; minRows: number; maxCols: number; maxRows: number };
	private lastTerminalViewport: HostedViewportDimensions = { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER };
	private preset: FloatingAnimBoxPreset;
	readonly model: FloatingAnimBoxWindowState;

	constructor(
		private readonly context: StyleTestRuntimeContext,
		preset: FloatingAnimBoxPreset,
		options: FloatingAnimBoxWindowOptions = {},
	) {
		this.title = options.title ?? "Floating Animbox";
		this.instanceId = options.instanceId ?? "floating-animbox";
		this.onStateChange = options.onStateChange;
		this.onViewportChange = options.onViewportChange;
		this.limits = {
			minCols: options.minCols ?? 8,
			minRows: options.minRows ?? 4,
			maxCols: options.maxCols ?? 120,
			maxRows: options.maxRows ?? 40,
		};
		this.preset = { ...preset };
		this.model = {
			row: preset.y,
			col: preset.x,
			width: toWindowWidth(preset.cols),
			height: toWindowHeight(preset.rows),
			zIndex: options.zIndex ?? 0,
			active: options.active ?? true,
			dragState: null,
			resizeState: null,
			constraints: resolveConstraints(this.limits, preset.cols, preset.rows, this.lastTerminalViewport),
		};
		this.reconcileWindowState(false);
	}

	invalidate(): void {}

	getPreset(): FloatingAnimBoxPreset {
		const viewport = this.getContentViewport();
		return {
			...this.preset,
			cols: viewport.width,
			rows: viewport.height,
			x: this.model.col,
			y: this.model.row,
		};
	}

	setPreset(preset: FloatingAnimBoxPreset): void {
		const previousViewport = this.getContentViewport();
		this.preset = { ...preset };
		this.model.row = preset.y;
		this.model.col = preset.x;
		this.model.width = toWindowWidth(preset.cols);
		this.model.height = toWindowHeight(preset.rows);
		this.reconcileWindowState(true);
		this.emitViewportChangeIfNeeded(previousViewport);
	}

	getOverlayRect(): Rect {
		return {
			row: this.model.row,
			col: this.model.col,
			width: this.model.width,
			height: this.model.height,
		};
	}

	isPointerCaptureActive(): boolean {
		return !!this.model.dragState || !!this.model.resizeState;
	}

	setOverlayActive(active: boolean, zIndex: number): void {
		if (this.model.active === active && this.model.zIndex === zIndex) {
			return;
		}
		this.model.active = active;
		this.model.zIndex = zIndex;
		this.emitStateChange();
	}

	getHostedSizeRequirements(): HostedSizeRequirements {
		this.refreshConstraints();
		return {
			minWidth: this.model.constraints.minWidth,
			minHeight: this.model.constraints.minHeight,
			preferredWidth: this.model.width,
			preferredHeight: this.model.height,
			maxWidth: this.model.constraints.maxWidth,
			maxHeight: this.model.constraints.maxHeight,
		};
	}

	setHostedViewportSize(viewport: HostedViewportDimensions): void {
		this.lastTerminalViewport = viewport;
		this.reconcileWindowState(true);
	}

	render(width: number): string[] {
		if (width !== this.model.width) {
			this.model.width = width;
		}
		this.reconcileWindowState(false);
		const viewport = this.getContentViewport();
		const contentLines = this.renderAnimation(viewport);
		const border = this.model.active ? agentTheme.accentStrong : agentTheme.dim;
		const title = truncateToWidth(this.title, Math.max(0, this.model.width - 18), "…");
		const statusText = `${this.preset.exportName} · ${this.preset.animationPresetId}`;
		const rightMeta = this.model.active
			? agentTheme.accent(` ${truncateToWidth(statusText, Math.max(0, this.model.width - 16), "…")} `)
			: agentTheme.muted(` ${truncateToWidth(statusText, Math.max(0, this.model.width - 16), "…")} `);
		const topInner = paintBoxLineTwoParts(agentTheme.accentStrong(` ${title}`), rightMeta, Math.max(0, this.model.width - 2), "─", border);
		const lines: string[] = [`${border("╭")}${topInner}${border("╮")}`];
		for (const contentLine of contentLines) {
			lines.push(`${border("│")}${paintLine(contentLine, viewport.width, agentTheme.panelBgActive)}${border("│")}`);
		}
		const footerLeft = truncateToWidth(this.footerText(), Math.max(0, this.model.width - 20), "…");
		const footerRight = agentTheme.dim(`${viewport.width}×${viewport.height}`);
		lines.push(`${border("├")}${paintLineTwoParts(footerLeft, footerRight, Math.max(0, this.model.width - 2), agentTheme.panelBgRaised)}${border("┤")}`);
		lines.push(border(`╰${agentTheme.dim("═".repeat(Math.max(0, this.model.width - 2)))}╯`));
		return lines;
	}

	handleMouse(event: MouseEvent, rect: Rect): boolean {
		if (event.action === "down" && event.button === "left") {
			this.model.active = true;
			const resizeHandle = this.hitResizeHandle(event, rect);
			if (resizeHandle) {
				this.model.resizeState = {
					handle: resizeHandle,
					origin: { ...rect },
					pointerOrigin: { row: event.row, col: event.col },
				};
				this.emitStateChange();
				return true;
			}
			if (pointInRect(event, rect)) {
				this.beginDrag(event);
				return true;
			}
			return false;
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

		return pointInRect(event, rect);
	}

	private footerText(): string {
		return "Drag anywhere inside  •  Resize edges/corners  •  Ctrl+C closes owner";
	}

	private getContentViewport(): HostedViewportDimensions {
		return toContentViewport(this.model.width, this.model.height);
	}

	private getContentRect(rect: Rect): Rect {
		return {
			row: rect.row + TITLE_BAR_HEIGHT,
			col: rect.col + 1,
			width: Math.max(0, rect.width - FRAME_HORIZONTAL_CHROME),
			height: Math.max(0, rect.height - FRAME_VERTICAL_CHROME),
		};
	}

	private getTitleDragBounds(rect: Rect): { startCol: number; endCol: number } | null {
		const title = truncateToWidth(this.title, Math.max(0, rect.width - 18), "…");
		if (title.length === 0) {
			return null;
		}
		const startCol = rect.col + 2;
		return { startCol, endCol: startCol + title.length - 1 };
	}

	private isTitleMoveHit(event: MouseEvent, rect: Rect): boolean {
		if (event.row !== rect.row) {
			return false;
		}
		const bounds = this.getTitleDragBounds(rect);
		return !!bounds && event.col >= bounds.startCol && event.col <= bounds.endCol;
	}

	private beginDrag(event: MouseEvent): void {
		this.model.dragState = {
			origin: { row: event.row, col: event.col },
			windowOrigin: { row: this.model.row, col: this.model.col },
		};
		this.emitStateChange();
	}

	private hitResizeHandle(event: MouseEvent, rect: Rect): FloatingAnimBoxResizeHandle | null {
		const titleBounds = this.getTitleDragBounds(rect);
		const onTopBorder = event.row === rect.row;
		const onTopResizeBand = onTopBorder && !(titleBounds && event.col >= titleBounds.startCol && event.col <= titleBounds.endCol);
		const onBottomResizeBand = event.row >= rect.row + rect.height - 2 && event.row <= rect.row + rect.height - 1;
		const onLeftEdge = event.col === rect.col;
		const onRightEdge = event.col === rect.col + rect.width - 1;
		if (onTopResizeBand && onLeftEdge) return "top-left";
		if (onTopResizeBand && onRightEdge) return "top-right";
		if (onBottomResizeBand && onLeftEdge) return "bottom-left";
		if (onBottomResizeBand && onRightEdge) return "bottom-right";
		if (onTopResizeBand) return "top";
		if (onBottomResizeBand) return "bottom";
		if (onLeftEdge) return "left";
		if (onRightEdge) return "right";
		return null;
	}

	private renderAnimation(viewport: HostedViewportDimensions): string[] {
		const handle = animPreloadService.getOrCreateInstance(
			{
				sourceFile: this.preset.sourceFile,
				exportName: this.preset.exportName,
				presetId: this.preset.animationPresetId,
				instanceId: this.instanceId,
			},
			this.context,
		);
		let contentLines: string[];
		try {
			contentLines = animPreloadService.renderInstance(handle, viewport.width, viewport.height);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			contentLines = buildFallbackLines(message, this.preset, viewport.height);
		}
		const dynamicTheme = createDynamicTheme(this.context.getAnimationState());
		return Array.from({ length: viewport.height }, (_, index) => {
			const line = padViewportLine(contentLines[index] ?? "", viewport.width);
			return index === viewport.height - 1 && viewport.height > 2
				? dynamicTheme.borderAnimated(line)
				: line;
		});
	}

	private refreshConstraints(): void {
		this.model.constraints = resolveConstraints(
			this.limits,
			this.getPreset().cols,
			this.getPreset().rows,
			this.lastTerminalViewport,
		);
	}

	private reconcileWindowState(emit: boolean): void {
		const previousViewport = this.getContentViewport();
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
		if (emit && changed) {
			this.emitStateChange();
		}
		this.emitViewportChangeIfNeeded(previousViewport);
	}

	private emitViewportChangeIfNeeded(previousViewport: HostedViewportDimensions): void {
		const nextViewport = this.getContentViewport();
		if (previousViewport.width === nextViewport.width && previousViewport.height === nextViewport.height) {
			return;
		}
		this.onViewportChange?.(nextViewport);
	}

	private emitStateChange(): void {
		this.onStateChange?.(this.model);
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
		const previousViewport = this.getContentViewport();
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
		this.emitStateChange();
		this.emitViewportChangeIfNeeded(previousViewport);
	}
}

export function createFloatingAnimBoxWindow(
	preset: FloatingAnimBoxPreset,
	context: StyleTestRuntimeContext,
	options: FloatingAnimBoxWindowOptions = {},
): FloatingAnimBoxWindow {
	return new FloatingAnimBoxWindow(context, preset, options);
}

export const styleTestDemos = defineStyleTestDemos({
	autoExports: false,
	exports: {
		floatingAnimBoxReference: {
			title: "Floating Animbox",
			category: "Primitives",
			kind: "placeholder",
			description: "Specialized floating animation window. Open it from TUIstyletest with F9.",
			createRuntime: () =>
				createPlaceholderRuntime(
					"Floating Animbox",
					"Open TUIstyletest and press F9 to launch the floating animbox window and preset designer.",
					"src/components/floating_animbox.ts",
				),
		},
	},
});
