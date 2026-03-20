import type { Terminal } from "@mariozechner/pi-tui";

const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
const DISABLE_MOUSE = "\x1b[?1000l\x1b[?1002l\x1b[?1006l";

export class MouseEnabledTerminal implements Terminal {
	private mouseEnabled = false;

	constructor(private readonly inner: Terminal) {}

	start(onInput: (data: string) => void, onResize: () => void): void {
		this.inner.start(onInput, onResize);
		this.enableMouse();
	}

	stop(): void {
		this.disableMouse();
		this.inner.stop();
	}

	async drainInput(maxMs?: number, idleMs?: number): Promise<void> {
		await this.inner.drainInput(maxMs, idleMs);
	}

	write(data: string): void {
		this.inner.write(data);
	}

	get columns(): number {
		return this.inner.columns;
	}

	get rows(): number {
		return this.inner.rows;
	}

	get kittyProtocolActive(): boolean {
		return this.inner.kittyProtocolActive;
	}

	moveBy(lines: number): void {
		this.inner.moveBy(lines);
	}

	hideCursor(): void {
		this.inner.hideCursor();
	}

	showCursor(): void {
		this.inner.showCursor();
	}

	clearLine(): void {
		this.inner.clearLine();
	}

	clearFromCursor(): void {
		this.inner.clearFromCursor();
	}

	clearScreen(): void {
		this.inner.clearScreen();
	}

	setTitle(title: string): void {
		this.inner.setTitle(title);
	}

	private enableMouse(): void {
		if (this.mouseEnabled) {
			return;
		}
		this.inner.write(ENABLE_MOUSE);
		this.mouseEnabled = true;
	}

	private disableMouse(): void {
		if (!this.mouseEnabled) {
			return;
		}
		this.inner.write(DISABLE_MOUSE);
		this.mouseEnabled = false;
	}
}
