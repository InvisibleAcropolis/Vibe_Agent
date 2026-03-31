import { strict as assert } from "node:assert";
import test from "node:test";
import { loadRichDocumentModel } from "../src/shell-next/rich-document-load-path.js";

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
});
