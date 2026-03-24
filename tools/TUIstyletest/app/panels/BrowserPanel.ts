import { matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { paintLine } from "../../../../src/ansi.js";
import { pointInRect, type MouseEvent, type Rect } from "../../../../src/mouse.js";
import { agentTheme } from "../../../../src/theme.js";
import type { StyleTestDemoDefinition } from "../../../../src/style-test-contract.js";
import { clamp } from "../layout.js";
import type { MouseAwareComponent, PanelListRow } from "../types.js";

export class BrowserPanel implements MouseAwareComponent {
	private readonly rows: PanelListRow[] = [];
	private readonly renderedRows: Array<{ row: number; demoId: string }> = [];
	public maxHeight = 20;

	constructor(
		private readonly getDemos: () => StyleTestDemoDefinition[],
		private readonly getSelectedId: () => string,
		private readonly onSelect: (id: string) => void,
		private readonly isFocused: () => boolean,
	) {}

	invalidate(): void {}

	handleInput(data: string): void {
		const demos = this.getDemos();
		const currentIndex = Math.max(0, demos.findIndex((demo) => demo.id === this.getSelectedId()));
		if (matchesKey(data, "up")) {
			this.onSelect(demos[Math.max(0, currentIndex - 1)]?.id ?? this.getSelectedId());
		}
		if (matchesKey(data, "down")) {
			this.onSelect(demos[Math.min(demos.length - 1, currentIndex + 1)]?.id ?? this.getSelectedId());
		}
	}

	handleMouse(event: MouseEvent, rect: Rect): boolean {
		if (!pointInRect(event, rect) || event.action !== "down" || event.button !== "left") {
			return false;
		}
		const localRow = event.row - rect.row + 1;
		const hit = this.renderedRows.find((entry) => entry.row === localRow);
		if (!hit) {
			return true;
		}
		this.onSelect(hit.demoId);
		return true;
	}

	render(width: number): string[] {
		const selectedId = this.getSelectedId();
		const demos = this.getDemos();
		const grouped = new Map<string, StyleTestDemoDefinition[]>();
		for (const demo of demos) {
			const existing = grouped.get(demo.sourceFile) ?? [];
			existing.push(demo);
			grouped.set(demo.sourceFile, existing);
		}
		this.rows.length = 0;
		for (const [sourceFile, items] of grouped.entries()) {
			this.rows.push({ kind: "group", label: sourceFile });
			for (const demo of items) {
				this.rows.push({ kind: "demo", id: demo.id, title: demo.title, sourceFile: demo.sourceFile, kindLabel: demo.kind.toUpperCase() });
			}
		}
		const selectedRowIndex = Math.max(0, this.rows.findIndex((row) => row.kind === "demo" && row.id === selectedId));
		const availableRows = Math.max(1, this.maxHeight - 5);
		const start = clamp(selectedRowIndex - Math.floor(availableRows / 2), 0, Math.max(0, this.rows.length - availableRows));
		const visibleRows = this.rows.slice(start, start + availableRows);

		const border = this.isFocused() ? agentTheme.accentStrong : agentTheme.dim;
		const lines: string[] = [];
		this.renderedRows.length = 0;
		lines.push(border("╭" + "─".repeat(Math.max(0, width - 2)) + "╮"));
		lines.push(paintLine(agentTheme.accentStrong(" Browser"), width));
		lines.push(paintLine(agentTheme.dim(" Grouped by source file"), width));
		let rowNumber = 4;
		for (const row of visibleRows) {
			if (row.kind === "group") {
				lines.push(paintLine(agentTheme.warning(` ${truncateToWidth(row.label, Math.max(1, width - 2), "")}`), width));
			} else {
				const selected = row.id === selectedId;
				const prefix = selected ? agentTheme.accent(" › ") : agentTheme.dim("   ");
				const title = selected ? agentTheme.accentStrong(row.title) : agentTheme.text(row.title);
				const meta = agentTheme.dim(` ${row.kindLabel}`);
				lines.push(paintLine(`${prefix}${title}${meta}`, width));
				this.renderedRows.push({ row: rowNumber, demoId: row.id });
			}
			rowNumber++;
		}
		lines.push(paintLine("", width));
		lines.push(paintLine(agentTheme.dim(" Up/Down browse  |  Tab focus"), width));
		lines.push(border("╰" + "─".repeat(Math.max(0, width - 2)) + "╯"));
		return lines;
	}
}
