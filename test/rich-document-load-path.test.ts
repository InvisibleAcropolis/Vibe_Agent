import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadRichDocumentModel } from "../src/shell-next/rich-document-load-path.js";

const trustedFixturePath = path.resolve("test", "fixtures", "trusted-rich-document.json");

interface TrustedRichDocumentFixture {
	readonly id: string;
	readonly uri: string;
	readonly mediaType: string;
	readonly trust: "trusted" | "untrusted";
	readonly title: string;
	readonly content: string;
	readonly expectedKinds: readonly string[];
	readonly blockedHint: string;
}

function loadTrustedFixture(): TrustedRichDocumentFixture {
	return JSON.parse(readFileSync(trustedFixturePath, "utf8")) as TrustedRichDocumentFixture;
}

test("routes trusted markdown sources through MDX-capable pipeline", () => {
	const model = loadRichDocumentModel({
		id: "trusted-doc",
		uri: "workspace://docs/runbook.mdx",
		mediaType: "text/markdown",
		trust: "trusted",
		title: "Runbook",
		content: "# Heading",
	});

	assert.equal(model.source.trustMetadata.trust, "trusted");
	assert.equal(model.source.sourcePolicy.pipeline, "mdx-capable");
	assert.equal(model.source.sourcePolicy.renderMode, "mdx");
	assert.equal(model.source.sourcePolicy.allowShellComponents, true);
});

test("routes untrusted markdown sources through safe markdown policy and blocks shell components", () => {
	const model = loadRichDocumentModel({
		id: "untrusted-doc",
		uri: "https://example.test/user-content.md",
		mediaType: "text/markdown",
		trust: "untrusted",
		content: "<ShellCommand command=\"rm -rf /\" />",
	});

	assert.equal(model.source.trustMetadata.trust, "untrusted");
	assert.equal(model.source.sourcePolicy.pipeline, "safe-markdown");
	assert.equal(model.source.sourcePolicy.renderMode, "markdown");
	assert.equal(model.source.sourcePolicy.allowShellComponents, false);
	assert.deepEqual(model.sections[0]?.components, []);
});

test("routes untrusted non-markdown sources through plain-text policy", () => {
	const model = loadRichDocumentModel({
		id: "plain-doc",
		uri: "https://example.test/data.txt",
		mediaType: "text/plain",
		content: "echo hi",
	});

	assert.equal(model.source.trustMetadata.trust, "untrusted");
	assert.equal(model.source.sourcePolicy.pipeline, "plain-text");
	assert.equal(model.source.sourcePolicy.renderMode, "plain-text");
	assert.equal(model.source.sourcePolicy.allowShellComponents, false);
	assert.deepEqual(model.sections[0]?.components, []);
});

test("trusted fixtures only emit allowlisted components", () => {
	const fixture = loadTrustedFixture();
	const model = loadRichDocumentModel(fixture);
	const kinds = model.sections[0]?.components?.map((component) => component.kind) ?? [];

	assert.deepEqual(kinds, fixture.expectedKinds);
	assert.ok(!kinds.includes(fixture.blockedHint));
	assert.ok(!JSON.stringify(model.sections[0]?.components).includes(fixture.blockedHint));
});
