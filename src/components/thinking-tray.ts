import { Markdown, truncateToWidth, visibleWidth, type Component } from "@mariozechner/pi-tui";
import { agentTheme } from "../theme.js";

export class ThinkingTray implements Component {
	private enabled = true;
	private thinkingText = "";

	constructor(
		private readonly maxBodyLines = 6,
		private readonly minBodyLines = 2,
	) {}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	setThinkingText(text: string | undefined): void {
		this.thinkingText = text?.trim() ?? "";
	}

	get visible(): boolean {
		return this.enabled;
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (!this.visible || width < 8) {
			return [];
		}

		const innerWidth = Math.max(1, width - 4);
		const border = agentTheme.accent;
		const title = agentTheme.thinkingSegment(" Thinking ");
		const bodyLines = this.renderBody(innerWidth);
		const lines: string[] = [];

		lines.push(this.paintTop(width, title, border));
		for (const line of bodyLines) {
			lines.push(this.paintBody(width, line, border));
		}
		lines.push(this.paintBottom(width, border));
		return lines;
	}

	private paintTop(width: number, title: string, border: (text: string) => string): string {
		const titleWidth = visibleWidth(title);
		const fill = Math.max(0, width - titleWidth - 4);
		return border(`┌─`) + title + border(`${"─".repeat(fill)}┐`);
	}

	private paintBody(width: number, line: string, border: (text: string) => string): string {
		const truncated = truncateToWidth(line, Math.max(1, width - 4), "");
		const padding = " ".repeat(Math.max(0, width - 4 - visibleWidth(truncated)));
		return `${border("│ ")}${truncated}${padding}${border(" │")}`;
	}

	private paintBottom(width: number, border: (text: string) => string): string {
		return border(`└${"─".repeat(Math.max(0, width - 2))}┘`);
	}

	private renderBody(innerWidth: number): string[] {
		let lines: string[];
		if (this.thinkingText.length > 0) {
			const body = new Markdown(this.thinkingText, 0, 0, agentTheme.markdownTheme, {
				color: (text: string) => agentTheme.thinkingLabel(text),
				italic: true,
			});
			lines = body.render(innerWidth).slice(0, this.maxBodyLines);
		} else {
			lines = [];
		}

		const targetLines = Math.max(this.minBodyLines, lines.length);
		while (lines.length < targetLines) {
			lines.push("");
		}
		return lines;
	}
}
