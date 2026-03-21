import { readdirSync } from "node:fs";
import path from "node:path";

export interface DiscoveredStyleModule {
	filePath: string;
	sourceFile: string;
}

export interface DiscoverStyleModulesOptions {
	componentDirs?: string[];
	rootDir?: string;
}

function isStyleComponentFile(fileName: string): boolean {
	return fileName.endsWith(".ts") && !fileName.endsWith(".d.ts");
}

export function discoverStyleModules(options: DiscoverStyleModulesOptions = {}): DiscoveredStyleModule[] {
	const rootDir = options.rootDir ?? process.cwd();
	const componentDirs = options.componentDirs ?? [path.join(rootDir, "src", "components")];
	const discovered: DiscoveredStyleModule[] = [];

	for (const dir of componentDirs) {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isFile() || !isStyleComponentFile(entry.name)) {
				continue;
			}
			const filePath = path.join(dir, entry.name);
			discovered.push({
				filePath,
				sourceFile: path.relative(rootDir, filePath).replace(/\\/g, "/"),
			});
		}
	}

	return discovered.sort((a, b) => a.sourceFile.localeCompare(b.sourceFile));
}
