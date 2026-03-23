import { truncateToWidth } from "@mariozechner/pi-tui";
import { paintLine } from "../../../../src/ansi.js";
import { agentTheme } from "../../../../src/theme.js";
import type { MouseEvent, Rect } from "../../../../src/mouse.js";
import type { StyleTestDemoDefinition, StyleTestRuntime } from "../../../../src/style-test-contract.js";
import { padVisible } from "../layout.js";
import type { MouseAwareComponent } from "../types.js";

export class PreviewPanel implements MouseAwareComponent {
	public maxHeight = 20;

	constructor(
		private readonly getDemo: () => StyleTestDemoDefinition,
		private readonly getRuntime: () => StyleTestRuntime | undefined,
		private readonly isFocused: () => boolean,
	) {}

	invalidate(): void {}

	handleMouse(_event: MouseEvent, _rect: Rect): boolean {
		return false;
	}

	handleInput(data: string): void {
		this.getRuntime()?.handleInput?.(data);
	}

	render(width: number): string[] {
		const height = this.maxHeight;
		const demo = this.getDemo();
		const runtime = this.getRuntime();
		const border = this.isFocused() ? agentTheme.accentStrong : agentTheme.dim;
		const bodyWidth = Math.max(1, width - 2);
		const bodyHeight = Math.max(1, height - 6);
		const lines: string[] = [];
		lines.push(border("╭" + "─".repeat(Math.max(0, width - 2)) + "╮"));
		lines.push(paintLine(agentTheme.accentStrong(` ${demo.title}`), width));
		lines.push(paintLine(agentTheme.dim(` ${demo.description}`), width));
		lines.push(paintLine(border("├" + "─".repeat(Math.max(0, width - 2)) + "┤"), width));
		const rendered = runtime?.render(bodyWidth, bodyHeight) ?? [agentTheme.warning(truncateToWidth("No preview runtime available.", Math.max(1, bodyWidth), ""))];
		for (const line of rendered.slice(0, bodyHeight)) {
			lines.push(border("│") + padVisible(truncateToWidth(line, bodyWidth, ""), bodyWidth) + border("│"));
		}
		while (lines.length < height - 1) {
			lines.push(border("│") + " ".repeat(bodyWidth) + border("│"));
		}
		lines.push(border("╰" + "─".repeat(Math.max(0, width - 2)) + "╯"));
		return lines;
	}
}
