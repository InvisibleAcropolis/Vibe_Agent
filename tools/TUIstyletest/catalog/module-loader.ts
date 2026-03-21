import { statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { StyleTestModuleMetadata, StyleTestModuleNamespace } from "../../../src/style-test-contract.js";
import type { DiscoveredStyleModule } from "./discovery.js";

export interface LoadedStyleModule extends DiscoveredStyleModule {
	moduleNamespace: StyleTestModuleNamespace;
	metadata?: StyleTestModuleMetadata;
}

export async function loadStyleModule(moduleInfo: DiscoveredStyleModule): Promise<LoadedStyleModule> {
	const stats = statSync(moduleInfo.filePath);
	const moduleUrl = `${pathToFileURL(moduleInfo.filePath).href}?v=${stats.mtimeMs}-${stats.size}`;
	const moduleNamespace = (await import(moduleUrl)) as StyleTestModuleNamespace;
	const metadata = moduleNamespace.styleTestDemos as StyleTestModuleMetadata | undefined;
	return {
		...moduleInfo,
		moduleNamespace,
		metadata,
	};
}
