import assert from "node:assert";
import { describe, it } from "node:test";
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
});
