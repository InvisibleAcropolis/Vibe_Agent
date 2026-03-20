import type { Component } from "@mariozechner/pi-tui";

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export interface TranscriptViewportState {
	scrollOffset: number;
	totalLines: number;
	contentHeight: number;
	followTail: boolean;
}

export class TranscriptViewport implements Component {
	private components: Component[] = [];
	private viewportHeight = 1;
	private scrollOffset = 0;
	private followTail = true;
	private lastWidth = 0;
	private lastContentHeight = 0;
	private lastTotalLines = 0;
	private lastState: TranscriptViewportState = {
		scrollOffset: 0,
		totalLines: 0,
		contentHeight: 0,
		followTail: true,
	};

	setComponents(components: Component[]): void {
		this.components = components;
	}

	setViewportHeight(height: number): void {
		this.viewportHeight = Math.max(1, height);
	}

	getState(): TranscriptViewportState {
		return { ...this.lastState };
	}

	measure(width: number): TranscriptViewportState {
		this.render(width);
		return this.getState();
	}

	scrollBy(lines: number): void {
		const maxOffset = this.maxOffset();
		const nextOffset = clamp(this.scrollOffset + lines, 0, maxOffset);
		this.scrollOffset = nextOffset;
		this.followTail = nextOffset >= maxOffset;
	}

	scrollToTop(): void {
		this.scrollOffset = 0;
		this.followTail = false;
	}

	scrollToBottom(): void {
		this.scrollOffset = this.maxOffset();
		this.followTail = true;
	}

	invalidate(): void {
		for (const component of this.components) {
			component.invalidate?.();
		}
	}

	render(width: number): string[] {
		const contentHeight = Math.max(1, this.viewportHeight);
		const lines = this.flattenLines(width);
		const totalLines = lines.length;
		const maxOffset = Math.max(0, totalLines - contentHeight);

		if (this.followTail) {
			this.scrollOffset = maxOffset;
		} else {
			const layoutChanged = width !== this.lastWidth || contentHeight !== this.lastContentHeight;
			if (layoutChanged) {
				const bottomDistance = Math.max(0, this.lastTotalLines - (this.scrollOffset + this.lastContentHeight));
				this.scrollOffset = clamp(totalLines - contentHeight - bottomDistance, 0, maxOffset);
			} else {
				this.scrollOffset = clamp(this.scrollOffset, 0, maxOffset);
			}
		}

		const visible = lines.slice(this.scrollOffset, this.scrollOffset + contentHeight);
		while (visible.length < contentHeight) {
			visible.push("");
		}

		this.lastWidth = width;
		this.lastContentHeight = contentHeight;
		this.lastTotalLines = totalLines;
		this.lastState = {
			scrollOffset: this.scrollOffset,
			totalLines,
			contentHeight,
			followTail: this.followTail,
		};
		return visible;
	}

	private flattenLines(width: number): string[] {
		const lines: string[] = [];
		for (const component of this.components) {
			lines.push(...component.render(width));
		}
		return lines;
	}

	private maxOffset(): number {
		return Math.max(0, this.lastTotalLines - Math.max(1, this.lastContentHeight));
	}
}
