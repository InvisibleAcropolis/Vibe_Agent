import { readFileSync } from "node:fs";
import ts from "typescript";
import type {
	StyleTestControl,
	StyleTestControlValue,
	StyleTestControlValues,
	StyleTestEntryMetadata,
	StyleTestRuntime,
	StyleTestRuntimeContext,
} from "../../../src/style-test-contract.js";
import { createPlaceholderRuntime } from "../../../src/style-test-fixtures.js";
import {
	WATER_RIPPLE_DEFAULTS,
	WATER_RIPPLE_NUMBER_OPTION_SPECS,
	isWaterRippleOptionsPresetValid,
	normalizeWaterRippleOptions,
	type WaterRippleOptions,
} from "../../../src/components/anim_waterripple.js";
import {
	VORTEX_DEFAULTS,
	VORTEX_NUMBER_OPTION_SPECS,
	isVortexOptionsPresetValid,
	normalizeVortexOptions,
	type VortexOptions,
} from "../../../src/components/anim_vortex.js";
import type { LoadedStyleModule } from "./module-loader.js";
import { DemoPresetStore } from "./demo-preset-store.js";

type InferredFieldKind = "number" | "boolean" | "enum" | "string" | "json";
type StandardAnimationPattern = "factory" | "render-anim-theme" | "render-theme-anim";

interface InferredField {
	id: string;
	label: string;
	rawType: string;
	kind: InferredFieldKind;
	optional: boolean;
	enumOptions?: string[];
	defaultValue: unknown;
	control: StyleTestControl;
	parse(value: StyleTestControlValue): unknown;
	format(value: unknown): StyleTestControlValue;
}

interface InferredAnimationExport {
	exportName: string;
	optionsInterfaceName: string;
	pattern: StandardAnimationPattern;
	fields: InferredField[];
}

interface AnimationAdapter {
	pattern?: StandardAnimationPattern;
	omitOptionFields?: string[];
	fixedOptions?: Record<string, unknown>;
	extraControls?: StyleTestControl[];
	customizeField?(field: InferredField): InferredField;
	loadStoredValues?(presetStore: DemoPresetStore, presetId: string): Record<string, unknown> | undefined;
	saveStoredValues?(presetStore: DemoPresetStore, values: Record<string, unknown>, presetId: string): string;
	createRuntime?(
		exportValue: unknown,
		context: StyleTestRuntimeContext,
		values: StyleTestControlValues,
		options: Record<string, unknown> | undefined,
	): StyleTestRuntime;
}

interface InferredAnimationMetadataResult {
	exports: Record<string, StyleTestEntryMetadata>;
	onlyUseInferred: boolean;
}

