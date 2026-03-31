import type { TranscriptItem, TranscriptPart } from "./shared-models.js";

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function isCollapsiblePart(item: TranscriptItem, part: TranscriptPart): boolean {
	return part.kind === "thinking" || (item.kind === "tool-result" && part.kind === "detail");
}

function createPartExpansionKey(itemId: string, partId: string): string {
	return `${itemId}::${partId}`;
}

export type TranscriptScrollSource = "keyboard" | "mouse";

export interface TranscriptTimelineRow {
	readonly id: string;
	readonly itemId: string;
	readonly partId?: string;
	readonly depth: number;
	readonly text: string;
	readonly collapsible?: boolean;
	readonly expanded?: boolean;
}

export interface TranscriptTimelineState {
	readonly items: readonly TranscriptItem[];
	readonly viewportSize: number;
	readonly scrollOffset: number;
	readonly followMode: boolean;
	readonly isStreaming: boolean;
	readonly partExpansion: Readonly<Record<string, boolean>>;
}

export interface TranscriptTimelineView {
	readonly items: readonly TranscriptItem[];
	readonly rows: readonly TranscriptTimelineRow[];
	readonly start: number;
	readonly end: number;
	readonly total: number;
	readonly followMode: boolean;
	readonly isStreaming: boolean;
}

export class TranscriptTimelineController {
	private state: TranscriptTimelineState = {
		items: [],
		viewportSize: 1,
		scrollOffset: 0,
		followMode: true,
		isStreaming: false,
		partExpansion: {},
	};

	getState(): TranscriptTimelineState {
		return { ...this.state, items: [...this.state.items], partExpansion: { ...this.state.partExpansion } };
	}

	setFollowMode(followMode: boolean): void {
		if (followMode) {
			this.scrollToBottom();
			return;
		}
		this.state = {
			...this.state,
			followMode: false,
		};
	}

	setPartExpansion(partExpansion: Readonly<Record<string, boolean>>): void {
		this.state = {
			...this.state,
			partExpansion: { ...partExpansion },
		};
	}

