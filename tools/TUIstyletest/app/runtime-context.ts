import type { TUI } from "@mariozechner/pi-tui";
import type { AnimationEngine } from "../../../src/animation-engine.js";
import type { DefaultAppStateStore } from "../../../src/app-state-store.js";
import type { DefaultOverlayController } from "../../../src/overlay-controller.js";
import { getActiveTheme, type ThemeName } from "../../../src/themes/index.js";
import type { StyleTestControlValues, StyleTestDemoDefinition, StyleTestRuntimeContext } from "../../../src/style-test-contract.js";

export function buildRuntimeContext(options: {
	tui: TUI;
	animationEngine: AnimationEngine;
	demos: StyleTestDemoDefinition[];
	stateStore: DefaultAppStateStore;
	overlayController: DefaultOverlayController;
	getThemeName: () => ThemeName;
	updateControlValue: (controlId: string, value: string | number | boolean) => void;
}): StyleTestRuntimeContext {
	const { tui, animationEngine, demos, stateStore, overlayController, getThemeName, updateControlValue } = options;
	return {
		tui,
		getAnimationState: () => animationEngine.getState(),
		getTheme: () => getActiveTheme(),
		getThemeName,
		resolveStyleDemo: (sourceFile, exportName) => demos.find((demo) => demo.sourceFile === sourceFile && demo.id === `${sourceFile}#${exportName}`),
		listStyleDemos: () => demos,
		setControlValue: (controlId, value) => updateControlValue(controlId, value),
		openSelectOverlay: (id, title, description) =>
			overlayController.openSelectOverlay(
				id,
				title,
				description,
				[
					{ value: "one", label: "Alpha", description: "Style alpha" },
					{ value: "two", label: "Beta", description: "Style beta" },
				],
				() => undefined,
			),
		openTextPrompt: (title, description, initialValue) =>
			overlayController.openTextPrompt(title, description, initialValue, (value) => {
				const focusLabel = stateStore.getState().focusLabel;
				const controlId = focusLabel.startsWith("edit:") ? focusLabel.slice(5) : undefined;
				if (controlId) {
					updateControlValue(controlId, value);
				}
			}),
		openEditorPrompt: (title, prefill) => overlayController.openEditorPrompt(title, prefill, () => undefined, () => undefined),
		showOverlay: (id, component, options) => {
			overlayController.showCustomOverlay(id, component, options);
		},
		openShellMenu: (id, definition) => overlayController.openMenuOverlay(id, definition),
		closeOverlay: (id) => overlayController.closeOverlay(id),
	};
}

export function createRuntime(demo: StyleTestDemoDefinition, values: StyleTestControlValues, context: StyleTestRuntimeContext) {
	return demo.createRuntime(context, values);
}
