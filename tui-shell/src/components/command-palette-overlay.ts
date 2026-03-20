import { Input, SelectList, matchesKey, type Focusable } from "@mariozechner/pi-tui";
import { paintLine } from "../ansi.js";
import type { MouseEvent, Rect } from "../mouse.js";
import { pointInRect } from "../mouse.js";
import { masterTuiTheme } from "../theme.js";
import type { MouseAwareOverlay, ShellCommand } from "../types.js";

export class CommandPaletteOverlay implements MouseAwareOverlay, Focusable {
	private readonly input = new Input();
	private readonly list: SelectList;
	private _focused = false;

	constructor(
		private readonly commands: ShellCommand[],
		private readonly onClose: () => void,
	) {
		this.list = new SelectList(
			this.commands.map((command) => ({
				value: command.label,
				label: command.label,
				description: command.description,
			})),
			8,
			masterTuiTheme.selectListTheme,
		);
		this.list.onSelect = (item) => {
			this.commands.find((entry) => entry.label === item.value)?.run();
			this.onClose();
		};
		this.input.onSubmit = () => {
			const selected = this.list.getSelectedItem();
			if (selected) {
				this.list.onSelect?.(selected);
			}
		};
		this.input.onEscape = () => this.onClose();
	}

	invalidate(): void {
		this.input.invalidate();
		this.list.invalidate();
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	render(width: number): string[] {
		const lines: string[] = [];
		lines.push(paintLine(masterTuiTheme.accentStrong("Command Palette"), width, masterTuiTheme.panelBgActive));
		lines.push(
			paintLine(
				masterTuiTheme.muted("Filter commands, run actions, and preview the reusable shell contract."),
				width,
				masterTuiTheme.panelBgActive,
			),
		);
		lines.push(paintLine("", width, masterTuiTheme.panelBgActive));
		for (const line of this.input.render(width)) {
			lines.push(paintLine(line, width, masterTuiTheme.panelBgActive));
		}
		lines.push(paintLine("", width, masterTuiTheme.panelBgActive));
		for (const line of this.list.render(width)) {
			lines.push(paintLine(line, width, masterTuiTheme.panelBgActive));
		}
		lines.push(paintLine("", width, masterTuiTheme.panelBgActive));
		lines.push(
			paintLine(
				masterTuiTheme.dim("Enter run · Up/Down move · Mouse click select · Esc close"),
				width,
				masterTuiTheme.panelBgActive,
			),
		);
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
			this.list.setFilter(this.input.getValue());
		}
	}

	handleMouse(event: MouseEvent, rect: Rect): boolean {
		if (!pointInRect(event, rect)) {
			return false;
		}

		const localRow = event.row - rect.row + 1;
		const listStartRow = 6;
		const visibleRange = this.list.getVisibleRange();
		const visibleCount = visibleRange.end - visibleRange.start;

		if (event.action === "scroll") {
			const direction = event.button === "wheelUp" ? -1 : 1;
			this.list.setSelectedIndex(this.list.getSelectedIndex() + direction);
			return true;
		}

		if (event.action !== "down" || event.button !== "left") {
			return true;
		}

		if (localRow >= listStartRow && localRow < listStartRow + visibleCount) {
			const index = visibleRange.start + (localRow - listStartRow);
			this.list.setSelectedIndex(index);
			const selected = this.list.getSelectedItem();
			if (selected) {
				this.list.onSelect?.(selected);
			}
		}

		return true;
	}
}