	setViewportSize(viewportSize: number): void {
		const nextViewport = Math.max(1, Math.floor(viewportSize));
		this.state = {
			...this.state,
			viewportSize: nextViewport,
			scrollOffset: clamp(this.state.scrollOffset, 0, this.maxOffset(this.buildRows(this.state.items).length, nextViewport)),
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
		const nextRows = this.buildRows(nextItems);
		const maxOffset = this.maxOffset(nextRows.length, this.state.viewportSize);
		const nextOffset = this.state.followMode ? maxOffset : clamp(this.state.scrollOffset, 0, maxOffset);
		this.state = {
			...this.state,
			items: nextItems,
			scrollOffset: nextOffset,
		};
		this.syncFollowToTail();
	}

	appendItems(items: readonly TranscriptItem[]): void {
		if (items.length === 0) return;
		const shouldPinToBottom = this.state.isStreaming && this.state.followMode;
		const nextItems = [...this.state.items, ...items];
		const maxOffset = this.maxOffset(this.buildRows(nextItems).length, this.state.viewportSize);
		this.state = {
			...this.state,
			items: nextItems,
			scrollOffset: shouldPinToBottom ? maxOffset : clamp(this.state.scrollOffset, 0, maxOffset),
		};
		this.syncFollowToTail();
	}

	togglePartExpansion(itemId: string, partId: string): void {
		const key = createPartExpansionKey(itemId, partId);
		const rowsBefore = this.buildRows(this.state.items);
		const anchor = rowsBefore[this.state.scrollOffset]?.id;
		const current = this.state.partExpansion[key] ?? false;
		const partExpansion = { ...this.state.partExpansion, [key]: !current };
		this.state = { ...this.state, partExpansion };
		this.restoreScrollAnchor(anchor);
	}

	scrollBy(lines: number, source: TranscriptScrollSource): void {
		if (lines === 0) return;
		const maxOffset = this.maxOffset(this.buildRows(this.state.items).length, this.state.viewportSize);
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
		const maxOffset = this.maxOffset(this.buildRows(this.state.items).length, this.state.viewportSize);
		this.state = { ...this.state, scrollOffset: maxOffset, followMode: true };
	}
	scrollWheel(direction: "up" | "down", stride = 3): void {
		const magnitude = Math.max(1, Math.floor(stride));
		this.scrollBy(direction === "up" ? -magnitude : magnitude, "mouse");
	}

	getVisibleView(): TranscriptTimelineView {
		const rows = this.buildRows(this.state.items);
		const start = this.state.scrollOffset;
		const end = Math.min(rows.length, start + this.state.viewportSize);
		const visibleRows = rows.slice(start, end);
		const visibleItemIds = new Set(visibleRows.map((row) => row.itemId));
		return {
			items: this.state.items.filter((item) => visibleItemIds.has(item.id)),
			rows: visibleRows,
			start,
			end,
			total: rows.length,
			followMode: this.state.followMode,
			isStreaming: this.state.isStreaming,
		};
	}

	private restoreScrollAnchor(anchorRowId: string | undefined): void {
		const rows = this.buildRows(this.state.items);
		const maxOffset = this.maxOffset(rows.length, this.state.viewportSize);
		const anchorIndex = anchorRowId ? rows.findIndex((row) => row.id === anchorRowId) : -1;
		const nextOffset = anchorIndex >= 0 ? anchorIndex : this.state.scrollOffset;
		this.state = { ...this.state, scrollOffset: clamp(nextOffset, 0, maxOffset) };
	}

	private buildRows(items: readonly TranscriptItem[]): TranscriptTimelineRow[] {
		const rows: TranscriptTimelineRow[] = [];
		for (const item of items) {
			rows.push({
				id: `${item.id}::summary`,
				itemId: item.id,
				depth: 0,
				text: this.formatSummaryRow(item),
			});
			for (const part of item.parts) {
				if (part.kind === "text" && part.text) {
					const textLines = part.text.split("\n");
					for (let index = 0; index < textLines.length; index += 1) {
						rows.push({
							id: `${item.id}::${part.id}::text-${index}`,
							itemId: item.id,
							partId: part.id,
							depth: 1,
							text: textLines[index] || " ",
						});
					}
					continue;
				}
				if (!isCollapsiblePart(item, part)) continue;
				const key = createPartExpansionKey(item.id, part.id);
				const expanded = item.kind === "tool-result"
					? (this.state.partExpansion[key] ?? this.state.partExpansion["tool-output"] ?? false)
					: (this.state.partExpansion[key] ?? false);
				rows.push({
					id: `${item.id}::${part.id}::toggle`,
					itemId: item.id,
					partId: part.id,
					depth: 1,
					text: `${expanded ? "▾" : "▸"} ${part.title ?? (part.kind === "thinking" ? "Thinking" : "Tool output")}`,
					collapsible: true,
					expanded,
				});
				if (!expanded) continue;
				const detailLines = (part.text ?? "").split("\n");
				for (let index = 0; index < detailLines.length; index += 1) {
					rows.push({
						id: `${item.id}::${part.id}::line-${index}`,
						itemId: item.id,
						partId: part.id,
						depth: 2,
						text: detailLines[index] || " ",
					});
				}
			}
		}
		return rows;
	}

	private formatSummaryRow(item: TranscriptItem): string {
		switch (item.kind) {
			case "user":
				return `You · ${item.summary}`;
			case "assistant-text":
				return `Assistant · ${item.summary}`;
			case "assistant-thinking":
				return `Thinking · ${item.summary}`;
			case "tool-call":
				return `Tool → ${item.summary}`;
			case "tool-result":
				return `Tool ← ${item.summary}`;
			case "artifact":
				return `Artifact · ${item.summary}`;
			case "runtime-status":
				return `Status · ${item.summary}`;
			case "subagent-event":
				return `Subagent · ${item.summary}`;
			case "checkpoint":
				return `Checkpoint · ${item.summary}`;
			case "error":
				return `Error · ${item.summary}`;
		}
	}

	private syncFollowToTail(): void {
		if (this.state.followMode) this.scrollToBottom();
	}

	private maxOffset(total: number, viewport: number): number {
		return Math.max(0, total - Math.max(1, viewport));
	}
}
