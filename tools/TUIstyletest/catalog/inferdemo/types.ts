import type {
	StyleTestControl,
	StyleTestControlValue,
	StyleTestControlValues,
	StyleTestEntryMetadata,
	StyleTestRuntime,
	StyleTestRuntimeContext,
} from "../../../../src/style-test-contract.js";
import type { DemoPresetStore } from "../demo-preset-store.js";

export type InferredFieldKind = "number" | "boolean" | "enum" | "string" | "json";
export type StandardAnimationPattern = "factory" | "render-anim-theme" | "render-theme-anim";

export interface InferredField {
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

export interface InferredAnimationExport {
	exportName: string;
	optionsInterfaceName: string;
	pattern: StandardAnimationPattern;
	fields: InferredField[];
}

export interface AnimationAdapter {
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

export interface InferredAnimationMetadataResult {
	exports: Record<string, StyleTestEntryMetadata>;
	onlyUseInferred: boolean;
}
