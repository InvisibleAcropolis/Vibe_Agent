import { getActiveTheme, type ThemeName } from "../themes/index.js";
import { renderPlasma, PLASMA_DEFAULTS, type PlasmaOptions } from "../components/anim_plasma.js";
import { animPreloadService } from "../components/animpreload-service.js";
import type { MouseEvent, Rect } from "../mouse.js";
import { pointInRect } from "../mouse.js";
import type {
	StyleTestControl,
	StyleTestDemoDefinition,
	StyleTestRuntime,
	StyleTestRuntimeContext,
} from "../style-test-contract.js";

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

export interface FloatingAnimBoxControllerOptions {
	title?: string;
	instanceId?: string;
	active?: boolean;
	zIndex?: number;
	minCols?: number;
	minRows?: number;
	maxCols?: number;
	maxRows?: number;
	onStateChange?: (model: FloatingAnimBoxWindowState) => void;
}

export interface FloatingAnimboxTextSegment {
	text: string;
	fg?: string;
}

const FRAME_HORIZONTAL_CHROME = 2;
const FRAME_VERTICAL_CHROME = 4;
const MIN_CONTENT_WIDTH = 8;
const MIN_CONTENT_HEIGHT = 4;

const BASIC_ANSI_COLORS = new Map<number, string>([
	[30, "#000000"],
	[31, "#aa0000"],
	[32, "#00aa00"],
	[33, "#aa5500"],
	[34, "#0000aa"],
	[35, "#aa00aa"],
	[36, "#00aaaa"],
	[37, "#aaaaaa"],
	[90, "#555555"],
	[91, "#ff5555"],
	[92, "#55ff55"],
	[93, "#ffff55"],
	[94, "#5555ff"],
	[95, "#ff55ff"],
	[96, "#55ffff"],
	[97, "#ffffff"],
]);

const PLASMA_SOURCE_FILE = "src/components/anim_plasma.ts";
const PLASMA_EXPORT_NAME = "renderPlasma";
const PLASMA_DEMO_ID = `${PLASMA_SOURCE_FILE}#${PLASMA_EXPORT_NAME}`;

const PLASMA_DEMO_CONTROLS: StyleTestControl[] = [
	{ id: "cols", label: "Cols", type: "number", defaultValue: PLASMA_DEFAULTS.cols, min: 4, max: 120, step: 1 },
	{ id: "rows", label: "Rows", type: "number", defaultValue: PLASMA_DEFAULTS.rows, min: 4, max: 40, step: 1 },
];

const PLASMA_DEMO: StyleTestDemoDefinition = {
	id: PLASMA_DEMO_ID,
	title: "Plasma",
	category: "Animations",
	sourceFile: PLASMA_SOURCE_FILE,
	kind: "animation",
	description: "Live plasma field animation for shell-hosted overlays.",
	controls: PLASMA_DEMO_CONTROLS,
	loadValues: () => ({ ...PLASMA_DEFAULTS }),
	createRuntime: (context, values): StyleTestRuntime => ({
		render(cols: number, rows: number) {
			return renderPlasma(context.getAnimationState(), context.getTheme(), {
				...(values as PlasmaOptions),
				cols,
				rows,
			}).split("\n");
		},
	}),
};

export const DEFAULT_FLOATING_ANIMBOX_PRESET: FloatingAnimBoxPreset = {
	sourceFile: PLASMA_SOURCE_FILE,
	exportName: PLASMA_EXPORT_NAME,
	animationPresetId: "default",
	cols: 40,
	rows: 12,
	x: 10,
	y: 5,
};

