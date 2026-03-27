import type { Component } from "@mariozechner/pi-tui";
import { dissolveTextRows, paintBoxLineTwoParts, style, type CellStyler } from "../ansi.js";
import { createComponentRuntime } from "../style-test-fixtures.js";
import { defineStyleTestDemos } from "../style-test-contract.js";
import { agentTheme } from "../theme.js";

const BOX_GLYPHS = new Set(["╔", "╗", "╚", "╝", "║", "═"]);

export interface LogoBlockViewState {
	phase: "hidden" | "intro" | "hold" | "outro";
	progress: number;
	totalSteps: number;
	randomOrder?: readonly number[];
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
			...createLogoBlockRows(width),
		];
		const cellStyler: CellStyler = (sourceChar) => {
			if (sourceChar === " ") {
				return undefined;
			}
			return BOX_GLYPHS.has(sourceChar) ? borderStyler : logoStyler;
		};
		if (state.phase === "outro") {
			return dissolveRandomCells(rows, state.progress, state.totalSteps, state.randomOrder, cellStyler);
		}
		return dissolveTextRows(rows, state.progress, state.totalSteps, { cellStyler });
	}
}

export function createLogoBlockRows(width: number): string[] {
	return [
		paintBoxLineTwoParts("╔", "╗", width, "═"),
		...VIBE_AGENT_LOGO.map((logoRow) => paintBoxLineTwoParts(`║  ${logoRow}`, "  ║", width, " ")),
		paintBoxLineTwoParts("╚", "╝", width, "═"),
	];
}

function dissolveRandomCells(
	rows: readonly string[],
	progress: number,
	totalSteps: number,
	randomOrder: readonly number[] | undefined,
	cellStyler: CellStyler,
): string[] {
	const activeCells = collectVisibleCells(rows);
	if (activeCells.length === 0) {
		return [];
	}
	const orderedIndexes = randomOrder && randomOrder.length === activeCells.length
		? randomOrder
		: activeCells.map((_, index) => index);
	const removedCount = Math.min(
		activeCells.length,
		Math.floor((Math.max(0, progress) / Math.max(1, totalSteps)) * activeCells.length),
	);
	const removed = new Set<number>(orderedIndexes.slice(0, removedCount));

	return rows.map((rowText, rowIndex) => {
		const segments: string[] = [];
		let currentStyler: ReturnType<CellStyler> | undefined;
		let currentRun = "";

		const pushRun = () => {
			if (currentRun.length === 0) {
				return;
			}
			segments.push(currentStyler ? currentStyler(currentRun) : currentRun);
			currentRun = "";
		};

		for (let col = 0; col < rowText.length; col++) {
			const sourceChar = rowText[col] ?? " ";
			const visibleCellIndex = findVisibleCellIndex(activeCells, rowIndex, col);
			const displayChar =
				sourceChar !== " " && visibleCellIndex !== undefined && removed.has(visibleCellIndex)
					? " "
					: sourceChar;
			const nextStyler = displayChar === " " ? undefined : cellStyler(sourceChar, rowIndex, col, displayChar);
			if (nextStyler !== currentStyler) {
				pushRun();
				currentStyler = nextStyler;
			}
			currentRun += displayChar;
		}

		pushRun();
		return segments.join("");
	});
}

function collectVisibleCells(rows: readonly string[]): Array<{ row: number; col: number }> {
	const cells: Array<{ row: number; col: number }> = [];
	for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
		const rowText = rows[rowIndex] ?? "";
		for (let col = 0; col < rowText.length; col++) {
			if ((rowText[col] ?? " ") !== " ") {
				cells.push({ row: rowIndex, col });
			}
		}
	}
	return cells;
}

function findVisibleCellIndex(
	cells: readonly { row: number; col: number }[],
	row: number,
	col: number,
): number | undefined {
	for (let index = 0; index < cells.length; index++) {
		const cell = cells[index]!;
		if (cell.row === row && cell.col === col) {
			return index;
		}
	}
	return undefined;
}

export const styleTestDemos = defineStyleTestDemos({
	exports: {
		LogoBlockView: {
			title: "Logo Block",
			category: "Components",
			kind: "component",
			description: "Logo dissolve animation using the production logo-block component.",
			controls: [
				{ id: "progress", label: "Progress", type: "number", defaultValue: 30, min: 0, max: 42, step: 1 },
				{ id: "totalSteps", label: "Total Steps", type: "number", defaultValue: 42, min: 10, max: 64, step: 1 },
			],
			createRuntime: (_moduleNamespace, _exportName, _exportValue, _context, values) =>
				createComponentRuntime(
					new LogoBlockView(() => ({
						phase: "intro",
						progress: Number(values.progress),
						totalSteps: Number(values.totalSteps),
					})),
				),
		},
	},
});
