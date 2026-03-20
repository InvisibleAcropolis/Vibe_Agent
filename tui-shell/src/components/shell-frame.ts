import type { Component } from "@mariozechner/pi-tui";
import { paintLine } from "../ansi.js";
import { masterTuiTheme } from "../theme.js";
import type { PanelInstance } from "../types.js";

export class ShellFrame implements Component {
	constructor(
		private readonly getPanel: () => PanelInstance,
		private readonly getBodyHeight: () => number,
		private readonly getStatus: () => string,
	) {}

	invalidate(): void {
		this.getPanel().component.invalidate?.();
	}

	render(width: number): string[] {
		const panel = this.getPanel();
		const headerLines = [
			paintLine(` FutureIDE MasterTUI  ·  ${panel.title}`, width, masterTuiTheme.headerLine),
			paintLine(
				masterTuiTheme.muted("Ctrl+P palette · Ctrl+L launcher · F1 help · Ctrl+Q quit"),
				width,
				masterTuiTheme.headerLine,
			),
		];
		const bodyHeight = this.getBodyHeight();
		const panelLines = panel.component.render(width);
		const fittedPanelLines = panelLines.slice(0, bodyHeight);
		while (fittedPanelLines.length < bodyHeight) {
			fittedPanelLines.push(paintLine("", width, masterTuiTheme.panelBg));
		}
		const footerLines = [
			paintLine(this.getStatus(), width, masterTuiTheme.footerLine),
			paintLine(
				masterTuiTheme.dim("Standalone Phase 2 surface. Desktop embedding and psmux runtime adapters come later."),
				width,
				masterTuiTheme.footerLine,
			),
		];

		return [...headerLines, ...fittedPanelLines, ...footerLines];
	}
}
