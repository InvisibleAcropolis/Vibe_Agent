import type { Component, OverlayOptions, TUI } from "@mariozechner/pi-tui";
import type { AnimationState } from "./animation-engine.js";
import type { ShellMenuDefinition } from "./components/shell-menu-overlay.js";
import type { ThemeConfig, ThemeName } from "./themes/index.js";

export type StyleTestControlValue = number | boolean | string;
export type StyleTestControlValues = Record<string, StyleTestControlValue>;
export type StyleTestKind = "animation" | "component" | "overlay" | "primitive" | "placeholder";

interface StyleTestControlBase {
	id: string;
	label: string;
	description?: string;
}

export interface StyleTestNumberControl extends StyleTestControlBase {
	type: "number";
	defaultValue: number;
	min: number;
	max: number;
	step: number;
}

export interface StyleTestBooleanControl extends StyleTestControlBase {
	type: "boolean";
	defaultValue: boolean;
}

export interface StyleTestEnumControl extends StyleTestControlBase {
	type: "enum";
	defaultValue: string;
	options: string[];
}

export interface StyleTestTextControl extends StyleTestControlBase {
	type: "text";
	defaultValue: string;
	placeholder?: string;
	multiline?: boolean;
	readOnly?: boolean;
}

export type StyleTestControl =
	| StyleTestNumberControl
	| StyleTestBooleanControl
	| StyleTestEnumControl
	| StyleTestTextControl;

export interface StyleTestPreset {
	id: string;
	label: string;
	values: StyleTestControlValues;
}

export interface StyleTestPresetVariant {
	id: string;
	label: string;
}

export interface StyleTestRuntime {
	render(width: number, height: number): string[];
	handleInput?(data: string): void;
	openOverlay?(): void;
	dispose?(): void;
	component?: Component;
}

export interface StyleTestRuntimeContext {
	tui: TUI;
	getAnimationState(): AnimationState;
	getTheme(): ThemeConfig;
	getThemeName(): ThemeName;
	resolveStyleDemo(sourceFile: string, exportName: string): StyleTestDemoDefinition | undefined;
	listStyleDemos(): StyleTestDemoDefinition[];
	setControlValue(controlId: string, value: StyleTestControlValue): void;
	openSelectOverlay(id: string, title: string, description: string): void;
	openTextPrompt(title: string, description: string, initialValue: string): void;
	openEditorPrompt(title: string, prefill: string): void;
	showOverlay(id: string, component: Component, options: OverlayOptions): void;
	openShellMenu(id: string, definition: ShellMenuDefinition): void;
	closeOverlay(id: string): void;
}

export interface StyleTestDemoDefinition {
	id: string;
	title: string;
	category: string;
	sourceFile: string;
	kind: StyleTestKind;
	description: string;
	controls: StyleTestControl[];
	presets?: StyleTestPreset[];
	initialValues?: StyleTestControlValues;
	listPresetVariants?(): StyleTestPresetVariant[];
	loadValues?(presetId?: string): StyleTestControlValues;
	saveValues?(values: StyleTestControlValues, presetId?: string): string | void;
	createRuntime(context: StyleTestRuntimeContext, values: StyleTestControlValues): StyleTestRuntime;
	order?: number;
}

export type StyleTestModuleNamespace = Record<string, unknown>;

export interface StyleTestEntryMetadata {
	title?: string;
	category?: string;
	kind?: StyleTestKind;
	description?: string;
	controls?: StyleTestControl[];
	presets?: StyleTestPreset[];
	initialValues?: StyleTestControlValues;
	listPresetVariants?: () => StyleTestPresetVariant[];
	loadValues?: (presetId?: string) => StyleTestControlValues;
	saveValues?: (values: StyleTestControlValues, presetId?: string) => string | void;
	hidden?: boolean;
	order?: number;
	createRuntime?: (
		moduleNamespace: StyleTestModuleNamespace,
		exportName: string,
		exportValue: unknown,
		context: StyleTestRuntimeContext,
		values: StyleTestControlValues,
	) => StyleTestRuntime;
}

export interface StyleTestModuleMetadata {
	autoExports?: boolean;
	module?: StyleTestEntryMetadata;
	exports?: Record<string, StyleTestEntryMetadata>;
}

export function defineStyleTestDemos<T extends StyleTestModuleMetadata>(metadata: T): T {
	return metadata;
}
