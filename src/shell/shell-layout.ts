import { measureMenuBarItems } from "../components/menu-bar.js";
import { SHELL_MENU_ITEMS } from "./shell-constants.js";
import type { ShellLayoutInput, ShellLayoutResult, ShellMenuAnchorInput } from "./shell-types.js";

export function measureShellLayout(input: ShellLayoutInput): ShellLayoutResult {
	const fixedHeight =
		input.customHeaderHeight +
		input.headerHeight +
		input.menuHeight +
		input.separatorTopHeight +
		input.separatorMidHeight +
		input.widgetAboveHeight +
		input.editorHeight +
		input.widgetBelowHeight +
		input.footerContentHeight +
		input.statusHeight +
		input.summaryHeight +
		input.thinkingTrayHeight;
	const contentHeight = Math.max(3, input.rows - fixedHeight);
	const leftWidth = input.sessionsPanelVisible ? Math.max(0, input.cols - input.rightWidth - 1) : input.cols;
	const contentRow = 1 + input.customHeaderHeight + input.headerHeight + input.menuHeight + input.separatorTopHeight;

	return {
		contentHeight,
		transcriptRect: {
			row: contentRow,
			col: 1,
			width: Math.max(1, leftWidth),
			height: contentHeight,
		},
	};
}

export function measureShellMenuAnchor(input: ShellMenuAnchorInput): { row: number; col: number } {
	const layout = measureMenuBarItems(SHELL_MENU_ITEMS).find((item) => item.key === input.key);
	return {
		row: input.customHeaderHeight + input.headerHeight + 1,
		col: layout?.startCol ?? 2,
	};
}
