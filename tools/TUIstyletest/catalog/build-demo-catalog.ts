import { createPlaceholderRuntime } from "../../../src/style-test-fixtures.js";
import type { StyleTestControlValues, StyleTestDemoDefinition } from "../../../src/style-test-contract.js";
import { buildAutoDemos } from "./auto-demos.js";
import { discoverStyleModules, type DiscoverStyleModulesOptions } from "./discovery.js";
import { loadStyleModule } from "./module-loader.js";

export interface BuildDemoCatalogOptions extends DiscoverStyleModulesOptions {}

function defaultValuesForDemo(demo: StyleTestDemoDefinition): StyleTestControlValues {
	const values: StyleTestControlValues = {};
	for (const control of demo.controls) {
		values[control.id] = control.defaultValue;
	}
	return values;
}

export async function buildDemoCatalog(options: BuildDemoCatalogOptions = {}): Promise<StyleTestDemoDefinition[]> {
	const discovered = discoverStyleModules(options);
	const loaded = await Promise.all(discovered.map((entry) => loadStyleModule(entry)));
	const demos = loaded.flatMap((entry) => buildAutoDemos(entry));
	return demos.sort((a, b) => {
		const orderDelta = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
		if (orderDelta !== 0) return orderDelta;
		const fileDelta = a.sourceFile.localeCompare(b.sourceFile);
		if (fileDelta !== 0) return fileDelta;
		return a.title.localeCompare(b.title);
	});
}

export function getDefaultDemoId(demos: StyleTestDemoDefinition[]): string {
	return demos[0]?.id ?? "";
}

export function getDefaultDemoValues(demo: StyleTestDemoDefinition): StyleTestControlValues {
	return defaultValuesForDemo(demo);
}

export function getDemoById(demos: StyleTestDemoDefinition[], demoId: string): StyleTestDemoDefinition {
	const demo = demos.find((entry) => entry.id === demoId);
	if (!demo) {
		throw new Error(`Unknown style-test demo: ${demoId}`);
	}
	return demo;
}

export function createCatalogErrorDemo(message: string): StyleTestDemoDefinition {
	return {
		id: "catalog#error",
		title: "Catalog Error",
		category: "System",
		sourceFile: "tools/TUIstyletest/catalog",
		kind: "placeholder",
		description: message,
		controls: [],
		createRuntime: () => createPlaceholderRuntime("Catalog Error", message, "tools/TUIstyletest/catalog"),
	};
}
