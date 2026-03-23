import { Input, SelectList, matchesKey, type Focusable } from "@mariozechner/pi-tui";
import { paintLine } from "../ansi.js";
import type { MouseEvent, Rect } from "../mouse.js";
import { pointInRect } from "../mouse.js";
import { createOverlayPreviewRuntime } from "../style-test-fixtures.js";
import { defineStyleTestDemos } from "../style-test-contract.js";
import { agentTheme } from "../theme.js";
import type { HostedSizeRequirements, MouseAwareOverlay } from "../types.js";

export interface OverlaySelectItem<T> {
	value: T;
	label: string;
	description?: string;
}

export class FilterSelectOverlay<T> implements MouseAwareOverlay, Focusable {
	private static readonly MAX_VISIBLE_ITEMS = 10;

	private readonly input = new Input();
	private readonly list: SelectList;
	private readonly listItems: Array<{ value: string; label: string; description?: string }>;
	private filteredItems: Array<{ value: string; label: string; description?: string }>;
	private selectedIndex = 0;
	private _focused = false;

	constructor(
		private readonly title: string,
		private readonly description: string,
		private readonly items: OverlaySelectItem<T>[],
		private readonly onSelect: (value: T) => void,
		private readonly onClose: () => void,
	) {
		this.listItems = this.items.map((item, index) => ({
			value: `${item.label}\u0000${index}`,
			label: item.label,
			description: item.description,
		}));
		this.filteredItems = this.listItems;
		this.list = new SelectList(this.listItems, FilterSelectOverlay.MAX_VISIBLE_ITEMS, agentTheme.selectListTheme);
		this.list.onSelect = (item) => {
			const selected = this.getOverlayItem(item.value);
			if (!selected) {
				return;
			}
			this.onSelect(selected);
			this.onClose();
		};
		this.list.onSelectionChange = (item) => {
			const index = this.filteredItems.findIndex((candidate) => candidate.value === item.value);
			if (index >= 0) {
				this.selectedIndex = index;
			}
		};
		this.input.onSubmit = () => {
			const selected = this.list.getSelectedItem();
			if (selected) {
				this.list.onSelect?.(selected);
			}
		};
		this.input.onEscape = () => this.onClose();
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	invalidate(): void {
		this.input.invalidate();
		this.list.invalidate();
	}

	private getOverlayItem(encodedValue: string): T | undefined {
		const separatorIndex = encodedValue.lastIndexOf("\u0000");
		if (separatorIndex < 0) {
			return undefined;
		}
		const index = Number.parseInt(encodedValue.slice(separatorIndex + 1), 10);
		return this.items[index]?.value;
	}

	private updateFilter(filter: string): void {
		const normalizedFilter = filter.toLowerCase();
		this.filteredItems = this.listItems.filter((item) => item.value.toLowerCase().startsWith(normalizedFilter));
		this.selectedIndex = 0;
		this.list.setFilter(filter);
	}

	private setSelectedIndex(index: number): void {
		if (this.filteredItems.length === 0) {
			this.selectedIndex = 0;
			this.list.setSelectedIndex(0);
			return;
		}
		const nextIndex = Math.max(0, Math.min(index, this.filteredItems.length - 1));
		this.selectedIndex = nextIndex;
		this.list.setSelectedIndex(nextIndex);
	}

	private getVisibleRange(): { start: number; end: number } {
		if (this.filteredItems.length === 0) {
			return { start: 0, end: 0 };
		}
		const start = Math.max(
			0,
			Math.min(
				this.selectedIndex - Math.floor(FilterSelectOverlay.MAX_VISIBLE_ITEMS / 2),
				this.filteredItems.length - FilterSelectOverlay.MAX_VISIBLE_ITEMS,
			),
		);
		const end = Math.min(start + FilterSelectOverlay.MAX_VISIBLE_ITEMS, this.filteredItems.length);
		return { start, end };
	}

	getHostedSizeRequirements(): HostedSizeRequirements {
		const longestLabel = this.listItems.reduce((max, item) => Math.max(max, item.label.length, item.description?.length ?? 0), 0);
		const visibleItems = Math.max(1, Math.min(FilterSelectOverlay.MAX_VISIBLE_ITEMS, this.filteredItems.length || this.listItems.length));
		return {
			minWidth: 44,
			minHeight: 10,
			preferredWidth: Math.max(52, Math.min(88, longestLabel + 14)),
			preferredHeight: 9 + visibleItems,
			maxHeight: 9 + FilterSelectOverlay.MAX_VISIBLE_ITEMS,
		};
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const top = agentTheme.dim("╭" + "─".repeat(Math.max(0, width - 2)) + "╮");
		const bottom = agentTheme.dim("╰" + "─".repeat(Math.max(0, width - 2)) + "╯");
		lines.push(paintLine(top, width, agentTheme.panelBgActive));
		lines.push(paintLine(agentTheme.accentStrong(this.title), width, agentTheme.panelBgActive));
		lines.push(paintLine(agentTheme.muted(this.description), width, agentTheme.panelBgActive));
		lines.push(paintLine("", width, agentTheme.panelBgActive));
		for (const line of this.input.render(width)) {
			lines.push(paintLine(line, width, agentTheme.panelBgActive));
		}
		lines.push(paintLine("", width, agentTheme.panelBgActive));
		for (const line of this.list.render(width)) {
			lines.push(paintLine(line, width, agentTheme.panelBgActive));
		}
		lines.push(paintLine("", width, agentTheme.panelBgActive));
		lines.push(
			paintLine(
				agentTheme.dim("Type to filter  |  Enter select  |  Mouse click select  |  Esc close"),
				width,
				agentTheme.panelBgActive,
			),
		);
		lines.push(paintLine(bottom, width, agentTheme.panelBgActive));
		return lines;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "up") || matchesKey(data, "down")) {
			this.list.handleInput(data);
			return;
		}
		if (matchesKey(data, "escape") || matchesKey(data, "esc")) {
			this.onClose();
			return;
		}

