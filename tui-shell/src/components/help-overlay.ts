import { Markdown, matchesKey } from "@mariozechner/pi-tui";
import { paintLine } from "../ansi.js";
import type { MouseAwareOverlay } from "../types.js";
import { masterTuiTheme } from "../theme.js";

const helpMarkdown = `
# FutureIDE MasterTUI

- \`Ctrl+P\` opens the command palette.
- \`F1\` opens this help overlay.
- \`Ctrl+L\` opens the launcher.
- \`Tab\` rotates focus inside the workspace panel.
- \`Ctrl+Q\` quits and restores terminal state.

## Mouse Support

- Click command palette and launcher rows to activate them.
- Use the mouse wheel in the workspace panel to scroll.
- Click the workspace body to return focus to it after overlays close.

## Reserved Expansion Points

- Additional panel slots
- Sub-agent runtimes
- File browsing surfaces
- richer psmux-backed panel adapters
`;

export class HelpOverlay implements MouseAwareOverlay {
	private readonly markdown = new Markdown(
		helpMarkdown,
		0,
		0,
		masterTuiTheme.markdownTheme,
		masterTuiTheme.defaultMarkdownText,
	);

	constructor(private readonly onClose: () => void) {}

	invalidate(): void {
		this.markdown.invalidate();
	}

	render(width: number): string[] {
		return [
			paintLine(masterTuiTheme.accentStrong("Help"), width, masterTuiTheme.panelBgActive),
			paintLine(
				masterTuiTheme.muted("This overlay documents the reusable shell and its current psmux-backed surface."),
				width,
				masterTuiTheme.panelBgActive,
			),
			paintLine("", width, masterTuiTheme.panelBgActive),
			...this.markdown.render(width).map((line) => paintLine(line, width, masterTuiTheme.panelBgActive)),
			paintLine("", width, masterTuiTheme.panelBgActive),
			paintLine(masterTuiTheme.dim("Esc, Enter, or Space closes help"), width, masterTuiTheme.panelBgActive),
		];
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "esc") || matchesKey(data, "enter") || data === " ") {
			this.onClose();
		}
	}
}
