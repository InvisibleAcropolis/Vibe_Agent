import { getDefaultDemoValues } from "../catalog/build-demo-catalog.js";
import { getThemeNames, setActiveTheme, type ThemeName } from "../../../src/themes/index.js";
import type { StyleTestControlValues, StyleTestDemoDefinition } from "../../../src/style-test-contract.js";

export type ActionHandlers = {
	reset: () => void;
	randomize: () => void;
	cycleTheme: () => void;
	openOverlay: () => void;
	savePresetAs: () => void;
	switchVariant: (presetId: string) => void;
	applyPreset: (presetId: string) => void;
};

export function resetDemoValues(demo: StyleTestDemoDefinition, presetId: string): StyleTestControlValues {
	return demo.loadValues ? demo.loadValues(presetId) : getDefaultDemoValues(demo);
}

export function randomizeDemoValues(demo: StyleTestDemoDefinition, currentValues: StyleTestControlValues): StyleTestControlValues {
	const values = { ...currentValues };
	for (const control of demo.controls) {
		switch (control.type) {
			case "number":
				values[control.id] = Number((control.min + Math.random() * (control.max - control.min)).toFixed(2));
				break;
			case "boolean":
				values[control.id] = Math.random() > 0.5;
				break;
			case "enum":
				values[control.id] = control.options[Math.floor(Math.random() * control.options.length)]!;
				break;
			case "text":
				values[control.id] = `${control.defaultValue} ${Math.floor(Math.random() * 9) + 1}`;
				break;
		}
	}
	return values;
}

export function cycleThemeName(currentThemeName: ThemeName): void {
	const themes = getThemeNames();
	const index = themes.indexOf(currentThemeName);
	setActiveTheme(themes[(index + 1) % themes.length]!);
}

export function createActionDispatcher(handlers: ActionHandlers): (actionId: string) => void {
	const exactActions = new Map<string, () => void>([
		["action-reset", handlers.reset],
		["action-randomize", handlers.randomize],
		["action-cycle-theme", handlers.cycleTheme],
		["action-open-overlay", handlers.openOverlay],
		["action-save-preset-as", handlers.savePresetAs],
	]);
	const prefixActions: Array<{ prefix: string; run: (suffix: string) => void }> = [
		{ prefix: "variant:", run: handlers.switchVariant },
		{ prefix: "preset:", run: handlers.applyPreset },
	];

	return (actionId: string): void => {
		const exact = exactActions.get(actionId);
		if (exact) {
			exact();
			return;
		}
		for (const action of prefixActions) {
			if (actionId.startsWith(action.prefix)) {
				action.run(actionId.slice(action.prefix.length));
				return;
			}
		}
	};
}
