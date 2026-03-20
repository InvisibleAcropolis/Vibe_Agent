import { SelectList, matchesKey } from "@mariozechner/pi-tui";
import { paintLine } from "../ansi.js";
import type { MouseEvent, Rect } from "../mouse.js";
import { pointInRect } from "../mouse.js";
import { masterTuiTheme } from "../theme.js";
import type { MouseAwareOverlay } from "../types.js";

export interface LauncherItem {
	id: string;
	label: string;
	description: string;
	run: () => void;
}

export class LauncherOverlay implements MouseAwareOverlay {
	private readonly list: SelectList;

	constructor(
		private readonly items: LauncherItem[],
		private readonly onClose: () => void,
	) {
		this.list = new SelectList(
			items.map((item) => ({
				value: item.id,
				label: item.label,
				description: item.description,
			})),
			7,
			masterTuiTheme.selectListTheme,
		);
		this.list.onSelect = (selected) => {
			this.items.find((item) => item.id === selected.value)?.run();
			this.onClose();
		};
		this.list.onCancel = this.onClose;
	}

	invalidate(): void {
		this.list.invalidate();
	}

	render(width: number): string[] {
		return [
			paintLine(masterTuiTheme.accentStrong("Launcher"), width, masterTuiTheme.panelBgActive),
			paintLine(
				masterTuiTheme.muted("The panel manager is live now, even though only one panel is active in v1."),
				width,
				masterTuiTheme.panelBgActive,
			),
			paintLine("", width, masterTuiTheme.panelBgActive),
			...this.list.render(width).map((line) => paintLine(line, width, masterTuiTheme.panelBgActive)),
			paintLine("", width, masterTuiTheme.panelBgActive),
			paintLine(
				masterTuiTheme.dim("Enter activate · Mouse click select · Esc close"),
				width,
				masterTuiTheme.panelBgActive,
			),
		];
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "esc")) {
			this.onClose();
			return;
		}
		this.list.handleInput(data);
	}

	handleMouse(event: MouseEvent, rect: Rect): boolean {
		if (!pointInRect(event, rect)) {
			return false;
		}
		if (event.action === "scroll") {
			const direction = event.button === "wheelUp" ? -1 : 1;
			this.list.setSelectedIndex(this.list.getSelectedIndex() + direction);
			return true;
		}
		if (event.action !== "down" || event.button !== "left") {
			return true;
		}

		const localRow = event.row - rect.row + 1;
		const listStartRow = 4;
		const visibleRange = this.list.getVisibleRange();
		const visibleCount = visibleRange.end - visibleRange.start;
		if (localRow >= listStartRow && localRow < listStartRow + visibleCount) {
			this.list.setSelectedIndex(visibleRange.start + (localRow - listStartRow));
			const selected = this.list.getSelectedItem();
			if (selected) {
				this.list.onSelect?.(selected);
			}
		}
		return true;
	}
}
