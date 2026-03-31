import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadRichDocumentModel } from "../src/shell-next/rich-document-load-path.js";
import { mapRichDocumentToOpenTui } from "../src/shell-next/rich-document-opentui-mapper.js";

interface TrustedRichDocumentFixture {
	readonly id: string;
	readonly uri: string;
	readonly mediaType: string;
	readonly trust: "trusted" | "untrusted";
	readonly title: string;
	readonly content: string;
	readonly expectedKinds: readonly string[];
}

function loadFixture(): TrustedRichDocumentFixture {
	const fixturePath = path.resolve("test", "fixtures", "trusted-rich-document.json");
	return JSON.parse(readFileSync(fixturePath, "utf8")) as TrustedRichDocumentFixture;
}

test("maps trusted rich-document render models into OpenTUI component models", () => {
	const fixture = loadFixture();
	const renderModel = loadRichDocumentModel(fixture);
	const openTuiModel = mapRichDocumentToOpenTui(renderModel);
	const types = openTuiModel.sections[0]?.components.map((component) => component.type) ?? [];

	assert.equal(openTuiModel.id, fixture.id);
	assert.equal(openTuiModel.sourceUri, fixture.uri);
	assert.deepEqual(types, ["Heading", "MetadataRow", "Callout", "Link", "TimelineCard", "Collapsible", "CodeBlock"]);
	assert.equal(openTuiModel.sections[0]?.components.length, fixture.expectedKinds.length);
});