		const before = this.input.getValue();
		this.input.handleInput(data);
		if (before !== this.input.getValue()) {
			this.updateFilter(this.input.getValue());
		}
	}

	handleMouse(event: MouseEvent, rect: Rect): boolean {
		if (!pointInRect(event, rect)) {
			return false;
		}
		const localRow = event.row - rect.row + 1;
		const listStartRow = 7; // +1 for top border line
		const visibleRange = this.getVisibleRange();
		const visibleCount = visibleRange.end - visibleRange.start;

		if (event.action === "scroll") {
			const direction = event.button === "wheelUp" ? -1 : 1;
			this.setSelectedIndex(this.selectedIndex + direction);
			return true;
		}

		if (event.action !== "down" || event.button !== "left") {
			return true;
		}

		if (localRow >= listStartRow && localRow < listStartRow + visibleCount) {
			this.setSelectedIndex(visibleRange.start + (localRow - listStartRow));
			const selected = this.list.getSelectedItem();
			if (selected) {
				this.list.onSelect?.(selected);
			}
		}

		return true;
	}
}

export const styleTestDemos = defineStyleTestDemos({
	exports: {
		FilterSelectOverlay: {
			title: "Filter Select Overlay",
			category: "Overlays",
			kind: "overlay",
			description: "Searchable list overlay with keyboard and mouse support.",
			createRuntime: (_moduleNamespace, _exportName, _exportValue, context) =>
				createOverlayPreviewRuntime(
					"Searchable list overlay with keyboard and mouse support.",
					"src/components/filter-select-overlay.ts",
					() =>
						context.showOverlay(
							"styletest-filter",
							new FilterSelectOverlay(
								"Overlay Test",
								"Search the available demo presets.",
								[
									{ value: "plasma", label: "Plasma", description: "Animated scalar field" },
									{ value: "matrix", label: "Matrix Rain", description: "Glyph columns" },
									{ value: "shell", label: "Shell Menu", description: "Nested overlay" },
								],
								() => undefined,
								() => context.closeOverlay("styletest-filter"),
							),
							{ width: 72, maxHeight: 14, anchor: "center", margin: 1 },
						),
				),
		},
	},
});
