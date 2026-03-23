import { matchesKey, type Focusable } from "@mariozechner/pi-tui";
import { horizontalRule, paintLine } from "../ansi.js";
import { createOverlayPreviewRuntime } from "../style-test-fixtures.js";
import { defineStyleTestDemos } from "../style-test-contract.js";
import { agentTheme } from "../theme.js";
import type { MouseAwareOverlay } from "../types.js";
import {
	createOrcTrackerDashboardViewModel,
	type OrcTelemetryField,
	type OrcTrackerDashboardViewModel,
} from "../orchestration/orc-tracker.js";

export class OrchestrationStatusPanel implements MouseAwareOverlay, Focusable {
	private _focused = false;

	constructor(
		private readonly viewModel: OrcTrackerDashboardViewModel | (() => OrcTrackerDashboardViewModel),
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
		const bg = agentTheme.panelBgActive;
		const safeWidth = Math.max(32, width);
		const viewModel = this.resolveViewModel();
		const top = agentTheme.dim("╭" + "─".repeat(Math.max(0, safeWidth - 2)) + "╮");
		const bottom = agentTheme.dim("╰" + "─".repeat(Math.max(0, safeWidth - 2)) + "╯");

		lines.push(paintLine(top, safeWidth, bg));
		lines.push(paintLine(agentTheme.accentStrong(` ${viewModel.title}`), safeWidth, bg));
		lines.push(paintLine(agentTheme.muted(` ${viewModel.subtitle}`), safeWidth, bg));
		lines.push(paintLine(horizontalRule(safeWidth - 2, "─", agentTheme.dim), safeWidth, bg));

		if (!viewModel.hasActiveGraph) {
			lines.push(paintLine(agentTheme.warning(` ${viewModel.emptyStateTitle}`), safeWidth, bg));
			lines.push(paintLine(` ${agentTheme.text(viewModel.emptyStateMessage)}`, safeWidth, bg));
			lines.push(paintLine("", safeWidth, bg));
		}

		lines.push(paintLine(agentTheme.accent(" Orchestration telemetry"), safeWidth, bg));
		for (const field of Object.values(viewModel.fields)) {
			lines.push(this.renderField(field, safeWidth));
		}

		lines.push(paintLine("", safeWidth, bg));
		lines.push(paintLine(agentTheme.accent(" Summary"), safeWidth, bg));
		for (const highlight of viewModel.highlights) {
			lines.push(paintLine(`   ${agentTheme.dim("•")} ${agentTheme.text(highlight)}`, safeWidth, bg));
		}

		lines.push(paintLine("", safeWidth, bg));
		lines.push(paintLine(agentTheme.muted(" Raw agent transcript remains suppressed on this surface."), safeWidth, bg));
		lines.push(paintLine(horizontalRule(safeWidth - 2, "─", agentTheme.dim), safeWidth, bg));
		lines.push(paintLine(agentTheme.dim("  Esc/Enter close"), safeWidth, bg));
		lines.push(paintLine(bottom, safeWidth, bg));
		return lines;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "esc") || matchesKey(data, "enter")) {
			this.onClose();
		}
	}

	private resolveViewModel(): OrcTrackerDashboardViewModel {
		return typeof this.viewModel === "function" ? this.viewModel() : this.viewModel;
	}

	private renderField(field: OrcTelemetryField, width: number): string {
		return paintLine(
			`   ${agentTheme.dim(field.label.padEnd(24))} ${this.styleValue(field)}`,
			width,
			agentTheme.panelBgActive,
		);
	}

	private styleValue(field: OrcTelemetryField): string {
		switch (field.tone) {
			case "accent":
				return agentTheme.accentStrong(field.value);
			case "success":
				return agentTheme.success(field.value);
			case "warning":
				return agentTheme.warning(field.value);
			case "dim":
				return agentTheme.muted(field.value);
			default:
				return agentTheme.text(field.value);
		}
	}
}

export const styleTestDemos = defineStyleTestDemos({
	exports: {
		OrchestrationStatusPanel: {
			title: "Orchestration Status Panel",
			category: "Overlays",
			kind: "overlay",
			description: "Friendly Orc telemetry panel with transcript-free tracker fields.",
			createRuntime: (_moduleNamespace, _exportName, _exportValue, context) =>
				createOverlayPreviewRuntime(
					"Friendly Orc telemetry panel with transcript-free tracker fields.",
					"src/components/orchestration-status-panel.ts",
					() =>
						context.showOverlay(
							"styletest-orc-status",
							new OrchestrationStatusPanel(createOrcTrackerDashboardViewModel(), () => context.closeOverlay("styletest-orc-status")),
							{ width: 76, maxHeight: "80%", anchor: "center", margin: 1 },
						),
				),
		},
	},
});
