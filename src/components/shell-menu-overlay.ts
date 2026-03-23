import { matchesKey, truncateToWidth, type Focusable } from "@mariozechner/pi-tui";
import { createDynamicTheme, agentTheme } from "../theme.js";
import { getGlobalAnimationState } from "../animation-engine.js";
import type { MouseEvent, Rect } from "../mouse.js";
import { pointInRect } from "../mouse.js";
import { createOverlayPreviewRuntime, sampleShellMenuDefinition } from "../style-test-fixtures.js";
import { defineStyleTestDemos } from "../style-test-contract.js";
import type { HostedSizeRequirements, HostedViewportDimensions, MouseAwareOverlay } from "../types.js";

export interface ShellMenuActionItem {
	kind: "action";
	id: string;
	label: string;
	description?: string;
	onSelect: () => void | Promise<void>;
}

export interface ShellMenuSubmenuItem {
	kind: "submenu";
	id: string;
	label: string;
	description?: string;
	items: ShellMenuItem[];
}

export type ShellMenuItem = ShellMenuActionItem | ShellMenuSubmenuItem;

export interface ShellMenuDefinition {
	title: string;
	subtitle?: string;
	anchor: { row: number; col: number };
	items: ShellMenuItem[];
	width?: number;
	childWidth?: number;
	maxVisibleItems?: number;
}

type MenuFrame = {
	title: string;
	subtitle?: string;
	items: ShellMenuItem[];
	selectedIndex: number;
	scrollOffset: number;
	width: number;
};

type FrameLayout = {
	rect: Rect;
	frameIndex: number;
	itemRowStart: number;
	visibleStart: number;
	visibleCount: number;
};

const MAX_VISIBLE_ITEMS = 10;
const REVEAL_MS = 160;

export class ShellMenuOverlay implements MouseAwareOverlay, Focusable {
	private readonly stack: MenuFrame[];
	private readonly openedAt = Date.now();
	private readonly renderedLayouts: FrameLayout[] = [];
	private _focused = false;
	private lastRenderWidth = 0;
	private assignedViewport: HostedViewportDimensions;

	constructor(
		private readonly definition: ShellMenuDefinition,
		private readonly viewportRows: number,
		private readonly onClose: () => void,
	) {
		this.assignedViewport = { width: definition.width ?? 38, height: viewportRows };
		this.stack = [{
			title: definition.title,
			subtitle: definition.subtitle,
			items: definition.items,
			selectedIndex: 0,
			scrollOffset: 0,
			width: definition.width ?? 38,
		}];
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}

	invalidate(): void {}

	getHostedSizeRequirements(): HostedSizeRequirements {
		const widths = this.stack.map((frame, index) => index === 0 ? frame.width : Math.max(frame.width, this.definition.childWidth ?? frame.width));
		const preferredWidth = Math.max(...widths, this.definition.width ?? 38);
		const visibleItems = Math.max(1, Math.min(this.definition.maxVisibleItems ?? MAX_VISIBLE_ITEMS, this.getActiveFrame()?.items.length ?? this.definition.items.length));
		return {
			minWidth: Math.min(preferredWidth, Math.max(28, this.definition.width ?? 38)),
			minHeight: Math.min(this.viewportRows, 7),
			preferredWidth: Math.min(this.assignedViewport.width || preferredWidth, preferredWidth),
			preferredHeight: Math.min(this.viewportRows, 6 + visibleItems),
			maxWidth: this.assignedViewport.width || preferredWidth,
			maxHeight: this.viewportRows,
		};
	}

	setHostedViewportSize(viewport: HostedViewportDimensions): void {
		this.assignedViewport = viewport;
	}

	render(width: number): string[] {
		this.lastRenderWidth = width;
		this.renderedLayouts.length = 0;

		const canvas = this.createCanvas(this.viewportRows, width);
		for (let frameIndex = 0; frameIndex < this.stack.length; frameIndex++) {
			const layout = this.layoutFrame(frameIndex, width, this.viewportRows);
			if (!layout) {
				continue;
			}
			this.renderedLayouts.push(layout);
			this.drawFrame(canvas, layout);
		}

		return canvas.map((row) => row.join(""));
	}

	handleInput(data: string): void {
		if (matchesKey(data, "up")) {
			this.moveSelection(-1);
			return;
		}
		if (matchesKey(data, "down")) {
			this.moveSelection(1);
			return;
		}
		if (matchesKey(data, "right") || matchesKey(data, "enter")) {
			this.openSelectedSubmenuOrRun();
			return;
		}
		if (matchesKey(data, "left") || matchesKey(data, "escape") || matchesKey(data, "esc")) {
			this.popOrClose();
			return;
		}
	}

