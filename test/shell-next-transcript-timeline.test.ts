import { strict as assert } from "node:assert";
import test from "node:test";
import { TranscriptTimelineController } from "../src/shell-next/transcript-timeline.js";
import type { TranscriptItem } from "../src/shell-next/shared-models.js";

function item(id: number): TranscriptItem {
	return {
		id: `item-${id}`,
		kind: "assistant-text",
		timestamp: new Date(Date.UTC(2026, 2, 31, 0, 0, id)).toISOString(),
		summary: `item ${id}`,
		parts: [],
	};
}

test("sticks to bottom while streaming in follow mode", () => {
	const timeline = new TranscriptTimelineController();
	timeline.setViewportSize(3);
	timeline.setStreaming(true);
	timeline.replaceItems([item(1), item(2), item(3), item(4)]);

	const before = timeline.getVisibleView();
	assert.equal(before.start, 1);
	assert.deepEqual(before.items.map((entry) => entry.id), ["item-2", "item-3", "item-4"]);

	timeline.appendItems([item(5)]);
	const after = timeline.getVisibleView();
	assert.equal(after.start, 2);
	assert.equal(after.followMode, true);
	assert.deepEqual(after.items.map((entry) => entry.id), ["item-3", "item-4", "item-5"]);
});

test("upward keyboard scroll disengages follow mode and holds position during stream", () => {
	const timeline = new TranscriptTimelineController();
	timeline.setViewportSize(3);
	timeline.setStreaming(true);
	timeline.replaceItems([item(1), item(2), item(3), item(4)]);

	timeline.scrollPageUp();
	let view = timeline.getVisibleView();
	assert.equal(view.followMode, false);
	assert.equal(view.start, 0);

	timeline.appendItems([item(5), item(6)]);
	view = timeline.getVisibleView();
	assert.equal(view.start, 0, "scroll position should remain pinned when follow is disengaged");
	assert.deepEqual(view.items.map((entry) => entry.id), ["item-1", "item-2", "item-3"]);
});

test("mouse wheel supports long history and can re-engage follow at tail", () => {
	const timeline = new TranscriptTimelineController();
	timeline.setViewportSize(5);
	timeline.replaceItems(Array.from({ length: 25 }, (_, index) => item(index + 1)));
	timeline.scrollToBottom();

	timeline.scrollWheel("up", 4);
	let view = timeline.getVisibleView();
	assert.equal(view.followMode, false);
	assert.equal(view.start, 16);

	timeline.scrollWheel("down", 100);
	view = timeline.getVisibleView();
	assert.equal(view.followMode, true);
	assert.equal(view.end, 25);
	assert.deepEqual(view.items.map((entry) => entry.id), ["item-21", "item-22", "item-23", "item-24", "item-25"]);
});
