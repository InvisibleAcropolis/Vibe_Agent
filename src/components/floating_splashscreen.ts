import { truncateToWidth, visibleWidth, type Component } from "@mariozechner/pi-tui";
import { hslToHex } from "../ansi.js";
import type { AnimationState } from "../animation-engine.js";
import { VIBE_AGENT_LOGO } from "./logo-block-view.js";

export type SplashPhase = "hidden" | "intro" | "hold" | "outro";

export interface FloatingSplashScreenState {
	phase: SplashPhase;
	progress: number;
	totalSteps: number;
	randomOrder?: readonly number[];
	animationState?: AnimationState;
}

interface CellStyle {
	fg?: string;
	bg?: string;
	bold?: boolean;
	dim?: boolean;
	italic?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
}

interface SplashCell {
	char: string;
	style?: CellStyle;
}

const CONTENT_WIDTH = 80;
const CONTENT_HEIGHT = 10;
const WINDOW_WIDTH = CONTENT_WIDTH + 2;
const WINDOW_HEIGHT = CONTENT_HEIGHT + 3;
const TITLE_TEXT = " VIBE AGENT ";
const STATUS_TEXT = " TS SPLASH ";
const FOOTER_TEXT = "TypeScript field  •  passive bootstrap splash";
const FOOTER_META = `${CONTENT_WIDTH}x${CONTENT_HEIGHT}`;
const CODE_GLYPHS = ["{", "}", "[", "]", "<", ">", "/", "\\", "=", "+", "*", ":", ";", "|", "T", "S"] as const;
const PANEL_BACKGROUND = "#0d2134";
const FOOTER_FOREGROUND = "#93b4ca";
const FOOTER_BACKGROUND = "#11283b";
const FOOTER_META_FOREGROUND = "#58d7ff";
const FRAME_BASE_HUE = 200;

export class FloatingSplashScreen implements Component {
	constructor(private readonly getState: () => FloatingSplashScreenState) {}

	invalidate(): void {}

	render(width: number): string[] {
		const state = this.getState();
		if (state.phase === "hidden") {
			return [];
		}

		const windowWidth = Math.max(20, Math.min(width, WINDOW_WIDTH));
		const rows = this.buildWindowRows(windowWidth, state);
		return rows.map((row, rowIndex) => this.renderRow(row, state, rowIndex));
	}

	private buildWindowRows(windowWidth: number, state: FloatingSplashScreenState): SplashCell[][] {
		const viewportWidth = Math.max(8, windowWidth - 2);
		const rows = Array.from({ length: WINDOW_HEIGHT }, () => this.blankRow(windowWidth));
		const borderColor = this.frameColor(state.animationState, 0);
		const titleWidth = Math.max(0, viewportWidth - visibleWidth(STATUS_TEXT));
		const topInner = this.fitToWidth(TITLE_TEXT, titleWidth, "left");
		const rightMeta = this.fitToWidth(STATUS_TEXT, viewportWidth - visibleWidth(topInner), "right");
		this.paintRow(rows[0]!, `${topInner}${rightMeta}`.padEnd(viewportWidth, "─"), 1, {
			fg: borderColor,
			bold: true,
		}, true);
		rows[0]![0] = { char: "╭", style: { fg: borderColor, bold: true } };
		rows[0]![windowWidth - 1] = { char: "╮", style: { fg: borderColor, bold: true } };

		for (let contentRowIndex = 0; contentRowIndex < CONTENT_HEIGHT; contentRowIndex++) {
			const row = rows[contentRowIndex + 1]!;
			const frameColor = this.frameColor(state.animationState, contentRowIndex + 1);
			row[0] = { char: "│", style: { fg: frameColor, bold: true } };
			row[windowWidth - 1] = { char: "│", style: { fg: frameColor, bold: true } };
			for (let col = 1; col < windowWidth - 1; col++) {
				row[col] = { char: " ", style: { bg: PANEL_BACKGROUND } };
			}
		}

		this.paintLogo(rows, state, viewportWidth);

		const footerRow = rows[WINDOW_HEIGHT - 2]!;
		const footerColor = this.frameColor(state.animationState, WINDOW_HEIGHT - 2);
		footerRow[0] = { char: "├", style: { fg: footerColor, bold: true } };
		footerRow[windowWidth - 1] = { char: "┤", style: { fg: footerColor, bold: true } };
		const footerLeft = this.fitToWidth(FOOTER_TEXT, Math.max(0, viewportWidth - visibleWidth(FOOTER_META)), "left");
		const footerRight = this.fitToWidth(FOOTER_META, viewportWidth - visibleWidth(footerLeft), "right");
		this.paintRow(footerRow, `${footerLeft}${footerRight}`.padEnd(viewportWidth, " "), 1, {
			fg: FOOTER_FOREGROUND,
			bg: FOOTER_BACKGROUND,
		}, true);
		this.paintText(footerRow, footerLeft, 1, { fg: FOOTER_FOREGROUND, bg: FOOTER_BACKGROUND });
		this.paintText(footerRow, footerRight, 1 + viewportWidth - visibleWidth(footerRight), {
			fg: FOOTER_META_FOREGROUND,
			bg: FOOTER_BACKGROUND,
			bold: true,
		});

		const bottomRow = rows[WINDOW_HEIGHT - 1]!;
		bottomRow[0] = { char: "╰", style: { fg: borderColor, bold: true } };
		bottomRow[windowWidth - 1] = { char: "╯", style: { fg: borderColor, bold: true } };
		for (let col = 1; col < windowWidth - 1; col++) {
			bottomRow[col] = { char: "═", style: { fg: borderColor, dim: true } };
		}

		return rows;
	}