	handleMouse(event: MouseEvent, _rect: Rect): boolean {
		const localEvent = {
			...event,
			row: event.row - _rect.row + 1,
			col: event.col - _rect.col + 1,
		};
		if (event.action === "scroll") {
			const activeLayout = this.renderedLayouts[this.renderedLayouts.length - 1];
			if (!activeLayout || !pointInRect(localEvent, activeLayout.rect)) {
				return true;
			}
			this.moveSelection(localEvent.button === "wheelUp" ? -1 : 1);
			return true;
		}

		if (event.action !== "down" || event.button !== "left") {
			return true;
		}

		for (let index = this.renderedLayouts.length - 1; index >= 0; index--) {
			const layout = this.renderedLayouts[index]!;
			if (!pointInRect(localEvent, layout.rect)) {
				continue;
			}
			const itemIndex = this.itemIndexForMouse(layout, localEvent.row);
			if (itemIndex === undefined) {
				return true;
			}
			this.activateFrame(index, itemIndex);
			this.openSelectedSubmenuOrRun();
			return true;
		}

		this.onClose();
		return true;
	}

	private moveSelection(delta: number): void {
		const frame = this.getActiveFrame();
		if (!frame || frame.items.length === 0) {
			return;
		}
		frame.selectedIndex = Math.max(0, Math.min(frame.items.length - 1, frame.selectedIndex + delta));
		this.ensureScroll(frame);
	}

	private openSelectedSubmenuOrRun(): void {
		const frame = this.getActiveFrame();
		if (!frame) {
			return;
		}
		const item = frame.items[frame.selectedIndex];
		if (!item) {
			return;
		}
		if (item.kind === "submenu") {
			const nextWidth = this.stack.length === 1
				? (this.definition.childWidth ?? 48)
				: frame.width;
			if (this.stack.length > 1) {
				this.stack.splice(1);
			}
			this.stack.push({
				title: item.label,
				subtitle: item.description,
				items: item.items,
				selectedIndex: 0,
				scrollOffset: 0,
				width: nextWidth,
			});
			return;
		}
		void Promise.resolve(item.onSelect()).finally(() => this.onClose());
	}

	private popOrClose(): void {
		if (this.stack.length > 1) {
			this.stack.pop();
			return;
		}
		this.onClose();
	}

	private activateFrame(frameIndex: number, itemIndex: number): void {
		this.stack.splice(frameIndex + 1);
		const frame = this.stack[frameIndex];
		if (!frame) {
			return;
		}
		frame.selectedIndex = Math.max(0, Math.min(frame.items.length - 1, itemIndex));
		this.ensureScroll(frame);
	}

	private ensureScroll(frame: MenuFrame): void {
		const maxVisible = this.definition.maxVisibleItems ?? MAX_VISIBLE_ITEMS;
		if (frame.selectedIndex < frame.scrollOffset) {
			frame.scrollOffset = frame.selectedIndex;
			return;
		}
		if (frame.selectedIndex >= frame.scrollOffset + maxVisible) {
			frame.scrollOffset = frame.selectedIndex - maxVisible + 1;
		}
	}

	private getActiveFrame(): MenuFrame | undefined {
		return this.stack[this.stack.length - 1];
	}

	private layoutFrame(frameIndex: number, termWidth: number, termHeight: number): FrameLayout | undefined {
		const frame = this.stack[frameIndex];
		if (!frame) {
			return undefined;
		}
		const maxVisible = this.definition.maxVisibleItems ?? MAX_VISIBLE_ITEMS;
		const visibleCount = Math.max(1, Math.min(maxVisible, frame.items.length || 1));
		const height = 6 + visibleCount;
		const parent = frameIndex === 0 ? undefined : this.renderedLayouts[frameIndex - 1];
		const row = parent
			? Math.min(parent.rect.row + 1, Math.max(1, termHeight - height + 1))
			: 1;
		const desiredCol = parent
			? parent.rect.col + Math.max(6, Math.floor(parent.rect.width * 0.55))
			: 1;
		const col = Math.max(1, Math.min(desiredCol, Math.max(1, termWidth - frame.width + 1)));
		return {
			frameIndex,
			rect: {
				row,
				col,
				width: Math.min(frame.width, termWidth),
				height,
			},
			itemRowStart: row + 4,
			visibleStart: frame.scrollOffset,
			visibleCount,
		};
	}

	private itemIndexForMouse(layout: FrameLayout, row: number): number | undefined {
		if (row < layout.itemRowStart || row >= layout.itemRowStart + layout.visibleCount) {
			return undefined;
		}
		return layout.visibleStart + (row - layout.itemRowStart);
	}

