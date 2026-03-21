import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TUI } from "@mariozechner/pi-tui";
import { getActiveTheme } from "../src/themes/index.js";
import type { StyleTestRuntimeContext } from "../src/style-test-contract.js";
import { buildDemoCatalog, getDefaultDemoValues } from "../tools/TUIstyletest/catalog/build-demo-catalog.js";
import { TUIStyleTestApp } from "../tools/TUIstyletest/app.js";
import { VirtualTerminal } from "./helpers/virtual-terminal.js";

async function flush(terminal: VirtualTerminal): Promise<string[]> {
	await new Promise<void>((resolve) => setImmediate(resolve));
	await new Promise<void>((resolve) => setImmediate(resolve));
	return await terminal.flushAndGetViewport();
}

function createRuntimeContext(): StyleTestRuntimeContext {
	return {
		tui: null as unknown as TUI,
		getAnimationState: () => ({
			hueOffset: 0,
			spinnerFrame: 2,
			breathPhase: 0.5,
			glitchActive: false,
			tickCount: 8,
			focusFlashTicks: 0,
			focusedComponent: "editor",
			wipeTransition: { active: false, frame: 0 },
			separatorOffset: 0,
			typewriter: { target: "", displayed: "", ticksSinceChar: 0 },
		}),
		getTheme: () => getActiveTheme(),
		getThemeName: () => getActiveTheme().name,
		openSelectOverlay: () => undefined,
		openTextPrompt: () => undefined,
		openEditorPrompt: () => undefined,
		showOverlay: () => undefined,
		openShellMenu: () => undefined,
		closeOverlay: () => undefined,
	};
}