const ADAPTERS: Record<string, AnimationAdapter> = {
	"src/components/anim_datarain.ts#renderDataRainHex": {
		omitOptionFields: ["glyphSet"],
		fixedOptions: { glyphSet: "hex" },
	},
	"src/components/anim_datarain.ts#renderDataRainBinary": {
		omitOptionFields: ["glyphSet"],
		fixedOptions: { glyphSet: "binary" },
	},
	"src/components/anim_datarain.ts#renderDataRainKatakana": {
		omitOptionFields: ["glyphSet"],
		fixedOptions: { glyphSet: "katakana" },
	},
	"src/components/anim_orbitarc.ts#renderOrbitArcMulti": {
		pattern: "render-anim-theme",
		extraControls: [{ id: "count", label: "Count", type: "number", defaultValue: 3, min: 1, max: 8, step: 1 }],
		createRuntime(exportValue, context, values, options) {
			if (typeof exportValue !== "function") {
				return createPlaceholderRuntime("Orbit Arc Multi", "Export is not callable.", "src/components/anim_orbitarc.ts");
			}
			return {
				render() {
					const rendered = exportValue(context.getAnimationState(), context.getTheme(), Number(values.count), options);
					return typeof rendered === "string" ? rendered.split("\n") : ["Renderer returned a non-string value."];
				},
			};
		},
	},
	"src/components/anim_pulsemeter.ts#renderPulseMeter": {
		pattern: "render-anim-theme",
		extraControls: [{ id: "value", label: "Value", type: "number", defaultValue: 74, min: 0, max: 100, step: 1 }],
		createRuntime(exportValue, context, values, options) {
			if (typeof exportValue !== "function") {
				return createPlaceholderRuntime("Pulse Meter", "Export is not callable.", "src/components/anim_pulsemeter.ts");
			}
			return {
				render() {
					const rendered = exportValue(Number(values.value) / 100, context.getAnimationState(), context.getTheme(), options);
					return typeof rendered === "string" ? rendered.split("\n") : ["Renderer returned a non-string value."];
				},
			};
		},
	},
	"src/components/anim_pulsemeter.ts#renderDualPulseMeter": {
		pattern: "render-anim-theme",
		omitOptionFields: ["label", "dualMode"],
		fixedOptions: { label: "", dualMode: true },
		extraControls: [
			{ id: "leftValue", label: "Left", type: "number", defaultValue: 45, min: 0, max: 100, step: 1 },
			{ id: "rightValue", label: "Right", type: "number", defaultValue: 80, min: 0, max: 100, step: 1 },
		],
		createRuntime(exportValue, context, values, options) {
			if (typeof exportValue !== "function") {
				return createPlaceholderRuntime("Dual Pulse Meter", "Export is not callable.", "src/components/anim_pulsemeter.ts");
			}
			return {
				render() {
					const rendered = exportValue(
						Number(values.leftValue) / 100,
						Number(values.rightValue) / 100,
						context.getAnimationState(),
						context.getTheme(),
						options,
					);
					return typeof rendered === "string" ? rendered.split("\n") : ["Renderer returned a non-string value."];
				},
			};
		},
	},
	"src/components/anim_spectrumbars.ts#createSpectrumBars": {
		omitOptionFields: [
			"stereoLayout",
			"stereoStartOffsetStep",
			"stereoFlipHueShift",
			"stereoFlipGlyphOrder",
		],
	},
	"src/components/anim_synthgrid.ts#renderSynthgridWide": {
		omitOptionFields: ["cols", "rows", "numVLines"],
		fixedOptions: { cols: 48, rows: 12, numVLines: 9 },
	},
	"src/components/anim_wavesweep.ts#renderWaveSweepDual": {
		omitOptionFields: ["phaseOffset"],
	},
	"src/components/anim_waterripple.ts#createWaterRipple": {
		customizeField(field) {
			if (field.control.type === "number" && field.id in WATER_RIPPLE_NUMBER_OPTION_SPECS) {
				const spec = WATER_RIPPLE_NUMBER_OPTION_SPECS[field.id as keyof typeof WATER_RIPPLE_NUMBER_OPTION_SPECS];
				return {
					...field,
					defaultValue: spec.defaultValue,
					control: {
						...field.control,
						defaultValue: spec.defaultValue,
						min: spec.min,
						max: spec.max,
						step: spec.step,
					},
				};
			}
			if (field.control.type === "boolean" && field.id in WATER_RIPPLE_DEFAULTS) {
				const defaultValue = WATER_RIPPLE_DEFAULTS[field.id as keyof typeof WATER_RIPPLE_DEFAULTS];
				if (typeof defaultValue === "boolean") {
					return {
						...field,
						defaultValue,
						control: {
							...field.control,
							defaultValue,
						},
					};
				}
			}
			return field;
		},
		loadStoredValues(presetStore, presetId) {
			const stored = presetStore.load(presetId);
			if (isWaterRippleOptionsPresetValid(stored)) {
				return stored;
			}
			const repaired: Record<string, unknown> = { ...WATER_RIPPLE_DEFAULTS };
			presetStore.save(repaired, presetId);
			return repaired;
		},
		saveStoredValues(presetStore, values, presetId) {
			const normalized: Record<string, unknown> = {
				...normalizeWaterRippleOptions(values as WaterRippleOptions),
			};
			return presetStore.save(normalized, presetId);
		},
	},
	"src/components/anim_vortex.ts#createVortex": {
		customizeField(field) {
			if (field.control.type === "number" && field.id in VORTEX_NUMBER_OPTION_SPECS) {
				const spec = VORTEX_NUMBER_OPTION_SPECS[field.id as keyof typeof VORTEX_NUMBER_OPTION_SPECS];
				return {
					...field,
					defaultValue: spec.defaultValue,
					control: {
						...field.control,
						defaultValue: spec.defaultValue,
						min: spec.min,
						max: spec.max,
						step: spec.step,
					},
				};
			}
			if (field.control.type === "boolean" && field.id in VORTEX_DEFAULTS) {
				const defaultValue = VORTEX_DEFAULTS[field.id as keyof typeof VORTEX_DEFAULTS];
				if (typeof defaultValue === "boolean") {
					return {
						...field,
						defaultValue,
						control: {
							...field.control,
							defaultValue,
						},
					};
				}
			}
			if (field.control.type === "enum" && field.id in VORTEX_DEFAULTS) {
				const defaultValue = VORTEX_DEFAULTS[field.id as keyof typeof VORTEX_DEFAULTS];
				if (typeof defaultValue === "string" && field.control.options.includes(defaultValue)) {
					return {
						...field,
						defaultValue,
						control: {
							...field.control,
							defaultValue,
						},
					};
				}
			}
			return field;
		},
		loadStoredValues(presetStore, presetId) {
			const stored = presetStore.load(presetId);
			if (isVortexOptionsPresetValid(stored)) {
				return stored;
			}
			const repaired: Record<string, unknown> = { ...VORTEX_DEFAULTS };
			presetStore.save(repaired, presetId);
			return repaired;
		},
		saveStoredValues(presetStore, values, presetId) {
			const normalized: Record<string, unknown> = {
				...normalizeVortexOptions(values as VortexOptions),
			};
			return presetStore.save(normalized, presetId);
		},
	},
};

