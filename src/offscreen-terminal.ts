import type { Terminal as XtermTerminalType } from "@xterm/headless";
import xterm from "@xterm/headless";
import type { Terminal } from "@mariozechner/pi-tui";

const XtermTerminal = xterm.Terminal;

export class OffscreenTerminal implements Terminal {
	private readonly xterm: XtermTerminalType;
	private inputHandler?: (data: string) => void;
	private resizeHandler?: () => void;
	private _columns: number;
	private _rows: number;

	constructor(columns: number, rows: number) {
		this._columns = Math.max(1, columns);
		this._rows = Math.max(1, rows);
		this.xterm = new XtermTerminal({
			cols: this._columns,
			rows: this._rows,
			disableStdin: true,
			allowProposedApi: true,
		});
	}

	start(onInput: (data: string) => void, onResize: () => void): void {
		this.inputHandler = onInput;
		this.resizeHandler = onResize;
	}

	stop(): void {
		this.inputHandler = undefined;
		this.resizeHandler = undefined;
	}

	async drainInput(_maxMs?: number, _idleMs?: number): Promise<void> {}

	write(data: string): void {
		this.xterm.write(data);
	}

	get columns(): number {
		return this._columns;
	}

	get rows(): number {
		return this._rows;
	}

	get kittyProtocolActive(): boolean {
		return true;
	}

	moveBy(lines: number): void {
		if (lines > 0) {
			this.xterm.write(`\x1b[${lines}B`);
		} else if (lines < 0) {
			this.xterm.write(`\x1b[${-lines}A`);
		}
	}

	hideCursor(): void {
		this.xterm.write("\x1b[?25l");
	}

	showCursor(): void {
		this.xterm.write("\x1b[?25h");
	}

	clearLine(): void {
		this.xterm.write("\x1b[K");
	}

	clearFromCursor(): void {
		this.xterm.write("\x1b[J");
	}

	clearScreen(): void {
		this.xterm.write("\x1b[2J\x1b[H");
	}

	setTitle(title: string): void {
		this.xterm.write(`\x1b]0;${title}\x07`);
	}

	resize(columns: number, rows: number): void {
		const nextColumns = Math.max(1, columns);
		const nextRows = Math.max(1, rows);
		if (nextColumns === this._columns && nextRows === this._rows) {
			return;
		}
		this._columns = nextColumns;
		this._rows = nextRows;
		this.xterm.resize(nextColumns, nextRows);
		this.resizeHandler?.();
	}

	async flush(): Promise<void> {
		return await new Promise<void>((resolve) => {
			this.xterm.write("", () => resolve());
		});
	}

	getViewport(): string[] {
		const lines: string[] = [];
		const buffer = this.xterm.buffer.active;
		for (let i = 0; i < this._rows; i++) {
			const line = buffer.getLine(buffer.viewportY + i);
			lines.push(line ? this.renderStyledLine(line) : "");
		}
		return lines;
	}

	private renderStyledLine(line: { getCell(x: number, cell?: unknown): unknown }): string {
		const cell = this.xterm.buffer.active.getNullCell();
		let output = "";
		let previousStyle = "default";

		for (let x = 0; x < this._columns; x++) {
			const nextCell = line.getCell(x, cell) as {
				getWidth(): number;
				getChars(): string;
				isAttributeDefault(): boolean;
				isBold(): number;
				isDim(): number;
				isItalic(): number;
				isUnderline(): number;
				isStrikethrough(): number;
				isFgRGB(): boolean;
				isBgRGB(): boolean;
				isFgPalette(): boolean;
				isBgPalette(): boolean;
				isFgDefault(): boolean;
				isBgDefault(): boolean;
				getFgColor(): number;
				getBgColor(): number;
			} | undefined;
			if (!nextCell || nextCell.getWidth() === 0) {
				continue;
			}

			const chars = nextCell.getChars() || " ";
			const nextStyle = this.getCellStyle(nextCell);
			if (nextStyle.signature !== previousStyle) {
				output += nextStyle.signature === "default"
					? "\x1b[0m"
					: `\x1b[0m${nextStyle.sgr}`;
				previousStyle = nextStyle.signature;
			}
			output += chars;
		}

		if (previousStyle !== "default") {
			output += "\x1b[0m";
		}

		return output;
	}

	private getCellStyle(cell: {
		isAttributeDefault(): boolean;
		isBold(): number;
		isDim(): number;
		isItalic(): number;
		isUnderline(): number;
		isStrikethrough(): number;
		isFgRGB(): boolean;
		isBgRGB(): boolean;
		isFgPalette(): boolean;
		isBgPalette(): boolean;
		isFgDefault(): boolean;
		isBgDefault(): boolean;
		getFgColor(): number;
		getBgColor(): number;
	}): { signature: string; sgr: string } {
		if (cell.isAttributeDefault()) {
			return { signature: "default", sgr: "" };
		}

		const codes: string[] = [];
		if (cell.isBold()) codes.push("1");
		if (cell.isDim()) codes.push("2");
		if (cell.isItalic()) codes.push("3");
		if (cell.isUnderline()) codes.push("4");
		if (cell.isStrikethrough()) codes.push("9");

		this.appendColorCode(codes, false, cell);
		this.appendColorCode(codes, true, cell);

		if (codes.length === 0) {
			return { signature: "default", sgr: "" };
		}

		return {
			signature: codes.join(";"),
			sgr: `\x1b[${codes.join(";")}m`,
		};
	}

	private appendColorCode(
		codes: string[],
		background: boolean,
		cell: {
			isFgRGB(): boolean;
			isBgRGB(): boolean;
			isFgPalette(): boolean;
			isBgPalette(): boolean;
			isFgDefault(): boolean;
			isBgDefault(): boolean;
			getFgColor(): number;
			getBgColor(): number;
		},
	): void {
		const useRgb = background ? cell.isBgRGB() : cell.isFgRGB();
		const usePalette = background ? cell.isBgPalette() : cell.isFgPalette();
		const isDefault = background ? cell.isBgDefault() : cell.isFgDefault();
		const color = background ? cell.getBgColor() : cell.getFgColor();
		const base = background ? "48" : "38";

		if (useRgb) {
			const red = (color >> 16) & 0xff;
			const green = (color >> 8) & 0xff;
			const blue = color & 0xff;
			codes.push(`${base};2;${red};${green};${blue}`);
			return;
		}

		if (usePalette) {
			codes.push(`${base};5;${color}`);
			return;
		}

		if (!isDefault) {
			codes.push(background ? "49" : "39");
		}
	}
}
