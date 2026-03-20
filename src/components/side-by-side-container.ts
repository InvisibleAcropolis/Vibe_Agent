import { visibleWidth, type Component } from "@mariozechner/pi-tui";

/**
 * Renders two components side by side, joined by a separator character.
 * Left component gets (width - rightWidth - separatorWidth) columns.
 * Right component gets rightWidth columns.
 */
export class SideBySideContainer implements Component {
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
		if (!this.right) {
			return this.left.render(width);
		}

		const leftWidth = Math.max(0, width - this.rightWidth - 1); // -1 for separator
		const leftLines = this.left.render(leftWidth);
		const rightLines = this.right.render(this.rightWidth);

		const totalRows = Math.max(leftLines.length, rightLines.length);
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
