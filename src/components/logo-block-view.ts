import type { Component } from "@mariozechner/pi-tui";
import { dissolveTextRows, paintBoxLineTwoParts, style, type CellStyler } from "../ansi.js";
import { agentTheme } from "../theme.js";

const BOX_GLYPHS = new Set(["╔", "╗", "╚", "╝", "║", "═"]);

export interface LogoBlockViewState {
	progress: number;
	totalSteps: number;
}

export const VIBE_AGENT_LOGO = [
	"██╗   ██╗██╗██████╗ ███████╗     █████╗  ██████╗ ███████╗███╗   ██╗████████╗",
	"██║   ██║██║██╔══██╗██╔════╝    ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝",
	"██║   ██║██║██████╔╝█████╗      ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ",
	"╚██╗ ██╔╝██║██╔══██╗██╔══╝      ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ",
	" ╚████╔╝ ██║██████╔╝███████╗    ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ",
	"  ╚═══╝  ╚═╝╚═════╝ ╚══════╝    ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ",
] as const;

const borderStyler = style({ fg: agentTheme.colors.borderActive });
const logoStyler = style({ fg: agentTheme.colors.accentStrong, bold: true });

export class LogoBlockView implements Component {
	constructor(private readonly getState: () => LogoBlockViewState) {}

	invalidate(): void {}

	render(width: number): string[] {
		const state = this.getState();
		if (state.progress <= 0) {
			return [];
		}

		const rows = [
			paintBoxLineTwoParts("╔", "╗", width, "═"),
			...VIBE_AGENT_LOGO.map((logoRow) => paintBoxLineTwoParts(`║  ${logoRow}`, "  ║", width, " ")),
			paintBoxLineTwoParts("╚", "╝", width, "═"),
		];
		const cellStyler: CellStyler = (sourceChar) => {
			if (sourceChar === " ") {
				return undefined;
			}
			return BOX_GLYPHS.has(sourceChar) ? borderStyler : logoStyler;
		};
		return dissolveTextRows(rows, state.progress, state.totalSteps, { cellStyler });
	}
}