	private drawFrame(canvas: string[][], layout: FrameLayout): void {
		const frame = this.stack[layout.frameIndex]!;
		const animationState = getGlobalAnimationState();
		const dynamicTheme = animationState ? createDynamicTheme(animationState) : undefined;
		const borderStyler = dynamicTheme?.borderAnimated ?? agentTheme.accentStrong;
		const fillStyler = layout.frameIndex === this.stack.length - 1 ? agentTheme.panelBgActive : agentTheme.panelBgRaised;
		const accentStyler = Date.now() - this.openedAt < REVEAL_MS ? agentTheme.accentStrong : agentTheme.accent;
		const separatorOffset = animationState?.separatorOffset ?? 0;
		const separatorGlyphs = ["═", "─", "╌", "╍"];
		const separatorChar = separatorGlyphs[separatorOffset % separatorGlyphs.length] ?? "═";

		this.fillBox(canvas, layout.rect, fillStyler);
		this.drawBorder(canvas, layout.rect, borderStyler);
		this.writeText(canvas, layout.rect.row + 1, layout.rect.col + 2, truncateToWidth(frame.title, layout.rect.width - 6, ""), accentStyler);
		if (frame.subtitle) {
			this.writeText(
				canvas,
				layout.rect.row + 2,
				layout.rect.col + 2,
				truncateToWidth(frame.subtitle, layout.rect.width - 6, ""),
				agentTheme.muted,
			);
		}
		for (let offset = 1; offset < layout.rect.width - 1; offset++) {
			this.writeCell(canvas, layout.rect.row + 3, layout.rect.col + offset, agentTheme.dim(separatorChar));
		}

		for (let visibleIndex = 0; visibleIndex < layout.visibleCount; visibleIndex++) {
			const itemIndex = layout.visibleStart + visibleIndex;
			const item = frame.items[itemIndex];
			if (!item) {
				continue;
			}
			const row = layout.itemRowStart + visibleIndex;
			const isSelected = itemIndex === frame.selectedIndex;
			const prefix = item.kind === "submenu" ? "▶" : "•";
			const label = truncateToWidth(item.label, Math.max(4, layout.rect.width - 8), "");
			const line = `${prefix} ${label}`;
			this.writeText(
				canvas,
				row,
				layout.rect.col + 2,
				line,
				isSelected ? agentTheme.accentStrong : agentTheme.text,
			);
			if (item.kind === "submenu") {
				this.writeText(canvas, row, layout.rect.col + layout.rect.width - 4, "▶", isSelected ? agentTheme.accentStrong : agentTheme.dim);
			}
		}

		const hint = this.stack.length > 1
			? "Enter open  |  Esc back  |  Click select"
			: "Enter select  |  Esc close  |  Click select";
		this.writeText(
			canvas,
			layout.rect.row + layout.rect.height - 2,
			layout.rect.col + 2,
			truncateToWidth(hint, layout.rect.width - 6, ""),
			agentTheme.dim,
		);
	}

	private createCanvas(rows: number, cols: number): string[][] {
		return Array.from({ length: rows }, () => Array.from({ length: cols }, () => " "));
	}

	private fillBox(canvas: string[][], rect: Rect, styler: (text: string) => string): void {
		for (let row = rect.row; row < rect.row + rect.height; row++) {
			for (let col = rect.col; col < rect.col + rect.width; col++) {
				this.writeCell(canvas, row, col, styler(" "));
			}
		}
	}

	private drawBorder(canvas: string[][], rect: Rect, styler: (text: string) => string): void {
		for (let col = rect.col + 1; col < rect.col + rect.width - 1; col++) {
			this.writeCell(canvas, rect.row, col, styler("═"));
			this.writeCell(canvas, rect.row + rect.height - 1, col, styler("═"));
		}
		for (let row = rect.row + 1; row < rect.row + rect.height - 1; row++) {
			this.writeCell(canvas, row, rect.col, styler("║"));
			this.writeCell(canvas, row, rect.col + rect.width - 1, styler("║"));
		}
		this.writeCell(canvas, rect.row, rect.col, styler("╔"));
		this.writeCell(canvas, rect.row, rect.col + rect.width - 1, styler("╗"));
		this.writeCell(canvas, rect.row + rect.height - 1, rect.col, styler("╚"));
		this.writeCell(canvas, rect.row + rect.height - 1, rect.col + rect.width - 1, styler("╝"));
	}

	private writeText(canvas: string[][], row: number, col: number, text: string, styler: (text: string) => string): void {
		for (let index = 0; index < text.length; index++) {
			this.writeCell(canvas, row, col + index, styler(text[index]!));
		}
	}

	private writeCell(canvas: string[][], row: number, col: number, value: string): void {
		const targetRow = canvas[row - 1];
		if (!targetRow) {
			return;
		}
		if (col < 1 || col > targetRow.length) {
			return;
		}
		targetRow[col - 1] = value;
	}
}

export const styleTestDemos = defineStyleTestDemos({
	exports: {
		ShellMenuOverlay: {
			title: "Shell Menu Overlay",
			category: "Overlays",
			kind: "overlay",
			description: "Nested shell-style overlay menu.",
			createRuntime: (_moduleNamespace, _exportName, _exportValue, context) =>
				createOverlayPreviewRuntime(
					"Nested shell-style overlay menu.",
					"src/components/shell-menu-overlay.ts",
					() => context.openShellMenu("styletest-shell-menu", sampleShellMenuDefinition()),
				),
		},
	},
});