function isStringLiteralTypeNode(node: ts.TypeNode): node is ts.LiteralTypeNode & { literal: ts.StringLiteral } {
	return ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal);
}

function isAnimationSource(sourceFile: string): boolean {
	return sourceFile.includes("/anim_");
}

function hasExportModifier(node: ts.Node): boolean {
	return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function humanizeIdentifier(identifier: string): string {
	return identifier
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/^render\s+/i, "")
		.replace(/^create\s+/i, "")
		.replace(/\b\w/g, (char) => char.toUpperCase());
}

function inferNumericDefault(name: string): number {
	const lowerName = name.toLowerCase();
	if (/huerangestartstep/.test(lowerName)) return 135;
	if (/huerangeendstep/.test(lowerName)) return 156;
	if (/glyphcount/.test(lowerName)) return 128;
	if (/stereostartoffsetstep/.test(lowerName)) return 64;
	if (/hueshiftspeed/.test(lowerName)) return 1;
	if (/huestep/.test(lowerName)) return 128;
	if (/saturation/.test(lowerName)) return 1;
	if (/lightness/.test(lowerName)) return 0.5;
	if (/smoothing/.test(lowerName)) return 0.3;
	if (/(cols|width)/.test(lowerName)) return 24;
	if (/(rows|height)/.test(lowerName)) return 8;
	if (/(count|lines|points|octaves|maxcount|numvlines)/.test(lowerName)) return 8;
	if (/(length|interval|ticks|threshold|generations|beamwidth|strokewidth|rowheight|gap)/.test(lowerName)) return 4;
	if (/direction/.test(lowerName)) return 0;
	if (/phaseoffset/.test(lowerName)) return 0;
	if (/(speed|timescale|decay|damping|density|freq|scale|persistence|inertia|strength|radius|chance|variety|modulation)/.test(lowerName)) return 0.5;
	return 1;
}

