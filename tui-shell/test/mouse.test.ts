import assert from "node:assert";
import { describe, it } from "node:test";
import { FloatWindow, type FloatWindowHostedElement } from "../../src/components/float_window.js";
import type { MouseEvent, Rect } from "../../src/mouse.js";
import { parseMouseEvent } from "../src/mouse.js";

describe("mouse parser", () => {
	it("parses left click down events", () => {
		const event = parseMouseEvent("\x1b[<0;12;7M");
		assert.ok(event);
		assert.deepStrictEqual(
			{
				action: event.action,
				button: event.button,
				col: event.col,
				row: event.row,
			},
			{ action: "down", button: "left", col: 12, row: 7 },
		);
	});

	it("parses scroll events", () => {
		const up = parseMouseEvent("\x1b[<64;40;8M");
		const down = parseMouseEvent("\x1b[<65;40;9M");
		assert.equal(up?.action, "scroll");
		assert.equal(up?.button, "wheelUp");
		assert.equal(down?.button, "wheelDown");
	});

	it("parses drag events with modifier flags", () => {
		const event = parseMouseEvent("\x1b[<36;18;11M");
		assert.deepStrictEqual(
			event && {
				action: event.action,
				button: event.button,
				col: event.col,
				row: event.row,
				shift: event.shift,
				alt: event.alt,
				ctrl: event.ctrl,
			},
			{ action: "drag", button: "left", col: 18, row: 11, shift: true, alt: false, ctrl: false },
		);
	});
});

describe("floating window mouse interactions", () => {
	function mouseEvent(overrides: Partial<MouseEvent>): MouseEvent {
		return {
			raw: "",
			action: "down",
			button: "left",
			row: 1,
			col: 1,
			shift: false,
			alt: false,
			ctrl: false,
			...overrides,
		};
	}

	function createHostedContent(): {
		mouseEvents: Array<{ rect: Rect; action: MouseEvent["action"] }>;
		viewports: Array<{ width: number; height: number }>;
		content: FloatWindowHostedElement;
	} {
		const mouseEvents: Array<{ rect: Rect; action: MouseEvent["action"] }> = [];
		const viewports: Array<{ width: number; height: number }> = [];
		const content: FloatWindowHostedElement = {
			invalidate() {},
			render(width: number) {
				return [`content width=${width}`, "child line"];
			},
			handleMouse(event, rect) {
				mouseEvents.push({ rect: { ...rect }, action: event.action });
				return true;
			},
			getHostedSizeRequirements() {
				return { minWidth: 14, minHeight: 3, preferredWidth: 20, preferredHeight: 6, maxWidth: 28, maxHeight: 10 };
			},
			setHostedViewportSize(viewport) {
				viewports.push({ ...viewport });
			},
		};
		return { mouseEvents, viewports, content };
	}

	it("routes title-bar drag and content-vs-frame mouse events deterministically", () => {
		const hosted = createHostedContent();
		const window = new FloatWindow({
			title: "Mouse Window",
			content: hosted.content,
			initialState: { row: 3, col: 5, width: 24, height: 9 },
		});
		window.setViewportSize({ width: 80, height: 30 });
		const rect = { row: window.model.row, col: window.model.col, width: window.model.width, height: window.model.height };

		assert.equal(window.handleMouse(mouseEvent({ row: rect.row, col: rect.col + 6 }), rect), true);
		assert.ok(window.model.dragState);
		window.handleMouse(mouseEvent({ action: "drag", row: rect.row + 4, col: rect.col + 10 }), rect);
		assert.deepStrictEqual({ row: window.model.row, col: window.model.col }, { row: 7, col: 9 });
		window.handleMouse(mouseEvent({ action: "up", row: rect.row + 4, col: rect.col + 10 }), rect);

		const liveRect = { row: window.model.row, col: window.model.col, width: window.model.width, height: window.model.height };
		const expectedContentRect = { row: liveRect.row + 1, col: liveRect.col + 1, width: liveRect.width - 2, height: liveRect.height - 4 };
		window.handleMouse(mouseEvent({ row: expectedContentRect.row + 1, col: expectedContentRect.col + 2 }), liveRect);
		assert.equal(hosted.mouseEvents.length, 1);
		assert.deepStrictEqual(hosted.mouseEvents[0], { rect: expectedContentRect, action: "down" });

		hosted.mouseEvents.length = 0;
		window.handleMouse(mouseEvent({ row: liveRect.row + liveRect.height - 2, col: liveRect.col + 3 }), liveRect);
		assert.equal(hosted.mouseEvents.length, 0);
	});

	it("clamps edge and corner resize operations to min/max bounds derived from hosted content", () => {
		const hosted = createHostedContent();
		const window = new FloatWindow({
			title: "Resizable",
			content: hosted.content,
			initialState: { row: 4, col: 10, width: 24, height: 9 },
			minWidth: 18,
			minHeight: 7,
			maxWidth: 26,
			maxHeight: 11,
		});
		window.setViewportSize({ width: 40, height: 20 });
		const start = { row: window.model.row, col: window.model.col, width: window.model.width, height: window.model.height };

		window.handleMouse(mouseEvent({ row: start.row + start.height - 1, col: start.col + start.width - 1 }), start);
		window.handleMouse(mouseEvent({ action: "drag", row: start.row + start.height + 20, col: start.col + start.width + 20 }), start);
		assert.deepStrictEqual({ width: window.model.width, height: window.model.height }, { width: 26, height: 11 });
		window.handleMouse(mouseEvent({ action: "up", row: start.row + start.height + 20, col: start.col + start.width + 20 }), start);

		const expanded = { row: window.model.row, col: window.model.col, width: window.model.width, height: window.model.height };
		window.handleMouse(mouseEvent({ row: expanded.row, col: expanded.col }), expanded);
		window.handleMouse(mouseEvent({ action: "drag", row: expanded.row + 10, col: expanded.col + 20 }), expanded);
		assert.deepStrictEqual(
			{ row: window.model.row, col: window.model.col, width: window.model.width, height: window.model.height },
			{ row: 8, col: 18, width: 18, height: 7 },
		);
		assert.ok(hosted.viewports.some((viewport) => viewport.width === 16 && viewport.height === 3));
	});

	it("re-clamps geometry on terminal resize without losing hosted child viewport state", () => {
		const hosted = createHostedContent();
		const window = new FloatWindow({
			title: "Resize Clamp",
			content: hosted.content,
			initialState: { row: 12, col: 30, width: 26, height: 10 },
		});
		window.setViewportSize({ width: 90, height: 35 });
		const before = hosted.viewports.at(-1);
		window.setViewportSize({ width: 36, height: 14 });
		assert.deepStrictEqual(
			{ row: window.model.row, col: window.model.col, width: window.model.width, height: window.model.height },
			{ row: 5, col: 11, width: 26, height: 10 },
		);
		assert.deepStrictEqual(before, { width: 24, height: 6 });
		assert.deepStrictEqual(hosted.viewports.at(-1), { width: 24, height: 6 });
	});
});
