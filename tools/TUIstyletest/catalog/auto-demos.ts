import path from "node:path";
import { createComponentRuntime, createOverlayPreviewRuntime, createPlaceholderRuntime } from "../../../src/style-test-fixtures.js";
import type {
	StyleTestControlValues,
	StyleTestDemoDefinition,
	StyleTestEntryMetadata,
	StyleTestKind,
	StyleTestModuleNamespace,
	StyleTestRuntime,
	StyleTestRuntimeContext,
} from "../../../src/style-test-contract.js";
import type { LoadedStyleModule } from "./module-loader.js";

function humanizeIdentifier(identifier: string): string {
	return identifier
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/^render\s+/i, "")
		.replace(/^create\s+/i, "")
		.replace(/\b\w/g, (char) => char.toUpperCase());
}

function inferCategory(sourceFile: string, kind: StyleTestKind): string {
	if (kind === "animation" || sourceFile.includes("/anim_") || sourceFile.endsWith("/animation-primitives.ts")) {
		return "Animations";
	}
	if (kind === "overlay" || sourceFile.includes("overlay")) {
		return "Overlays";
	}
	if (sourceFile.endsWith("/style-primitives.ts")) {
		return "Primitives";
	}
	return "Components";
}

function getParameterNames(fn: Function): string[] {
	const source = fn.toString().replace(/\n/g, " ");
	const match =
		source.match(/^[\s\w]*function[^(]*\(([^)]*)\)/) ??
		source.match(/^\(([^)]*)\)\s*=>/) ??
		source.match(/^([^=()]+)\s*=>/);
	if (!match) {
		return [];
	}
	return match[1]
		.split(",")
		.map((param) => param.trim().replace(/\/\*.*?\*\//g, ""))
		.filter(Boolean)
		.map((param) => param.replace(/\?.*$/, "").replace(/:.*$/, "").trim());
}

function valuesToOptions(values: StyleTestControlValues): Record<string, unknown> | undefined {
	const entries = Object.entries(values);
	if (entries.length === 0) {
		return undefined;
	}
	return Object.fromEntries(entries);
}

function canAutoRenderExport(exportValue: unknown): boolean {
	if (typeof exportValue !== "function") {
		return false;
	}
	const params = getParameterNames(exportValue);
	return (
		(params[0]?.toLowerCase().includes("anim") && params[1]?.toLowerCase().includes("theme")) ||
		(params[0]?.toLowerCase().includes("theme") && params[1]?.toLowerCase().includes("anim"))
	);
}

function canAutoInvokeFactory(exportValue: unknown): boolean {
	if (typeof exportValue !== "function") {
		return false;
	}
	try {
		return typeof (exportValue as Function)() === "function";
	} catch {
		return false;
	}
}

function isClassLike(value: unknown): value is new (...args: any[]) => object {
	return typeof value === "function" && /^\s*class\s/.test(Function.prototype.toString.call(value));
}

function buildRendererRuntime(
	renderer: Function,
	values: StyleTestControlValues,
	context: StyleTestRuntimeContext,
): StyleTestRuntime | undefined {
	const params = getParameterNames(renderer);
	const options = valuesToOptions(values);
	if (params[0]?.toLowerCase().includes("anim") && params[1]?.toLowerCase().includes("theme")) {
		return {
			render() {
				const rendered = renderer(context.getAnimationState(), context.getTheme(), options);
				return typeof rendered === "string" ? rendered.split("\n") : ["Renderer returned a non-string value."];
			},
		};
	}
	if (params[0]?.toLowerCase().includes("theme") && params[1]?.toLowerCase().includes("anim")) {
		return {
			render() {
				const rendered = renderer(context.getTheme(), context.getAnimationState(), options);
				return typeof rendered === "string" ? rendered.split("\n") : ["Renderer returned a non-string value."];
			},
		};
	}
	return undefined;
}

function buildFactoryRuntime(
	factory: Function,
	values: StyleTestControlValues,
	context: StyleTestRuntimeContext,
): StyleTestRuntime | undefined {
	const options = valuesToOptions(values);
	const created = factory(options);
	if (typeof created !== "function") {
		return undefined;
	}
	return {
		render() {
			const rendered = created(context.getAnimationState(), context.getTheme());
			return typeof rendered === "string" ? rendered.split("\n") : ["Factory renderer returned a non-string value."];
		},
	};
}

function buildClassRuntime(
	classConstructor: new (...args: any[]) => object,
	sourceFile: string,
	exportName: string,
	context: StyleTestRuntimeContext,
): StyleTestRuntime {
	if (classConstructor.length === 0) {
		return createComponentRuntime(new classConstructor() as any);
	}
	if (exportName.endsWith("Overlay") && classConstructor.length === 1) {
		const overlayId = `${sourceFile}#${exportName}`;
		return createOverlayPreviewRuntime(
			`Auto-generated overlay launcher for ${exportName}.`,
			sourceFile,
			() => context.showOverlay(overlayId, new classConstructor(() => context.closeOverlay(overlayId)) as any, {
				width: "80%",
				maxHeight: "70%",
				anchor: "center",
				margin: 1,
			}),
		);
	}
	return createPlaceholderRuntime(
		humanizeIdentifier(exportName),
		`No inline style-test metadata exists for ${exportName}, and its constructor requires ${classConstructor.length} argument(s).`,
		sourceFile,
	);
}

function isAutoRenderableExport(exportName: string, exportValue: unknown): boolean {
	return typeof exportValue === "function" && /^render[A-Z]/.test(exportName);
}

function isAutoFactoryExport(exportName: string, exportValue: unknown): boolean {
	return typeof exportValue === "function" && /^create[A-Z]/.test(exportName);
}

function describeAutoExport(exportName: string, kind: StyleTestKind): string {
	if (kind === "animation") {
		return `Auto-generated demo for ${humanizeIdentifier(exportName)} using the current source export.`;
	}
	if (kind === "overlay") {
		return `Auto-generated overlay demo for ${humanizeIdentifier(exportName)} using the current source export.`;
	}
	return `Auto-generated demo for ${humanizeIdentifier(exportName)} using the current source export.`;
}

function defaultKindForExport(exportName: string): StyleTestKind {
	if (exportName.endsWith("Overlay")) {
		return "overlay";
	}
	if (/^(render|create)[A-Z]/.test(exportName)) {
		return "animation";
	}
	return "component";
}

export function buildAutoDemos(loaded: LoadedStyleModule): StyleTestDemoDefinition[] {
	const namespace = loaded.moduleNamespace;
	const metadataByExport = loaded.metadata?.exports ?? {};
	const autoExportsEnabled = loaded.metadata?.autoExports ?? true;
	const demos: StyleTestDemoDefinition[] = [];
	const discoveredExports = autoExportsEnabled
		? Object.entries(namespace)
				.filter(([name, value]) =>
					name !== "styleTestDemos" &&
					(
						(isAutoRenderableExport(name, value) && canAutoRenderExport(value)) ||
						(isAutoFactoryExport(name, value) && canAutoInvokeFactory(value)) ||
						isClassLike(value)
					),
				)
				.map(([name]) => name)
		: [];
	const exportNames = new Set<string>([...discoveredExports, ...Object.keys(metadataByExport)]);

	for (const exportName of Array.from(exportNames).sort()) {
		const exportValue = namespace[exportName];
		const metadata = metadataByExport[exportName];
		if (metadata?.hidden) {
			continue;
		}
		const kind = metadata?.kind ?? defaultKindForExport(exportName);
		const demoId = `${loaded.sourceFile}#${exportName}`;
		const title = metadata?.title ?? humanizeIdentifier(exportName);
		const category = metadata?.category ?? inferCategory(loaded.sourceFile, kind);
		const description = metadata?.description ?? describeAutoExport(exportName, kind);
		const controls = metadata?.controls ?? [];
		const presets = metadata?.presets;

		const createRuntime = (context: StyleTestRuntimeContext, values: StyleTestControlValues): StyleTestRuntime => {
			if (metadata?.createRuntime) {
				return metadata.createRuntime(namespace, exportName, exportValue, context, values);
			}
			if (isAutoRenderableExport(exportName, exportValue)) {
				const runtime = buildRendererRuntime(exportValue as Function, values, context);
				if (runtime) {
					return runtime;
				}
			}
			if (isAutoFactoryExport(exportName, exportValue)) {
				try {
					const runtime = buildFactoryRuntime(exportValue as Function, values, context);
					if (runtime) {
						return runtime;
					}
				} catch {
					return createPlaceholderRuntime(
						title,
						`The factory export ${exportName} could not be auto-invoked without explicit style-test metadata.`,
						loaded.sourceFile,
					);
				}
			}
			if (isClassLike(exportValue)) {
				return buildClassRuntime(exportValue, loaded.sourceFile, exportName, context);
			}
			return createPlaceholderRuntime(
				title,
				`The export ${exportName} is not a supported auto-demo pattern. Add inline style-test metadata to make it interactive.`,
				loaded.sourceFile,
			);
		};

		if (exportValue === undefined && !metadata) {
			continue;
		}

		demos.push({
			id: demoId,
			title,
			category,
			sourceFile: loaded.sourceFile,
			kind,
			description,
			controls,
			presets,
			order: metadata?.order,
			createRuntime,
		});
	}

	if (demos.length === 0) {
		const fileTitle = humanizeIdentifier(path.basename(loaded.sourceFile, ".ts"));
		const moduleMeta = loaded.metadata?.module;
		demos.push({
			id: `${loaded.sourceFile}#module`,
			title: moduleMeta?.title ?? fileTitle,
			category: moduleMeta?.category ?? inferCategory(loaded.sourceFile, "placeholder"),
			sourceFile: loaded.sourceFile,
			kind: moduleMeta?.kind ?? "placeholder",
			description: moduleMeta?.description ?? `No auto-demoable exports were found in ${loaded.sourceFile}.`,
			controls: moduleMeta?.controls ?? [],
			presets: moduleMeta?.presets,
			order: moduleMeta?.order,
			createRuntime: (context, values) =>
				moduleMeta?.createRuntime
					? moduleMeta.createRuntime(namespace, "module", namespace, context, values)
					: createPlaceholderRuntime(fileTitle, `No runnable demo could be auto-generated for ${loaded.sourceFile}.`, loaded.sourceFile),
		});
	}

	return demos;
}
