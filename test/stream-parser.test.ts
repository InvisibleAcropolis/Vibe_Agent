import { strict as assert } from "node:assert";
import test from "node:test";
import { JsonLfStreamParser } from "../src/orchestration/bridge/stream_parser.js";

interface Frame {
	schema: "pi.rpc.telemetry.v1";
	eventId: string;
}

function isFrame(value: unknown): value is Frame {
	if (!value || typeof value !== "object") {
		return false;
	}
	const candidate = value as Partial<Frame>;
	return candidate.schema === "pi.rpc.telemetry.v1" && typeof candidate.eventId === "string";
}

test("JsonLfStreamParser only parses LF-delimited JSON frames", () => {
	const parser = new JsonLfStreamParser<Frame>({ validate: isFrame });
	const partial = parser.pushChunk('{"schema":"pi.rpc.telemetry.v1","eventId":"evt-1"}');
	assert.equal(partial.parsed.length, 0);
	assert.equal(partial.quarantined.length, 0);
	assert.ok(partial.bufferedBytes > 0);

	const complete = parser.pushChunk("\n");
	assert.equal(complete.parsed.length, 1);
	assert.equal(complete.parsed[0]?.eventId, "evt-1");
	assert.equal(complete.quarantined.length, 0);
	assert.equal(complete.bufferedBytes, 0);
});

test("JsonLfStreamParser does not split frames on U+2028/U+2029 content", () => {
	const parser = new JsonLfStreamParser<Record<string, unknown>>();
	const payload = JSON.stringify({
		type: "message",
		text: "first\u2028second\u2029third",
	});

	const first = parser.pushChunk(payload.slice(0, Math.floor(payload.length / 2)));
	assert.equal(first.parsed.length, 0);

	const second = parser.pushChunk(`${payload.slice(Math.floor(payload.length / 2))}\n`);
	assert.equal(second.parsed.length, 1);
	assert.equal(second.quarantined.length, 0);
	assert.equal(second.parsed[0]?.text, "first\u2028second\u2029third");
});

test("JsonLfStreamParser quarantines malformed and validation-failing frames", () => {
	const parser = new JsonLfStreamParser<Frame>({ validate: isFrame });
	const result = parser.pushChunk([
		"{not-json}",
		JSON.stringify({ schema: "pi.rpc.telemetry.v1" }),
		JSON.stringify({ schema: "pi.rpc.telemetry.v1", eventId: "evt-ok" }),
	].join("\n") + "\n");

	assert.equal(result.parsed.length, 1);
	assert.equal(result.parsed[0]?.eventId, "evt-ok");
	assert.equal(result.quarantined.length, 2);
	assert.equal(result.quarantined[0]?.reason, "json_parse_error");
	assert.equal(result.quarantined[1]?.reason, "validation_failed");
});

test("JsonLfStreamParser enforces max buffer bytes to remain backpressure-safe", () => {
	const parser = new JsonLfStreamParser<Record<string, unknown>>({ maxBufferBytes: 24 });
	const overflow = parser.pushChunk("x".repeat(40));
	assert.equal(overflow.parsed.length, 0);
	assert.equal(overflow.quarantined.length, 1);
	assert.equal(overflow.quarantined[0]?.reason, "frame_overflow");
	assert.equal(overflow.bufferedBytes, 0);
});
