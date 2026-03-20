import type { Terminal } from "@mariozechner/pi-tui";

const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
const DISABLE_MOUSE = "\x1b[?1000l\x1b[?1002l\x1b[?1006l";

export class MouseEnabledTerminal implements Terminal {
	private readonly resizeHandlers = new Set<() => void>();

	constructor(private readonly inner: Terminal) {}

	get rows(): number {
		return this.inner.rows;
	}

	get columns(): number {
		return this.inner.columns;
	}

	get kittyProtocolActive(): boolean {
		return this.inner.kittyProtocolActive;
	}

	setResizeHandler(handler: () => void): () => void {
		this.resizeHandlers.add(handler);
		return () => this.resizeHandlers.delete(handler);
	}

	start(onInput: (data: string) => void, onResize: () => void): void {
		this.inner.start(onInput, () => {
			onResize();
			for (const handler of this.resizeHandlers) {
				handler();
			}
		});
		this.inner.write(ENABLE_MOUSE);
	}

	stop(): void {
		this.inner.write(DISABLE_MOUSE);
		this.inner.stop();
	}

	async drainInput(maxMs?: number, idleMs?: number): Promise<void> {
		return this.inner.drainInput(maxMs, idleMs);
	}

	write(data: string): void {
		this.inner.write(data);
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
}
