import type { DefaultAppStateStore } from "../../../src/app-state-store.js";
import type { DefaultOverlayController } from "../../../src/overlay-controller.js";
import type { StyleTestControl } from "../../../src/style-test-contract.js";
import { clamp } from "./layout.js";

export function adjustNumberControl(control: StyleTestControl | undefined, currentValue: unknown, delta: number, update: (value: number) => void): void {
	if (!control || control.type !== "number") return;
	const current = Number(currentValue ?? control.defaultValue);
	const next = clamp(current + delta * control.step, control.min, control.max);
	update(Number(next.toFixed(4)));
}

export function toggleBooleanControl(control: StyleTestControl | undefined, currentValue: unknown, update: (value: boolean) => void): void {
	if (!control || control.type !== "boolean") return;
	update(!Boolean(currentValue));
}

export function cycleEnumControl(control: StyleTestControl | undefined, currentValue: unknown, direction: number, update: (value: string) => void): void {
	if (!control || control.type !== "enum") return;
	const current = String(currentValue ?? control.defaultValue);
	const index = control.options.indexOf(current);
	const next = control.options[(index + direction + control.options.length) % control.options.length]!;
	update(next);
}

export function editNumberControl(options: {
	control: StyleTestControl | undefined;
	currentValue: unknown;
	stateStore: DefaultAppStateStore;
	overlayController: DefaultOverlayController;
	setFocusPane: () => void;
	update: (value: number) => void;
}): void {
	const { control, currentValue, stateStore, overlayController, setFocusPane, update } = options;
	if (!control || control.type !== "number") return;
	stateStore.setFocusLabel(`edit:${control.id}`);
	overlayController.openTextPrompt(
		control.label,
		control.description ?? "Enter an exact numeric value.",
		String(currentValue ?? control.defaultValue),
		(value) => {
			const numeric = Number(value.trim());
			if (!Number.isFinite(numeric)) {
				setFocusPane();
				return;
			}
			const next = clamp(numeric, control.min, control.max);
			update(Number(next.toFixed(4)));
			setFocusPane();
		},
		() => setFocusPane(),
	);
}

export function editTextControl(options: {
	control: StyleTestControl | undefined;
	currentValue: unknown;
	stateStore: DefaultAppStateStore;
	overlayController: DefaultOverlayController;
	setFocusPane: () => void;
	update: (value: string) => void;
}): void {
	const { control, currentValue, stateStore, overlayController, setFocusPane, update } = options;
	if (!control || control.type !== "text" || control.readOnly) return;
	stateStore.setFocusLabel(`edit:${control.id}`);
	const initialValue = String(currentValue ?? control.defaultValue);
	if (control.multiline) {
		overlayController.openEditorPrompt(
			control.label,
			initialValue,
			(value) => {
				update(value);
				setFocusPane();
			},
			() => setFocusPane(),
		);
		return;
	}
	overlayController.openTextPrompt(control.label, control.description ?? "Edit control value.", initialValue, (value) => {
		update(value);
		setFocusPane();
	});
}
