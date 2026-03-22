import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export type DemoPresetValues = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class DemoPresetStore {
	private readonly filePath: string;
	private readonly variantsDirPath: string;

	constructor(private readonly rootDir: string, sourceFile: string, exportName: string) {
		this.filePath = path.join(rootDir, "tools", "TUIstyletest", "presets", sourceFile, `${exportName}.json`);
		this.variantsDirPath = path.join(rootDir, "tools", "TUIstyletest", "presets", sourceFile, `${exportName}.variants`);
	}

	get path(): string {
		return this.filePath;
	}

	private variantPath(presetId: string): string {
		if (presetId === "default") {
			return this.filePath;
		}
		return path.join(this.variantsDirPath, `${sanitizeVariantId(presetId)}.json`);
	}

	listVariants(): Array<{ id: string; label: string }> {
		const variants: Array<{ id: string; label: string }> = [{ id: "default", label: "Default" }];
		if (!existsSync(this.variantsDirPath)) {
			return variants;
		}
		for (const entry of readdirSync(this.variantsDirPath, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".json")) {
				continue;
			}
			const id = entry.name.slice(0, -".json".length);
			variants.push({ id, label: humanizeVariantId(id) });
		}
		return variants.sort((a, b) => {
			if (a.id === "default") return -1;
			if (b.id === "default") return 1;
			return a.label.localeCompare(b.label);
		});
	}

	load(presetId = "default"): DemoPresetValues | undefined {
		const targetPath = this.variantPath(presetId);
		if (!existsSync(targetPath)) {
			return undefined;
		}
		try {
			const raw = readFileSync(targetPath, "utf-8");
			const parsed = JSON.parse(raw) as unknown;
			return isPlainObject(parsed) ? parsed : undefined;
		} catch {
			return undefined;
		}
	}

	save(values: DemoPresetValues, presetId = "default"): string {
		const targetPath = this.variantPath(presetId);
		const dir = path.dirname(targetPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		const tempPath = `${targetPath}.tmp`;
		writeFileSync(tempPath, `${JSON.stringify(values, null, 2)}\n`, "utf-8");
		renameSync(tempPath, targetPath);
		return presetId === "default" ? "default" : sanitizeVariantId(presetId);
	}
}

function sanitizeVariantId(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized.length > 0 ? normalized : "variant";
}

function humanizeVariantId(value: string): string {
	return value
		.replace(/[-_]+/g, " ")
		.replace(/\b\w/g, (char) => char.toUpperCase());
}
