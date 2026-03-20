import { visibleWidth, type Component } from "@mariozechner/pi-tui";

/**
 * Renders two components side by side, joined by a separator character.
 * Left component gets (width - rightWidth - separatorWidth) columns.
 * Right component gets rightWidth columns.
 */
export class SideBySideContainer implements Component {
	/**
	 * When non-null, render() fills all rows with this character instead of the actual components.
	 * Used for the block-fill wipe transition (░ ▒ ▓ █) during session switches.
	 */
	wipeChar: string | null = null;
	maxHeight: number | null = null;

	constructor(
		public left: Component,
		public right: Component | null,
		public rightWidth: number,
		private readonly separator: string = "│",
	) {}

	invalidate(): void {
		this.left.invalidate();
		this.right?.invalidate();
	}

	render(width: number): string[] {
		// B: Block-fill wipe transition — fill the area with the wipe character
		if (this.wipeChar !== null) {
			const rows = this.maxHeight ?? this.left.render(width).length ?? 1;
			return Array.from({ length: rows }, () => this.wipeChar!.repeat(width));
		}

		if (!this.right) {
			const lines = this.left.render(width);
			if (this.maxHeight == null) {
				return lines;
			}
			const clipped = lines.slice(0, this.maxHeight);
			while (clipped.length < this.maxHeight) {
				clipped.push(" ".repeat(width));
			}
			return clipped;
		}

		const leftWidth = Math.max(0, width - this.rightWidth - 1); // -1 for separator
		const leftLines = this.left.render(leftWidth);
		const rightLines = this.right.render(this.rightWidth);

		const totalRows = this.maxHeight ?? Math.max(leftLines.length, rightLines.length);
		const result: string[] = [];

		for (let i = 0; i < totalRows; i++) {
			const l = leftLines[i] ?? " ".repeat(leftWidth);
			const r = rightLines[i] ?? " ".repeat(this.rightWidth);
			// Ensure left is exactly leftWidth visible chars
			const lPadded = l + " ".repeat(Math.max(0, leftWidth - visibleWidth(l)));
			result.push(lPadded + this.separator + r);
		}

		return result;
	}
}
