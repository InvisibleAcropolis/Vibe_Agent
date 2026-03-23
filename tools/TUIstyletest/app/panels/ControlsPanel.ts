import { matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { paintLine } from "../../../../src/ansi.js";
import { pointInRect, type MouseEvent, type Rect } from "../../../../src/mouse.js";
import { agentTheme } from "../../../../src/theme.js";
import type { ThemeName } from "../../../../src/themes/index.js";
import type { StyleTestControl, StyleTestControlValues, StyleTestDemoDefinition, StyleTestRuntime } from "../../../../src/style-test-contract.js";
import { clamp } from "../layout.js";
import type { ActionRow, MouseAwareComponent } from "../types.js";

export class ControlsPanel implements MouseAwareComponent {
	private renderedControlRows: Array<{ row: number; controlId: string }> = [];
	private selectedIndex = 0;
	public maxHeight = 20;

	constructor(
		private readonly getDemo: () => StyleTestDemoDefinition,
		private readonly getValues: () => StyleTestControlValues,
		private readonly getRuntime: () => StyleTestRuntime | undefined,
		private readonly getThemeName: () => ThemeName,
		private readonly getPresetActions: () => ActionRow[],
		private readonly isFocused: () => boolean,
		private readonly onAdjust: (controlId: string, delta: number) => void,
		private readonly onEditNumber: (controlId: string) => void,
		private readonly onToggle: (controlId: string) => void,
		private readonly onCycleEnum: (controlId: string, direction: number) => void,
		private readonly onEditText: (controlId: string) => void,
		private readonly onAction: (actionId: string) => void,
	) {}

	invalidate(): void {}

	private controlsForRender(): Array<StyleTestControl | ActionRow> {
		const demo = this.getDemo();
		const actionRows: ActionRow[] = [
			{ id: "action-cycle-theme", label: `Theme: ${this.getThemeName()}`, type: "action" },
			{ id: "action-reset", label: "Reset Demo", type: "action" },
			{ id: "action-randomize", label: "Randomize Values", type: "action" },
		];
		actionRows.push(...this.getPresetActions());
		for (const preset of demo.presets ?? []) {
			actionRows.push({ id: `preset:${preset.id}`, label: `Preset: ${preset.label}`, type: "action" });
		}
		if (demo.kind === "overlay") {
			actionRows.push({ id: "action-open-overlay", label: "Open Overlay", type: "action" });
		} else if (this.getRuntime()?.openOverlay) {
			actionRows.push({ id: "action-open-overlay", label: "Open Picker", type: "action" });
		}
		return [...demo.controls, ...actionRows];
	}

	private currentControlId(): string | undefined {
		return this.controlsForRender()[clamp(this.selectedIndex, 0, Math.max(0, this.controlsForRender().length - 1))]?.id;
	}

	handleInput(data: string): void {
		const rows = this.controlsForRender();
		if (matchesKey(data, "up")) {
			this.selectedIndex = clamp(this.selectedIndex - 1, 0, Math.max(0, rows.length - 1));
			return;
		}
		if (matchesKey(data, "down")) {
			this.selectedIndex = clamp(this.selectedIndex + 1, 0, Math.max(0, rows.length - 1));
			return;
		}
		const current = rows[this.selectedIndex];
		if (!current) {
			return;
		}
		if ("type" in current && current.type === "action") {
			if (matchesKey(data, "enter") || matchesKey(data, "right")) {
				this.onAction(current.id);
			}
			return;
		}
		switch (current.type) {
			case "number":
				if (matchesKey(data, "left")) this.onAdjust(current.id, -1);
				if (matchesKey(data, "right")) this.onAdjust(current.id, 1);
				if (matchesKey(data, "enter")) this.onEditNumber(current.id);
				break;
			case "boolean":
				if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "enter")) this.onToggle(current.id);
				break;
			case "enum":
				if (matchesKey(data, "left")) this.onCycleEnum(current.id, -1);
				if (matchesKey(data, "right") || matchesKey(data, "enter")) this.onCycleEnum(current.id, 1);
				break;
			case "text":
				if (!current.readOnly && (matchesKey(data, "enter") || matchesKey(data, "right"))) this.onEditText(current.id);
				break;
		}
	}

	handleMouse(event: MouseEvent, rect: Rect): boolean {
		if (!pointInRect(event, rect) || event.action !== "down" || event.button !== "left") {
			return false;
		}
		const localRow = event.row - rect.row + 1;
		const hit = this.renderedControlRows.find((entry) => entry.row === localRow);
		if (!hit) {
			return true;
		}
		const rows = this.controlsForRender();
		this.selectedIndex = clamp(rows.findIndex((entry) => entry.id === hit.controlId), 0, Math.max(0, rows.length - 1));
		const current = rows[this.selectedIndex];
		if (!current) {
			return true;
		}
		if ("type" in current && current.type === "action") {
			this.onAction(current.id);
			return true;
		}
		if (current.type === "boolean") {
			this.onToggle(current.id);
		}
		return true;
	}

	render(width: number): string[] {
		const demo = this.getDemo();
		const values = this.getValues();
		const rows = this.controlsForRender();
		this.selectedIndex = clamp(this.selectedIndex, 0, Math.max(0, rows.length - 1));
		const availableRows = Math.max(1, this.maxHeight - 5);
		const start = clamp(this.selectedIndex - Math.floor(availableRows / 2), 0, Math.max(0, rows.length - availableRows));
		const visibleRows = rows.slice(start, start + availableRows);
		const border = this.isFocused() ? agentTheme.accentStrong : agentTheme.dim;
		const lines: string[] = [];
		lines.push(border("╭" + "─".repeat(Math.max(0, width - 2)) + "╮"));
		lines.push(paintLine(agentTheme.accentStrong(" Inspector"), width));
		lines.push(paintLine(agentTheme.dim(` ${demo.title}`), width));
		this.renderedControlRows = [];
		let row = 4;
		for (const entry of visibleRows) {
			const selected = this.currentControlId() === entry.id;
			const prefix = selected ? agentTheme.accent(" › ") : agentTheme.dim("   ");
			if ("type" in entry && entry.type === "action") {
				lines.push(paintLine(`${prefix}${selected ? agentTheme.accentStrong(entry.label) : agentTheme.muted(entry.label)}`, width));
				this.renderedControlRows.push({ row, controlId: entry.id });
				row++;
				continue;
			}

			const value = values[entry.id];
			const label = truncateToWidth(entry.label, Math.max(1, width - 18), "");
			let valueText = "";
			switch (entry.type) {
				case "number":
					valueText = `${value}`;
					break;
				case "boolean":
					valueText = value ? "ON" : "OFF";
					break;
				case "enum":
				case "text":
					valueText = String(value);
					break;
			}
			const renderedValue = truncateToWidth(valueText, 14, "");
			const valueStyler = entry.type === "text" && entry.readOnly ? agentTheme.muted : agentTheme.accent;
			const content = `${prefix}${selected ? agentTheme.text(label) : agentTheme.dim(label)} ${valueStyler(renderedValue)}`;
			lines.push(paintLine(content, width));
			this.renderedControlRows.push({ row, controlId: entry.id });
			row++;
		}
		lines.push(paintLine("", width));
		lines.push(paintLine(agentTheme.dim(" Left/Right adjust  |  Enter edit"), width));
		lines.push(border("╰" + "─".repeat(Math.max(0, width - 2)) + "╯"));
		return lines;
	}
}