function inferNumberBounds(name: string, defaultValue: number): { min: number; max: number; step: number } {
	const lowerName = name.toLowerCase();
	if (/(huerangestartstep|huerangeendstep|stereostartoffsetstep|glyphcount|huestep)/.test(lowerName)) {
		return { min: 0, max: 256, step: 1 };
	}
	if (/hueshiftspeed/.test(lowerName)) {
		return { min: 0, max: 8, step: 0.05 };
	}
	if (/(saturation|lightness)/.test(lowerName)) {
		return { min: 0, max: 1, step: 0.01 };
	}
	if (/smoothing/.test(lowerName)) {
		return { min: 0, max: 1, step: 0.01 };
	}
	if (/direction/.test(lowerName)) {
		return { min: -1, max: 1, step: 1 };
	}
	if (/phaseoffset/.test(lowerName)) {
		return { min: 0, max: 6.2832, step: 0.1 };
	}
	if (/(cols|width)/.test(lowerName)) {
		return { min: 1, max: 120, step: 1 };
	}
	if (/(rows|height)/.test(lowerName)) {
		return { min: 1, max: 40, step: 1 };
	}
	if (/(count|lines|points|octaves|maxcount|numvlines|interval|ticks|threshold|generations|beamwidth|strokewidth|rowheight|gap)/.test(lowerName)) {
		return { min: 1, max: Math.max(12, defaultValue * 4), step: 1 };
	}
	if (/(speed|timescale|decay|damping|density|freq|scale|persistence|inertia|chance|variety|modulation)/.test(lowerName)) {
		return { min: 0, max: 2, step: 0.01 };
	}
	if (/(strength|radius)/.test(lowerName)) {
		return { min: 0, max: Math.max(10, defaultValue * 4), step: 0.01 };
	}
	if (Number.isInteger(defaultValue)) {
		return { min: 0, max: Math.max(10, defaultValue * 4), step: 1 };
	}
	return { min: 0, max: Math.max(2, defaultValue * 4), step: 0.01 };
}

function inferComplexDefault(typeNode: ts.TypeNode): unknown {
	if (ts.isArrayTypeNode(typeNode)) {
		return [];
	}
	if (ts.isTypeLiteralNode(typeNode)) {
		return {};
	}
	if (ts.isTypeReferenceNode(typeNode)) {
		if (typeNode.typeName.getText() === "Array") {
			return [];
		}
		return {};
	}
	if (ts.isUnionTypeNode(typeNode)) {
		const stringLiterals = typeNode.types
			.filter(isStringLiteralTypeNode)
			.map((entry) => entry.literal.text);
		if (stringLiterals.length > 0) {
			return stringLiterals[0] ?? "";
		}
		if (typeNode.types.some((entry) => entry.kind === ts.SyntaxKind.NumberKeyword)) {
			return 0;
		}
	}
	return "";
}

function formatComplexValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return JSON.stringify(value ?? "", null, 2);
}

