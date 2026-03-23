import { readFileSync } from "node:fs";
import ts from "typescript";
import type { StyleTestControlValues, StyleTestModuleNamespace, StyleTestRuntimeContext } from "../../../../src/style-test-contract.js";
import { DemoPresetStore } from "../demo-preset-store.js";
import type { LoadedStyleModule } from "../module-loader.js";
import { ADAPTERS } from "./adapters.js";
import { collectAnimationExports, collectExportedInterfaces } from "./ast.js";
import { buildControls } from "./controls.js";
import { createField, humanizeIdentifier } from "./field-inference.js";
import { buildStoredValues, buildUiValues, loadStoredValues, saveStoredValues } from "./presets.js";
import { buildStandardRuntime } from "./runtime.js";
import type { InferredAnimationMetadataResult } from "./types.js";

function isAnimationSource(sourceFile: string): boolean {
	return sourceFile.includes("/anim_");
}

export function inferAnimationStyleMetadata(loaded: LoadedStyleModule, rootDir: string): InferredAnimationMetadataResult | undefined {
	if (!isAnimationSource(loaded.sourceFile)) {
		return undefined;
	}

	const sourceText = readFileSync(loaded.filePath, "utf-8");
	const sourceFile = ts.createSourceFile(loaded.filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const interfaces = collectExportedInterfaces(sourceFile, createField);
	const exports = collectAnimationExports(loaded.sourceFile, sourceFile, interfaces, ADAPTERS);
	if (exports.length === 0) {
		return { exports: {}, onlyUseInferred: true };
	}

	const metadataByExport: InferredAnimationMetadataResult["exports"] = {};
	for (const inferred of exports) {
		const demoKey = `${loaded.sourceFile}#${inferred.exportName}`;
		const adapter = ADAPTERS[demoKey];
		const fields = inferred.fields
			.filter((field) => !(adapter?.omitOptionFields ?? []).includes(field.id))
			.map((field) => (adapter?.customizeField ? adapter.customizeField(field) : field));
		const extraControls = adapter?.extraControls ?? [];
		const presetStore = new DemoPresetStore(rootDir, loaded.sourceFile, inferred.exportName);
		const initialValues = buildUiValues(fields, extraControls, loadStoredValues(adapter, presetStore, "default"));
		metadataByExport[inferred.exportName] = {
			title: humanizeIdentifier(inferred.exportName),
			category: "Animations",
			kind: "animation",
			description: `Live preview for ${humanizeIdentifier(inferred.exportName)} using ${inferred.optionsInterfaceName}.`,
			controls: buildControls(fields, extraControls, initialValues),
			initialValues,
			listPresetVariants: () => presetStore.listVariants(),
			loadValues: (presetId = "default") => buildUiValues(fields, extraControls, loadStoredValues(adapter, presetStore, presetId)),
			saveValues: (values: StyleTestControlValues, presetId = "default") => {
				const storedValues = buildStoredValues(fields, extraControls, values);
				return saveStoredValues(adapter, presetStore, { ...storedValues, ...(adapter?.fixedOptions ?? {}) }, presetId);
			},
			createRuntime: (_moduleNamespace: StyleTestModuleNamespace, _exportName: string, exportValue: unknown, context: StyleTestRuntimeContext, values: StyleTestControlValues) => {
				const storedValues = buildStoredValues(fields, extraControls, values);
				const optionEntries = fields.map((field) => [field.id, storedValues[field.id]]);
				const optionsObject = optionEntries.length > 0 ? Object.fromEntries(optionEntries) : undefined;
				const options = adapter?.fixedOptions ? { ...(optionsObject ?? {}), ...adapter.fixedOptions } : optionsObject;
				if (adapter?.createRuntime) {
					return adapter.createRuntime(exportValue, context, values, options);
				}
				return buildStandardRuntime(exportValue, inferred.pattern, context, options);
			},
		};
	}

	return { exports: metadataByExport, onlyUseInferred: true };
}