export function createOpenTuiAnimboxRuntimeContext(): StyleTestRuntimeContext {
	return {
		tui: undefined as never,
		getAnimationState: () => {
			throw new Error("Anim preload should replace getAnimationState with the instance animation engine.");
		},
		getTheme: () => getActiveTheme(),
		getThemeName: () => getActiveTheme().name as ThemeName,
		resolveStyleDemo: (sourceFile, exportName) => {
			if (sourceFile === PLASMA_SOURCE_FILE && exportName === PLASMA_EXPORT_NAME) {
				return PLASMA_DEMO;
			}
			return undefined;
		},
		listStyleDemos: () => [PLASMA_DEMO],
		setControlValue: () => undefined,
		openSelectOverlay: () => undefined,
		openTextPrompt: () => undefined,
		openEditorPrompt: () => undefined,
		showOverlay: () => undefined,
		openShellMenu: () => undefined,
		closeOverlay: () => undefined,
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function toWindowWidth(contentWidth: number): number {
	return Math.max(FRAME_HORIZONTAL_CHROME + MIN_CONTENT_WIDTH, contentWidth + FRAME_HORIZONTAL_CHROME);
}

function toWindowHeight(contentHeight: number): number {
	return Math.max(FRAME_VERTICAL_CHROME + MIN_CONTENT_HEIGHT, contentHeight + FRAME_VERTICAL_CHROME);
}

function toContentViewport(windowWidth: number, windowHeight: number): { width: number; height: number } {
	return {
		width: Math.max(MIN_CONTENT_WIDTH, windowWidth - FRAME_HORIZONTAL_CHROME),
		height: Math.max(MIN_CONTENT_HEIGHT, windowHeight - FRAME_VERTICAL_CHROME),
	};
}

function resolveConstraints(
	limits: { minCols: number; minRows: number; maxCols: number; maxRows: number },
	preferredCols: number,
	preferredRows: number,
	terminal: { width: number; height: number },
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
		preferredWidth: clamp(toWindowWidth(preferredCols), minWidth, maxWidth),
		preferredHeight: clamp(toWindowHeight(preferredRows), minHeight, maxHeight),
		maxWidth,
		maxHeight,
	};
}

function hexFromRgb(r: number, g: number, b: number): string {
	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function parseSgrForeground(codes: number[], currentFg: string | undefined): string | undefined {
	let fg = currentFg;
	for (let index = 0; index < codes.length; index++) {
		const code = codes[index] ?? 0;
		if (code === 0 || code === 39) {
			fg = undefined;
			continue;
		}
		if (BASIC_ANSI_COLORS.has(code)) {
			fg = BASIC_ANSI_COLORS.get(code);
			continue;
		}
		if (code === 38) {
			const mode = codes[index + 1];
			if (mode === 2 && index + 4 < codes.length) {
				fg = hexFromRgb(codes[index + 2] ?? 255, codes[index + 3] ?? 255, codes[index + 4] ?? 255);
				index += 4;
				continue;
			}
			if (mode === 5 && index + 2 < codes.length) {
				const value = codes[index + 2] ?? 15;
				const normalized = Math.max(0, Math.min(255, value));
				fg = hexFromRgb(normalized, normalized, normalized);
				index += 2;
				continue;
			}
		}
	}
	return fg;
}

function pushSegment(target: FloatingAnimboxTextSegment[], text: string, fg: string | undefined): void {
	if (!text) {
		return;
	}
	const previous = target.at(-1);
	if (previous && previous.fg === fg) {
		previous.text += text;
		return;
	}
	target.push({ text, fg });
}

function parseAnsiLine(input: string, width: number): FloatingAnimboxTextSegment[] {
	const segments: FloatingAnimboxTextSegment[] = [];
	let fg: string | undefined;
	let visibleCount = 0;
	let index = 0;

	while (index < input.length && visibleCount < width) {
		if (input[index] === "\u001b" && input[index + 1] === "[") {
			const match = /^\u001b\[([0-9;]*)m/.exec(input.slice(index));
			if (match) {
				const codes = match[1]
					.split(";")
					.filter((code) => code.length > 0)
					.map((code) => Number.parseInt(code, 10))
					.filter((code) => Number.isFinite(code));
				fg = parseSgrForeground(codes, fg);
				index += match[0].length;
				continue;
			}
		}

		pushSegment(segments, input[index] ?? "", fg);
		visibleCount++;
		index++;
	}

	if (visibleCount < width) {
		pushSegment(segments, " ".repeat(width - visibleCount), undefined);
	}

	return segments;
}

function buildFallbackLines(message: string, preset: FloatingAnimBoxPreset, height: number): string[] {
	const base = [
		"Floating Animbox target unavailable",
		message,
		`${preset.sourceFile}#${preset.exportName}`,
		`animation preset: ${preset.animationPresetId}`,
	];
	return [...base, ...Array.from({ length: Math.max(0, height - base.length) }, () => "")];
}

export class FloatingAnimboxController {
	private readonly title: string;
	private readonly instanceId: string;
	private readonly onStateChange?: (model: FloatingAnimBoxWindowState) => void;
	private readonly limits: { minCols: number; minRows: number; maxCols: number; maxRows: number };
	private terminalViewport = { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER };
	private preset: FloatingAnimBoxPreset;
	private readonly handle: string;

	readonly model: FloatingAnimBoxWindowState;

	constructor(
		private readonly context: StyleTestRuntimeContext,
		preset: FloatingAnimBoxPreset,
		options: FloatingAnimBoxControllerOptions = {},
	) {
		this.title = options.title ?? "Floating Animbox";
		this.instanceId = options.instanceId ?? `floating-animbox:${Date.now().toString(36)}`;
		this.onStateChange = options.onStateChange;
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
			constraints: resolveConstraints(this.limits, preset.cols, preset.rows, this.terminalViewport),
		};
		this.handle = animPreloadService.getOrCreateInstance(
			{
				sourceFile: this.preset.sourceFile,
				exportName: this.preset.exportName,
				presetId: this.preset.animationPresetId,
				instanceId: this.instanceId,
			},
			this.context,
		);
		this.reconcileWindowState(false);
	}

	getTitle(): string {
		return this.title;
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
		return toContentViewport(this.model.width, this.model.height);
	}

	getFooterText(): string {
		const viewport = this.getContentViewport();
		return `${this.preset.exportName} · ${this.preset.animationPresetId} · ${viewport.width}x${viewport.height}`;
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

	getContentRows(): FloatingAnimboxTextSegment[][] {
		const viewport = this.getContentViewport();
		let contentLines: string[];
		try {
			contentLines = animPreloadService.renderInstance(this.handle, viewport.width, viewport.height);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			contentLines = buildFallbackLines(message, this.preset, viewport.height);
		}

		return Array.from({ length: viewport.height }, (_, index) => parseAnsiLine(contentLines[index] ?? "", viewport.width));
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
		animPreloadService.disposeInstance(this.handle);
	}

	private getTitleDragBounds(rect: Rect): { startCol: number; endCol: number } {
		const visibleTitle = this.title.slice(0, Math.max(0, rect.width - 8));
		const startCol = rect.col + 2;
		return { startCol, endCol: startCol + Math.max(0, visibleTitle.length - 1) };
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
		const onTopResizeBand = onTopBorder && !(event.col >= titleBounds.startCol && event.col <= titleBounds.endCol);
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

	private refreshConstraints(): void {
		const preset = this.getPreset();
		this.model.constraints = resolveConstraints(this.limits, preset.cols, preset.rows, this.terminalViewport);
	}

	private getPreset(): FloatingAnimBoxPreset {
		const viewport = this.getContentViewport();
		return {
			...this.preset,
			cols: viewport.width,
			rows: viewport.height,
			x: this.model.col,
			y: this.model.row,
		};
	}

	private reconcileWindowState(emit: boolean): void {
		this.refreshConstraints();
		const nextWidth = clamp(this.model.width || this.model.constraints.preferredWidth, this.model.constraints.minWidth, this.model.constraints.maxWidth);
		const nextHeight = clamp(this.model.height || this.model.constraints.preferredHeight, this.model.constraints.minHeight, this.model.constraints.maxHeight);
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