function parseComplexValue(typeNode: ts.TypeNode, rawValue: StyleTestControlValue): unknown {
	const text = String(rawValue).trim();
	if (ts.isUnionTypeNode(typeNode)) {
		const stringLiterals = typeNode.types
			.filter(isStringLiteralTypeNode)
			.map((entry) => entry.literal.text);
		if (stringLiterals.includes(text)) {
			return text;
		}
		if (typeNode.types.some((entry) => entry.kind === ts.SyntaxKind.NumberKeyword)) {
			const numeric = Number(text);
			if (Number.isFinite(numeric)) {
				return numeric;
			}
		}
	}
	if (text.length === 0) {
		return inferComplexDefault(typeNode);
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}

function createField(id: string, typeNode: ts.TypeNode, optional: boolean): InferredField {
	const rawType = typeNode.getText();
	const label = humanizeIdentifier(id);
	if (typeNode.kind === ts.SyntaxKind.NumberKeyword) {
		const defaultValue = inferNumericDefault(id);
		const bounds = inferNumberBounds(id, defaultValue);
		return {
			id,
			label,
			rawType,
			kind: "number",
			optional,
			defaultValue,
			control: { id, label, type: "number", defaultValue, min: bounds.min, max: bounds.max, step: bounds.step },
			parse(value) {
				const numeric = typeof value === "number" ? value : Number(value);
				return Number.isFinite(numeric) ? numeric : defaultValue;
			},
			format(value) {
				return typeof value === "number" && Number.isFinite(value) ? value : defaultValue;
			},
		};
	}
	if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) {
		return {
			id,
			label,
			rawType,
			kind: "boolean",
			optional,
			defaultValue: false,
			control: { id, label, type: "boolean", defaultValue: false },
			parse(value) {
				return Boolean(value);
			},
			format(value) {
				return Boolean(value);
			},
		};
	}
	if (typeNode.kind === ts.SyntaxKind.StringKeyword) {
		return {
			id,
			label,
			rawType,
			kind: "string",
			optional,
			defaultValue: "",
			control: { id, label, type: "text", defaultValue: "" },
			parse(value) {
				const next = String(value);
				return optional && next.trim().length === 0 ? undefined : next;
			},
			format(value) {
				return typeof value === "string" ? value : "";
			},
		};
	}
	if (isStringLiteralTypeNode(typeNode)) {
		return {
			id,
			label,
			rawType,
			kind: "enum",
			optional,
			enumOptions: [typeNode.literal.text],
			defaultValue: typeNode.literal.text,
			control: { id, label, type: "enum", defaultValue: typeNode.literal.text, options: [typeNode.literal.text] },
			parse(value) {
				return String(value);
			},
			format(value) {
				return typeof value === "string" ? value : typeNode.literal.text;
			},
		};
	}
	if (ts.isUnionTypeNode(typeNode)) {
		const options = typeNode.types
			.filter(isStringLiteralTypeNode)
			.map((entry) => entry.literal.text);
		if (options.length === typeNode.types.length) {
			return {
				id,
				label,
				rawType,
				kind: "enum",
				optional,
				enumOptions: options,
				defaultValue: options[0] ?? "",
				control: { id, label, type: "enum", defaultValue: options[0] ?? "", options },
				parse(value) {
					const next = String(value);
					return options.includes(next) ? next : (options[0] ?? "");
				},
				format(value) {
					return typeof value === "string" && options.includes(value) ? value : (options[0] ?? "");
				},
			};
		}
	}
	const defaultValue = inferComplexDefault(typeNode);
	return {
		id,
		label,
		rawType,
		kind: "json",
		optional,
		defaultValue,
		control: {
			id,
			label,
			type: "text",
			defaultValue: formatComplexValue(defaultValue),
			description: `JSON/text value for ${rawType}`,
			multiline: true,
		},
		parse(value) {
			if (optional && String(value).trim().length === 0) {
				return undefined;
			}
			return parseComplexValue(typeNode, value);
		},
		format(value) {
			return formatComplexValue(value === undefined ? defaultValue : value);
		},
	};
}

function collectExportedInterfaces(sourceFile: ts.SourceFile): Map<string, InferredField[]> {
	const interfaces = new Map<string, InferredField[]>();
	for (const statement of sourceFile.statements) {
		if (!ts.isInterfaceDeclaration(statement) || !hasExportModifier(statement)) {
			continue;
		}
		if (!statement.name.text.endsWith("Options")) {
			continue;
		}
		const fields: InferredField[] = [];
		for (const member of statement.members) {
			if (!ts.isPropertySignature(member) || !member.type || !member.name || !ts.isIdentifier(member.name)) {
				continue;
			}
			fields.push(createField(member.name.text, member.type, Boolean(member.questionToken)));
		}
		interfaces.set(statement.name.text, fields);
	}
	return interfaces;
}