async function main(): Promise<void> {
	const tempRoot = mkdtempSync(path.join(path.resolve("test"), "tmp-styletest-"));
	const renderFixturePath = path.join(tempRoot, "render-fixture.ts");
	const metadataFixturePath = path.join(tempRoot, "metadata-fixture.ts");
	const unsupportedFixturePath = path.join(tempRoot, "unsupported-fixture.ts");

	try {
		writeFileSync(
			renderFixturePath,
			[
				"export function renderSpark(animState, theme) {",
				"\treturn `spark-${animState.spinnerFrame}-${theme.name}`;",
				"}",
				"export function createTrail() {",
				"\treturn (animState, theme) => `trail-${animState.tickCount}-${theme.name}`;",
				"}",
			].join("\n"),
		);
		writeFileSync(
			metadataFixturePath,
			[
				"import { defineStyleTestDemos } from '../../src/style-test-contract.js';",
				"export function renderFancy(animState, theme) {",
				"\treturn `fancy-${animState.spinnerFrame}-${theme.name}`;",
				"}",
				"export const styleTestDemos = defineStyleTestDemos({",
				"\texports: {",
				"\t\trenderFancy: {",
				"\t\t\ttitle: 'Inline Fancy',",
				"\t\t\tkind: 'primitive',",
				"\t\t\tdescription: 'Inline metadata override.',",
				"\t\t\tcontrols: [{ id: 'label', label: 'Label', type: 'text', defaultValue: 'inline-value' }],",
				"\t\t\tcreateRuntime: (_moduleNamespace, _exportName, _exportValue, _context, values) => ({",
				"\t\t\t\trender() {",
				"\t\t\t\t\treturn [`meta-${values.label}`];",
				"\t\t\t\t},",
				"\t\t\t}),",
				"\t\t},",
				"\t},",
				"});",
			].join("\n"),
		);
		writeFileSync(
			unsupportedFixturePath,
			[
				"export const fixtureValue = 1;",
			].join("\n"),
		);

		let demos = await buildDemoCatalog({ componentDirs: [tempRoot], rootDir: process.cwd() });
		const renderDemo = demos.find((demo) => demo.id.endsWith("#renderSpark"));
		assert.ok(renderDemo, "discovered render export should produce a demo");
		const renderRuntime = renderDemo!.createRuntime(createRuntimeContext(), getDefaultDemoValues(renderDemo!));
		assert.match(renderRuntime.render(40, 10).join("\n"), /spark-2-/);

		const factoryDemo = demos.find((demo) => demo.id.endsWith("#createTrail"));
		assert.ok(factoryDemo, "discovered factory export should produce a demo");
		const factoryRuntime = factoryDemo!.createRuntime(createRuntimeContext(), getDefaultDemoValues(factoryDemo!));
		assert.match(factoryRuntime.render(40, 10).join("\n"), /trail-8-/);

		const metadataDemo = demos.find((demo) => demo.id.endsWith("#renderFancy"));
		assert.ok(metadataDemo, "inline metadata export should produce a demo");
		assert.strictEqual(metadataDemo!.title, "Inline Fancy");
		assert.strictEqual(metadataDemo!.kind, "primitive");
		const metadataRuntime = metadataDemo!.createRuntime(createRuntimeContext(), getDefaultDemoValues(metadataDemo!));
		assert.match(metadataRuntime.render(40, 10).join("\n"), /meta-inline-value/);

		const placeholderDemo = demos.find((demo) => demo.id.endsWith("unsupported-fixture.ts#module"));
		assert.ok(placeholderDemo, "unsupported file should still produce a placeholder demo");
		assert.match(placeholderDemo!.description, /No auto-demoable exports/);

		await new Promise((resolve) => setTimeout(resolve, 20));
		writeFileSync(
			renderFixturePath,
			[
				"export function renderSpark(animState, theme) {",
				"\treturn `spark-updated-${animState.spinnerFrame}-${theme.name}`;",
				"}",
			].join("\n"),
		);

		demos = await buildDemoCatalog({ componentDirs: [tempRoot], rootDir: process.cwd() });
		const updatedDemo = demos.find((demo) => demo.id.endsWith("#renderSpark"));
		assert.ok(updatedDemo, "updated render export should still be discovered");
		const updatedRuntime = updatedDemo!.createRuntime(createRuntimeContext(), getDefaultDemoValues(updatedDemo!));
		assert.match(updatedRuntime.render(40, 10).join("\n"), /spark-updated-2-/);
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}

	const terminal = new VirtualTerminal(130, 40);
	const app = new TUIStyleTestApp({ terminal });
	await app.start();

	try {
		let viewport = (await flush(terminal)).join("\n");
		assert.match(viewport, /TUIstyletest/);

		app.selectDemo("src/components/style-primitives.ts#renderBoxLine");
		viewport = (await flush(terminal)).join("\n");
		assert.match(viewport, /Style Primitives/);
		assert.match(viewport, /Demo Surface/);

		app.selectDemo("src/components/menu-bar.ts#renderMenuBar");
		app.updateControlValue("labelA", "Chrome");
		viewport = (await flush(terminal)).join("\n");
		assert.match(viewport, /Chrome/);

		app.selectDemo("src/components/sessions-panel.ts#SessionsPanel");
		viewport = (await flush(terminal)).join("\n");
		assert.match(viewport, /SESSIONS/);

		app.selectDemo("src/components/help-overlay.ts#HelpOverlay");
		app.openCurrentOverlay();
		viewport = (await flush(terminal)).join("\n");
		assert.match(viewport, /Vibe Agent - Help/);
		terminal.sendInput("\u001b");
		viewport = (await flush(terminal)).join("\n");
		assert.doesNotMatch(viewport, /Vibe Agent - Help/);

		app.selectDemo("src/components/anim_orbitarc.ts#renderOrbitArc");
		const firstFrame = (await flush(terminal)).join("\n");
		await new Promise((resolve) => setTimeout(resolve, 160));
		const secondFrame = (await flush(terminal)).join("\n");
		assert.notStrictEqual(firstFrame, secondFrame);
	} finally {
		app.stop();
	}
}

void main();
