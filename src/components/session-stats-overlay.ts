import { matchesKey, type Focusable } from "@mariozechner/pi-tui";
import { horizontalRule, paintLine } from "../ansi.js";
import type { AgentHostState } from "../agent-host.js";
import type { SessionStats } from "../local-coding-agent.js";
import { createOverlayPreviewRuntime, sampleHostState, sampleStats } from "../style-test-fixtures.js";
import { defineStyleTestDemos } from "../style-test-contract.js";
import { agentTheme } from "../theme.js";
import type { MouseAwareOverlay } from "../types.js";

/**
 * Session statistics overlay: displays token usage, cost, message counts,
 * model information, and session metadata. Provides full parity with the
 * WebUI's session information panel.
 */
export class SessionStatsOverlay implements MouseAwareOverlay, Focusable {
	private _focused = false;

	constructor(
		private readonly stats: SessionStats,
		private readonly hostState: AgentHostState | undefined,
		private readonly gitBranch: string | null,
		private readonly onClose: () => void,
	) {}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const lines: string[] = [];
		const pad = "  ";
		const top = agentTheme.dim("╭" + "─".repeat(Math.max(0, width - 2)) + "╮");
		const bottom = agentTheme.dim("╰" + "─".repeat(Math.max(0, width - 2)) + "╯");

		lines.push(paintLine(top, width, agentTheme.panelBgActive));
		lines.push(paintLine(agentTheme.accentStrong(" Session Statistics"), width, agentTheme.panelBgActive));
		lines.push(paintLine(horizontalRule(width - 2, "─", agentTheme.dim), width, agentTheme.panelBgActive));

		// Session Info
		lines.push(paintLine(agentTheme.accent(`${pad}Session`), width, agentTheme.panelBgActive));
		lines.push(this.row(pad, "ID", this.stats.sessionId, width));
		if (this.hostState?.sessionName) {
			lines.push(this.row(pad, "Name", this.hostState.sessionName, width));
		}
		if (this.stats.sessionFile) {
			lines.push(this.row(pad, "File", this.stats.sessionFile, width));
		}
		if (this.gitBranch) {
			lines.push(this.row(pad, "Git Branch", this.gitBranch, width));
		}
		lines.push(paintLine("", width, agentTheme.panelBgActive));

		// Model Info
		if (this.hostState?.model) {
			lines.push(paintLine(agentTheme.accent(`${pad}Model`), width, agentTheme.panelBgActive));
			lines.push(this.row(pad, "Provider", this.hostState.model.provider, width));
			lines.push(this.row(pad, "Model", this.hostState.model.id, width));
			lines.push(this.row(pad, "Thinking", this.hostState.thinkingLevel, width));
			lines.push(this.row(pad, "Streaming", this.hostState.isStreaming ? "yes" : "no", width));
			lines.push(this.row(pad, "Auto Compact", this.hostState.autoCompactionEnabled ? "on" : "off", width));
			lines.push(paintLine("", width, agentTheme.panelBgActive));
		}

		// Message Counts
		lines.push(paintLine(agentTheme.accent(`${pad}Messages`), width, agentTheme.panelBgActive));
		lines.push(this.row(pad, "Total", String(this.stats.totalMessages), width));
		lines.push(this.row(pad, "User", String(this.stats.userMessages), width));
		lines.push(this.row(pad, "Assistant", String(this.stats.assistantMessages), width));
		lines.push(this.row(pad, "Tool Calls", String(this.stats.toolCalls), width));
		lines.push(this.row(pad, "Tool Results", String(this.stats.toolResults), width));
		if (this.hostState?.pendingMessageCount) {
			lines.push(this.row(pad, "Pending", String(this.hostState.pendingMessageCount), width));
		}
		lines.push(paintLine("", width, agentTheme.panelBgActive));

		// Token Usage
		lines.push(paintLine(agentTheme.accent(`${pad}Token Usage`), width, agentTheme.panelBgActive));
		lines.push(this.row(pad, "Input", this.formatNumber(this.stats.tokens.input), width));
		lines.push(this.row(pad, "Output", this.formatNumber(this.stats.tokens.output), width));
		lines.push(this.row(pad, "Cache Read", this.formatNumber(this.stats.tokens.cacheRead), width));
		lines.push(this.row(pad, "Cache Write", this.formatNumber(this.stats.tokens.cacheWrite), width));
		lines.push(this.row(pad, "Total", agentTheme.accentStrong(this.formatNumber(this.stats.tokens.total)), width));
		lines.push(paintLine("", width, agentTheme.panelBgActive));

		// Cost
		if (this.stats.cost !== undefined) {
			lines.push(paintLine(agentTheme.accent(`${pad}Cost`), width, agentTheme.panelBgActive));
			lines.push(this.row(pad, "Total", `$${this.stats.cost.toFixed(4)}`, width));
			lines.push(paintLine("", width, agentTheme.panelBgActive));
		}

		lines.push(paintLine(horizontalRule(width - 2, "─", agentTheme.dim), width, agentTheme.panelBgActive));
		lines.push(paintLine(agentTheme.dim(`${pad}Esc close`), width, agentTheme.panelBgActive));
		lines.push(paintLine(bottom, width, agentTheme.panelBgActive));

		return lines;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "esc") || matchesKey(data, "enter")) {
			this.onClose();
		}
	}

	private row(pad: string, label: string, value: string, width: number): string {
		return paintLine(`${pad}  ${agentTheme.dim(label.padEnd(14))} ${agentTheme.text(value)}`, width, agentTheme.panelBgActive);
	}

	private formatNumber(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
		return String(n);
	}
}

export const styleTestDemos = defineStyleTestDemos({
	exports: {
		SessionStatsOverlay: {
			title: "Session Stats Overlay",
			category: "Overlays",
			kind: "overlay",
			description: "Session metadata overlay rendered with fixture host stats.",
			createRuntime: (_moduleNamespace, _exportName, _exportValue, context) =>
				createOverlayPreviewRuntime(
					"Session metadata overlay rendered with fixture host stats.",
					"src/components/session-stats-overlay.ts",
					() =>
						context.showOverlay(
							"styletest-session-stats",
							new SessionStatsOverlay(sampleStats(), sampleHostState(), "codex/stylelab", () =>
								context.closeOverlay("styletest-session-stats"),
							),
							{ width: 72, maxHeight: "80%", anchor: "center", margin: 1 },
						),
				),
		},
	},
});