function findOptionsInterfaceName(parameters: readonly ts.ParameterDeclaration[]): string | undefined {
	for (const parameter of parameters) {
		if (!parameter.type || !ts.isTypeReferenceNode(parameter.type)) {
			continue;
		}
		const typeName = parameter.type.typeName.getText();
		if (typeName.endsWith("Options")) {
			return typeName;
		}
	}
	return undefined;
}

function classifyAnimationExport(
	sourcePath: string,
	fn: ts.FunctionDeclaration,
	interfaceNames: Set<string>,
): { interfaceName: string; pattern: StandardAnimationPattern } | undefined {
	if (!fn.name) {
		return undefined;
	}
	const exportName = fn.name.text;
	const optionsInterfaceName = findOptionsInterfaceName(fn.parameters);
	if (!optionsInterfaceName || !interfaceNames.has(optionsInterfaceName)) {
		return undefined;
	}
	const adapter = ADAPTERS[`${sourcePath}#${exportName}`];
	if (adapter?.pattern) {
		return { interfaceName: optionsInterfaceName, pattern: adapter.pattern };
	}
	if (exportName.startsWith("create")) {
		return { interfaceName: optionsInterfaceName, pattern: "factory" };
	}
	const parameterNames = fn.parameters.map((parameter) => parameter.name.getText().toLowerCase());
	if (exportName.startsWith("render") && parameterNames[0]?.includes("anim") && parameterNames[1]?.includes("theme")) {
		return { interfaceName: optionsInterfaceName, pattern: "render-anim-theme" };
	}
	if (exportName.startsWith("render") && parameterNames[0]?.includes("theme") && parameterNames[1]?.includes("anim")) {
		return { interfaceName: optionsInterfaceName, pattern: "render-theme-anim" };
	}
	return undefined;
}

function collectAnimationExports(
	sourcePath: string,
	sourceFile: ts.SourceFile,
	interfaces: Map<string, InferredField[]>,
): InferredAnimationExport[] {
	const interfaceNames = new Set<string>(interfaces.keys());
	const exports: InferredAnimationExport[] = [];
	for (const statement of sourceFile.statements) {
		if (!ts.isFunctionDeclaration(statement) || !statement.name || !hasExportModifier(statement)) {
			continue;
		}
		const classified = classifyAnimationExport(sourcePath, statement, interfaceNames);
		if (!classified) {
			continue;
		}
		exports.push({
			exportName: statement.name.text,
			optionsInterfaceName: classified.interfaceName,
			pattern: classified.pattern,
			fields: interfaces.get(classified.interfaceName) ?? [],
		});
	}
	return exports.sort((a, b) => a.exportName.localeCompare(b.exportName));
}

function loadStoredValues(
	adapter: AnimationAdapter | undefined,
	presetStore: DemoPresetStore,
	presetId: string,
): Record<string, unknown> | undefined {
	return adapter?.loadStoredValues ? adapter.loadStoredValues(presetStore, presetId) : presetStore.load(presetId);
}

function saveStoredValues(
	adapter: AnimationAdapter | undefined,
	presetStore: DemoPresetStore,
	values: Record<string, unknown>,
	presetId: string,
): string {
	return adapter?.saveStoredValues ? adapter.saveStoredValues(presetStore, values, presetId) : presetStore.save(values, presetId);
}

function buildStoredValues(fields: InferredField[], extraControls: StyleTestControl[], values: StyleTestControlValues): Record<string, unknown> {
	const stored: Record<string, unknown> = {};
	for (const field of fields) {
		stored[field.id] = field.parse(values[field.id] ?? field.control.defaultValue);
	}
	for (const control of extraControls) {
		stored[control.id] = values[control.id] ?? control.defaultValue;
	}
	return stored;
}

