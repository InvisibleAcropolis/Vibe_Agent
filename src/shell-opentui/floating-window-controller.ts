import type { MouseEvent, Rect } from "../mouse.js";
import { pointInRect } from "../mouse.js";

export type FloatingWindowResizeEdge = "top" | "bottom" | "left" | "right";
export type FloatingWindowResizeHandle =
	| FloatingWindowResizeEdge
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right";

export interface FloatingWindowConstraints {
	minWidth: number;
	minHeight: number;
	preferredWidth: number;
	preferredHeight: number;
	maxWidth: number;
	maxHeight: number;
}

export interface FloatingWindowState {
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
		handle: FloatingWindowResizeHandle;
		origin: Rect;
		pointerOrigin: { row: number; col: number };
	} | null;
	constraints: FloatingWindowConstraints;
}

export interface FloatingWindowControllerOptions {
	title?: string;
	description?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	minWidth?: number;
	minHeight?: number;
	maxWidth?: number;
	maxHeight?: number;
	active?: boolean;
	zIndex?: number;
	onStateChange?: (model: FloatingWindowState) => void;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function resolveConstraints(
	options: Required<Pick<FloatingWindowControllerOptions, "minWidth" | "minHeight" | "maxWidth" | "maxHeight">>,
	terminal: { width: number; height: number },
): FloatingWindowConstraints {
	const minWidth = Math.max(18, options.minWidth);
	const minHeight = Math.max(8, options.minHeight);
	const maxWidth = Math.max(minWidth, Math.min(options.maxWidth, terminal.width));
	const maxHeight = Math.max(minHeight, Math.min(options.maxHeight, terminal.height));
	return {
		minWidth,
		minHeight,
		preferredWidth: clamp(48, minWidth, maxWidth),
		preferredHeight: clamp(14, minHeight, maxHeight),
		maxWidth,
		maxHeight,
	};
}

export class FloatingWindowController {
	private readonly title: string;
	private readonly description: string;
	private readonly onStateChange?: (model: FloatingWindowState) => void;
	private readonly sizeLimits: Required<Pick<FloatingWindowControllerOptions, "minWidth" | "minHeight" | "maxWidth" | "maxHeight">>;
	private terminalViewport = { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER };

	readonly model: FloatingWindowState;

	constructor(options: FloatingWindowControllerOptions = {}) {
		this.title = options.title ?? "Floating Window Test";
		this.description = options.description ?? "Empty floating window for drag and resize verification.";
		this.onStateChange = options.onStateChange;
		this.sizeLimits = {
			minWidth: options.minWidth ?? 18,
			minHeight: options.minHeight ?? 8,
			maxWidth: options.maxWidth ?? 120,
			maxHeight: options.maxHeight ?? 40,
		};
		this.model = {
			row: options.y ?? 5,
			col: options.x ?? 10,
			width: options.width ?? 48,
			height: options.height ?? 14,
			zIndex: options.zIndex ?? 0,
			active: options.active ?? true,
			dragState: null,
			resizeState: null,
			constraints: resolveConstraints(this.sizeLimits, this.terminalViewport),
		};
		this.reconcileWindowState(false);
	}

	getTitle(): string {
		return this.title;
	}

	getDescription(): string {
		return this.description;
	}

	getOverlayRect(): Rect {
		return {
			row: this.model.row,
			col: this.model.col,
			width: this.model.width,
			height: this.model.height,
		};
	}

	getContentViewport(): { width: number; height: number } {
		return {
			width: Math.max(0, this.model.width - 2),
			height: Math.max(0, this.model.height - 2),
		};
	}

	getFooterText(): string {
		return `${this.model.width}x${this.model.height}  Drag window  Resize borders`;
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

	setTerminalViewport(viewport: { width: number; height: number }): void {
		this.terminalViewport = viewport;
		this.reconcileWindowState(true);
	}

	handleMouse(event: MouseEvent): boolean {
		const rect = this.getOverlayRect();
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
				this.model.dragState = {
					origin: { row: event.row, col: event.col },
					windowOrigin: { row: this.model.row, col: this.model.col },
				};
				this.emitStateChange();
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

		if (event.action === "up" && event.button === "left") {
			if (this.model.dragState || this.model.resizeState) {
				this.model.dragState = null;
				this.model.resizeState = null;
				this.emitStateChange();
				return true;
			}
		}

		return pointInRect(event, rect);
	}

	dispose(): void {
		// No resources to release for the empty window test.
	}

	private hitResizeHandle(event: MouseEvent, rect: Rect): FloatingWindowResizeHandle | null {
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

	private refreshConstraints(): void {
		this.model.constraints = resolveConstraints(this.sizeLimits, this.terminalViewport);
	}

	private reconcileWindowState(emit: boolean): void {
		this.refreshConstraints();
		const nextWidth = clamp(this.model.width, this.model.constraints.minWidth, this.model.constraints.maxWidth);
		const nextHeight = clamp(this.model.height, this.model.constraints.minHeight, this.model.constraints.maxHeight);
		const nextRow = Math.max(1, Math.min(this.model.row, Math.max(1, this.terminalViewport.height - nextHeight + 1)));
		const nextCol = Math.max(1, Math.min(this.model.col, Math.max(1, this.terminalViewport.width - nextWidth + 1)));
		const changed = nextWidth !== this.model.width || nextHeight !== this.model.height || nextRow !== this.model.row || nextCol !== this.model.col;
		this.model.width = nextWidth;
		this.model.height = nextHeight;
		this.model.row = nextRow;
		this.model.col = nextCol;
		if (emit && changed) {
			this.emitStateChange();
		}
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
		this.model.row = Math.max(1, Math.min(nextRow, Math.max(1, this.terminalViewport.height - this.model.height + 1)));
		this.model.col = Math.max(1, Math.min(nextCol, Math.max(1, this.terminalViewport.width - this.model.width + 1)));
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
		const nextWidth = clamp(width, this.model.constraints.minWidth, this.model.constraints.maxWidth);
		const nextHeight = clamp(height, this.model.constraints.minHeight, this.model.constraints.maxHeight);
		if (state.handle.includes("left")) {
			col = state.origin.col + (state.origin.width - nextWidth);
		}
		if (state.handle.includes("top")) {
			row = state.origin.row + (state.origin.height - nextHeight);
		}
		this.model.width = nextWidth;
		this.model.height = nextHeight;
		this.model.row = Math.max(1, Math.min(row, Math.max(1, this.terminalViewport.height - nextHeight + 1)));
		this.model.col = Math.max(1, Math.min(col, Math.max(1, this.terminalViewport.width - nextWidth + 1)));
		this.emitStateChange();
	}
}