	private paintLogo(rows: SplashCell[][], state: FloatingSplashScreenState, viewportWidth: number): void {
		const leftPadding = Math.max(0, Math.floor((viewportWidth - VIBE_AGENT_LOGO[0]!.length) / 2));
		const topPadding = Math.max(0, Math.floor((CONTENT_HEIGHT - VIBE_AGENT_LOGO.length) / 2));

		for (let rowIndex = 0; rowIndex < VIBE_AGENT_LOGO.length; rowIndex++) {
			const logoRow = VIBE_AGENT_LOGO[rowIndex]!;
			const targetRow = rows[rowIndex + 1 + topPadding];
			if (!targetRow) {
				continue;
			}
			for (let colIndex = 0; colIndex < logoRow.length; colIndex++) {
				const sourceChar = logoRow[colIndex] ?? " ";
				if (sourceChar === " ") {
					continue;
				}
				const targetCol = 1 + leftPadding + colIndex;
				if (targetCol <= 0 || targetCol >= targetRow.length - 1) {
					continue;
				}
				targetRow[targetCol] = {
					char: this.logoGlyphForCell(state.animationState, rowIndex, colIndex),
					style: this.logoStyleForCell(state.animationState, rowIndex, colIndex),
				};
			}
		}
	}

	private renderRow(row: SplashCell[], state: FloatingSplashScreenState, rowIndex: number): string {
		const visibleCells = this.collectVisibleCells(row, rowIndex);
		const removedCount = state.phase === "outro"
			? Math.min(
				state.randomOrder?.length ?? visibleCells.length,
				Math.floor(
					(Math.max(0, state.progress) / Math.max(1, state.totalSteps))
					* (state.randomOrder?.length ?? visibleCells.length),
				),
			)
			: 0;
		const removed = state.phase === "outro"
			? new Set<number>((state.randomOrder ?? []).slice(0, removedCount))
			: undefined;

		let output = "";
		let currentSignature = "";
		let currentPrefix = "";
		let currentRun = "";

		const pushRun = () => {
			if (currentRun.length === 0) {
				return;
			}
			output += currentPrefix ? `${currentPrefix}${currentRun}\x1b[0m` : currentRun;
			currentRun = "";
		};

		for (let colIndex = 0; colIndex < row.length; colIndex++) {
			const cell = row[colIndex] ?? { char: " " };
			const visibleCellIndex = cell.char === " " ? undefined : this.cellId(rowIndex, colIndex);
			const hiddenByIntro = state.phase === "intro" && !this.shouldRevealIntroCell(rowIndex, colIndex, state.progress, state.totalSteps);
			const hiddenByOutro = state.phase === "outro" && visibleCellIndex !== undefined && removed?.has(visibleCellIndex);
			const displayChar = hiddenByIntro || hiddenByOutro ? " " : cell.char;
			const { signature, prefix } = this.styleSignature(displayChar === " " ? undefined : cell.style);
			if (signature !== currentSignature) {
				pushRun();
				currentSignature = signature;
				currentPrefix = prefix;
			}
			currentRun += displayChar;
		}

		pushRun();
		return output;
	}

	private collectVisibleCells(row: SplashCell[], rowIndex: number): number[] {
		const cells: number[] = [];
		for (let colIndex = 0; colIndex < row.length; colIndex++) {
			if ((row[colIndex]?.char ?? " ") !== " ") {
				cells.push(this.cellId(rowIndex, colIndex));
			}
		}
		return cells;
	}

	private cellId(row: number, col: number): number {
		return row * WINDOW_WIDTH + col;
	}

	private shouldRevealIntroCell(row: number, col: number, progress: number, totalSteps: number): boolean {
		const normalizedSteps = Math.max(1, totalSteps);
		const bucket = 1 + (((row * 17) + (col * 31) + ((row + col) % 5) * 7) % normalizedSteps);
		return progress >= bucket;
	}

	private logoGlyphForCell(animationState: AnimationState | undefined, row: number, col: number): string {
		const tickCount = animationState?.tickCount ?? 0;
		const spinnerFrame = animationState?.spinnerFrame ?? 0;
		const index = (row * 11 + col * 7 + tickCount + spinnerFrame * 3) % CODE_GLYPHS.length;
		return CODE_GLYPHS[index] ?? "T";
	}