function buildUiValues(fields: InferredField[], extraControls: StyleTestControl[], storedValues: Record<string, unknown> | undefined): StyleTestControlValues {
	const values: StyleTestControlValues = {};
	for (const field of fields) {
		values[field.id] = field.format(storedValues?.[field.id]);
	}
	for (const control of extraControls) {
		const storedValue = storedValues?.[control.id];
		if (control.type === "number") {
			values[control.id] = typeof storedValue === "number" ? storedValue : control.defaultValue;
			continue;
		}
		if (control.type === "boolean") {
			values[control.id] = typeof storedValue === "boolean" ? storedValue : control.defaultValue;
			continue;
		}
		values[control.id] = typeof storedValue === "string" ? storedValue : control.defaultValue;
	}
	return values;
}

function buildControls(fields: InferredField[], extraControls: StyleTestControl[], values: StyleTestControlValues): StyleTestControl[] {
	const fieldControls = fields.map((field) => {
		if (field.control.type === "number") {
			return { ...field.control, defaultValue: Number(values[field.id] ?? field.control.defaultValue) };
		}
		if (field.control.type === "boolean") {
			return { ...field.control, defaultValue: Boolean(values[field.id] ?? field.control.defaultValue) };
		}
		return { ...field.control, defaultValue: String(values[field.id] ?? field.control.defaultValue) };
	});
	return [...fieldControls, ...extraControls];
}

function buildStandardRuntime(
	exportValue: unknown,
	pattern: StandardAnimationPattern,
	context: StyleTestRuntimeContext,
	options: Record<string, unknown> | undefined,
): StyleTestRuntime {
	if (typeof exportValue !== "function") {
		return {
			render() {
				return ["Export is not callable."];
			},
		};
	}
	if (pattern === "factory") {
		const created = exportValue(options);
		if (typeof created !== "function") {
			return {
				render() {
					return ["Factory export did not return a renderer."];
				},
			};
		}
		return {
			render() {
				const rendered = created(context.getAnimationState(), context.getTheme());
				return typeof rendered === "string" ? rendered.split("\n") : ["Factory renderer returned a non-string value."];
			},
		};
	}
	if (pattern === "render-theme-anim") {
		return {
			render() {
				const rendered = exportValue(context.getTheme(), context.getAnimationState(), options);
				return typeof rendered === "string" ? rendered.split("\n") : ["Renderer returned a non-string value."];
			},
		};
	}
	return {
		render() {
			const rendered = exportValue(context.getAnimationState(), context.getTheme(), options);
			return typeof rendered === "string" ? rendered.split("\n") : ["Renderer returned a non-string value."];
		},
	};
}

export function inferAnimationStyleMetadata(loaded: LoadedStyleModule, rootDir: string): InferredAnimationMetadataResult | undefined {
	if (!isAnimationSource(loaded.sourceFile)) {
		return undefined;
	}
	const sourceText = readFileSync(loaded.filePath, "utf-8");
	const sourceFile = ts.createSourceFile(loaded.filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const interfaces = collectExportedInterfaces(sourceFile);
	const exports = collectAnimationExports(loaded.sourceFile, sourceFile, interfaces);
	if (exports.length === 0) {
		return { exports: {}, onlyUseInferred: true };
	}

	const metadataByExport: Record<string, StyleTestEntryMetadata> = {};
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
			saveValues: (values, presetId = "default") => {
				const storedValues = buildStoredValues(fields, extraControls, values);
				return saveStoredValues(adapter, presetStore, { ...storedValues, ...(adapter?.fixedOptions ?? {}) }, presetId);
			},
			createRuntime: (_moduleNamespace, _exportName, exportValue, context, values) => {
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

	return {
		exports: metadataByExport,
		onlyUseInferred: true,
	};
}
