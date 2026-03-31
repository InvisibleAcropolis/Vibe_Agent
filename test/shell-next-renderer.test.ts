import { strict as assert } from "node:assert";
import test from "node:test";
import { createShellNextRenderer } from "../src/shell-next/renderer.js";
import { createInitialShellNextState } from "../src/shell-next/state.js";
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

test("renders compact meta row with runtime/session/host/model indicators", () => {
	const renderer = createShellNextRenderer();
	const state = createInitialShellNextState();
	state.meta.sessionLabel = "s-42";
	state.meta.runtimeLabel = "runtime-a";
	state.meta.psmuxHostLabel = "host-a";
	state.meta.providerId = "openai";
	state.meta.modelId = "gpt-5";

	const model = renderer.render(state);
	assert.equal(model.header, "S:s-42 · R:runtime-a · H:host-a · M:openai/gpt-5");
});

test("renders compact streaming/follow/position indicators and slim key hints", () => {
	const renderer = createShellNextRenderer();
	const state = createInitialShellNextState();
	state.meta.streamPhase = "streaming";

	const timeline = new TranscriptTimelineController();
	timeline.setViewportSize(2);
	timeline.setStreaming(true);
	timeline.replaceItems([item(1), item(2), item(3)]);
	timeline.scrollPageUp();

	const model = renderer.render(state, timeline.getVisibleView());
	assert.match(model.status, /●stream/);
	assert.match(model.status, /↥pos/);
	assert.match(model.status, /1-2\/3/);
	assert.match(model.status, /keys:Pg↑ Pg↓ End/);
});
