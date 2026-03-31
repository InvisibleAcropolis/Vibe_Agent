import type { TranscriptItem } from "./shared-models.js";

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export type TranscriptScrollSource = "keyboard" | "mouse";

export interface TranscriptTimelineState {
	readonly items: readonly TranscriptItem[];
	readonly viewportSize: number;
	readonly scrollOffset: number;
	readonly followMode: boolean;
	readonly isStreaming: boolean;
}

export interface TranscriptTimelineView {
	readonly items: readonly TranscriptItem[];
	readonly start: number;
	readonly end: number;
	readonly total: number;
	readonly followMode: boolean;
	readonly isStreaming: boolean;
}

/**
 * Transcript-first timeline controller for the new shell stack.
 *
 * The API mirrors OpenTUI scrollbox primitives:
 * - viewport size controls the visible region,
 * - offset controls top-most visible row,
 * - follow mode pins the viewport to the tail while streaming.
 */
export class TranscriptTimelineController {
	private state: TranscriptTimelineState = {
		items: [],
		viewportSize: 1,
		scrollOffset: 0,
		followMode: true,
		isStreaming: false,
	};

	getState(): TranscriptTimelineState {
		return { ...this.state, items: [...this.state.items] };
	}

	setViewportSize(viewportSize: number): void {
		const nextViewport = Math.max(1, Math.floor(viewportSize));
		this.state = {
			...this.state,
			viewportSize: nextViewport,
			scrollOffset: clamp(this.state.scrollOffset, 0, this.maxOffset(this.state.items.length, nextViewport)),
		};
		this.syncFollowToTail();
	}

	setStreaming(isStreaming: boolean): void {
		this.state = { ...this.state, isStreaming };
		if (isStreaming && this.state.followMode) {
			this.scrollToBottom();
		}
	}

	replaceItems(items: readonly TranscriptItem[]): void {
		const nextItems = [...items];
		const maxOffset = this.maxOffset(nextItems.length, this.state.viewportSize);
		const nextOffset = this.state.followMode ? maxOffset : clamp(this.state.scrollOffset, 0, maxOffset);
		this.state = {
			...this.state,
			items: nextItems,
			scrollOffset: nextOffset,
		};
		this.syncFollowToTail();
	}

	appendItems(items: readonly TranscriptItem[]): void {
		if (items.length === 0) {
			return;
		}
		const shouldPinToBottom = this.state.isStreaming && this.state.followMode;
		const nextItems = [...this.state.items, ...items];
		const maxOffset = this.maxOffset(nextItems.length, this.state.viewportSize);
		this.state = {
			...this.state,
			items: nextItems,
			scrollOffset: shouldPinToBottom ? maxOffset : clamp(this.state.scrollOffset, 0, maxOffset),
		};
		this.syncFollowToTail();
	}

	scrollBy(lines: number, source: TranscriptScrollSource): void {
		if (lines === 0) {
			return;
		}
		const maxOffset = this.maxOffset(this.state.items.length, this.state.viewportSize);
		const nextOffset = clamp(this.state.scrollOffset + lines, 0, maxOffset);
		const disengageFollow = source === "keyboard" || source === "mouse";
		const scrollingUp = lines < 0;
		this.state = {
			...this.state,
			scrollOffset: nextOffset,
			followMode: disengageFollow && scrollingUp ? false : nextOffset >= maxOffset,
		};
	}

	scrollPageUp(): void {
		this.scrollBy(-this.state.viewportSize, "keyboard");
	}

	scrollPageDown(): void {
		this.scrollBy(this.state.viewportSize, "keyboard");
	}

	scrollToTop(): void {
		this.state = { ...this.state, scrollOffset: 0, followMode: false };
	}

	scrollToBottom(): void {
		const maxOffset = this.maxOffset(this.state.items.length, this.state.viewportSize);
		this.state = { ...this.state, scrollOffset: maxOffset, followMode: true };
	}

	scrollWheel(direction: "up" | "down", stride = 3): void {
		const magnitude = Math.max(1, Math.floor(stride));
		this.scrollBy(direction === "up" ? -magnitude : magnitude, "mouse");
	}

	getVisibleView(): TranscriptTimelineView {
		const start = this.state.scrollOffset;
		const end = Math.min(this.state.items.length, start + this.state.viewportSize);
		return {
			items: this.state.items.slice(start, end),
			start,
			end,
			total: this.state.items.length,
			followMode: this.state.followMode,
			isStreaming: this.state.isStreaming,
		};
	}

	private syncFollowToTail(): void {
		if (this.state.followMode) {
			this.scrollToBottom();
		}
	}

	private maxOffset(total: number, viewport: number): number {
		return Math.max(0, total - Math.max(1, viewport));
	}
}