	private logoStyleForCell(animationState: AnimationState | undefined, row: number, col: number): CellStyle {
		const tickCount = animationState?.tickCount ?? 0;
		const breath = animationState?.breathPhase ?? 0.5;
		const hue = (FRAME_BASE_HUE + (tickCount * 3) + row * 9 + col * 2) % 360;
		const lightness = 0.52 + (breath * 0.16);
		return {
			fg: hslToHex(hue, 0.78, Math.min(0.78, lightness)),
			bg: PANEL_BACKGROUND,
			bold: true,
		};
	}

	private frameColor(animationState: AnimationState | undefined, rowOffset: number): string {
		const hue = ((animationState?.hueOffset ?? FRAME_BASE_HUE) + rowOffset * 3) % 360;
		return hslToHex(hue, 0.72, 0.62);
	}

	private blankRow(width: number): SplashCell[] {
		return Array.from({ length: width }, () => ({ char: " " }));
	}

	private paintRow(row: SplashCell[], text: string, startCol: number, style: CellStyle, fillBackground = false): void {
		for (let index = 0; index < text.length; index++) {
			const targetCol = startCol + index;
			if (targetCol < 0 || targetCol >= row.length) {
				continue;
			}
			const char = text[index] ?? " ";
			row[targetCol] = {
				char,
				style: fillBackground || char !== " " ? style : undefined,
			};
		}
	}

	private paintText(row: SplashCell[], text: string, startCol: number, style: CellStyle): void {
		for (let index = 0; index < text.length; index++) {
			const targetCol = startCol + index;
			if (targetCol < 0 || targetCol >= row.length) {
				continue;
			}
			const char = text[index] ?? " ";
			if (char === " ") {
				continue;
			}
			row[targetCol] = { char, style };
		}
	}

	private fitToWidth(text: string, width: number, alignment: "left" | "right"): string {
		const clipped = truncateToWidth(text, Math.max(0, width), "");
		const padding = " ".repeat(Math.max(0, width - visibleWidth(clipped)));
		return alignment === "right" ? `${padding}${clipped}` : `${clipped}${padding}`;
	}

	private styleSignature(style: CellStyle | undefined): { signature: string; prefix: string } {
		if (!style) {
			return { signature: "", prefix: "" };
		}
		const codes: string[] = [];
		if (style.bold) codes.push("1");
		if (style.dim) codes.push("2");
		if (style.italic) codes.push("3");
		if (style.underline) codes.push("4");
		if (style.strikethrough) codes.push("9");
		if (style.fg) {
			const [r, g, b] = this.hexToRgb(style.fg);
			codes.push(`38;2;${r};${g};${b}`);
		}
		if (style.bg) {
			const [r, g, b] = this.hexToRgb(style.bg);
			codes.push(`48;2;${r};${g};${b}`);
		}
		if (codes.length === 0) {
			return { signature: "", prefix: "" };
		}
		return {
			signature: codes.join(";"),
			prefix: `\x1b[${codes.join(";")}m`,
		};
	}

	private hexToRgb(color: string): [number, number, number] {
		const normalized = color.replace("#", "");
		return [
			Number.parseInt(normalized.slice(0, 2), 16),
			Number.parseInt(normalized.slice(2, 4), 16),
			Number.parseInt(normalized.slice(4, 6), 16),
		];
	}
}

export const FLOATING_SPLASH_WINDOW_WIDTH = WINDOW_WIDTH;
export const FLOATING_SPLASH_WINDOW_HEIGHT = WINDOW_HEIGHT;

export function buildFloatingSplashVisibleCellOrder(): number[] {
	const cellIds: number[] = [];
	for (let rowIndex = 0; rowIndex < WINDOW_HEIGHT; rowIndex++) {
		for (let colIndex = 0; colIndex < WINDOW_WIDTH; colIndex++) {
			const onFrame = rowIndex === 0 || rowIndex === WINDOW_HEIGHT - 1 || colIndex === 0 || colIndex === WINDOW_WIDTH - 1;
			const onFooter = rowIndex === WINDOW_HEIGHT - 2 && colIndex > 0 && colIndex < WINDOW_WIDTH - 1;
			if (onFrame || onFooter) {
				cellIds.push(rowIndex * WINDOW_WIDTH + colIndex);
			}
		}
	}

	const leftPadding = Math.floor((CONTENT_WIDTH - VIBE_AGENT_LOGO[0]!.length) / 2);
	const topPadding = Math.floor((CONTENT_HEIGHT - VIBE_AGENT_LOGO.length) / 2);
	for (let rowIndex = 0; rowIndex < VIBE_AGENT_LOGO.length; rowIndex++) {
		const logoRow = VIBE_AGENT_LOGO[rowIndex]!;
		for (let colIndex = 0; colIndex < logoRow.length; colIndex++) {
			if ((logoRow[colIndex] ?? " ") === " ") {
				continue;
			}
			const windowRow = rowIndex + 1 + topPadding;
			const windowCol = 1 + leftPadding + colIndex;
			cellIds.push(windowRow * WINDOW_WIDTH + windowCol);
		}
	}

	return Array.from(new Set(cellIds));
}
