import {
	PLASMA_DEFAULTS,
	PLASMA_NUMBER_OPTION_SPECS,
	isPlasmaOptionsPresetValid,
	normalizePlasmaOptions,
	type PlasmaOptions,
} from "../../../../src/components/anim_plasma.js";
import {
	STARFIELD_DEFAULTS,
	STARFIELD_NUMBER_OPTION_SPECS,
	isStarfieldOptionsPresetValid,
	normalizeStarfieldOptions,
	type StarfieldOptions,
} from "../../../../src/components/anim_starfield.js";
import {
	WATER_RIPPLE_DEFAULTS,
	WATER_RIPPLE_NUMBER_OPTION_SPECS,
	isWaterRippleOptionsPresetValid,
	normalizeWaterRippleOptions,
	type WaterRippleOptions,
} from "../../../../src/components/anim_waterripple.js";
import {
	VORTEX_DEFAULTS,
	VORTEX_NUMBER_OPTION_SPECS,
	isVortexOptionsPresetValid,
	normalizeVortexOptions,
	type VortexOptions,
} from "../../../../src/components/anim_vortex.js";
import type { StyleTestControl, StyleTestControlValues } from "../../../../src/style-test-contract.js";
import { DemoPresetStore } from "../demo-preset-store.js";
import type { AnimationAdapter, InferredField } from "./types.js";

export const PLASMA_FRACTAL_JULIA_MACRO_VERSION = 1;

export function isLegacyPlasmaFractalPreset(stored: unknown): stored is Record<string, unknown> {
	if (typeof stored !== "object" || stored === null) {
		return false;
	}
	const candidate = stored as Record<string, unknown>;
	return candidate.mode === "fractal" && candidate.__plasmaFractalJuliaMacroVersion !== PLASMA_FRACTAL_JULIA_MACRO_VERSION;
}

export function loadStoredValues(
	adapter: AnimationAdapter | undefined,
	presetStore: DemoPresetStore,
	presetId: string,
): Record<string, unknown> | undefined {
	return adapter?.loadStoredValues ? adapter.loadStoredValues(presetStore, presetId) : presetStore.load(presetId);
}

export function saveStoredValues(
	adapter: AnimationAdapter | undefined,
	presetStore: DemoPresetStore,
	values: Record<string, unknown>,
	presetId: string,
): string {
	return adapter?.saveStoredValues ? adapter.saveStoredValues(presetStore, values, presetId) : presetStore.save(values, presetId);
}

export function buildStoredValues(fields: InferredField[], extraControls: StyleTestControl[], values: StyleTestControlValues): Record<string, unknown> {
	const stored: Record<string, unknown> = {};
	for (const field of fields) {
		stored[field.id] = field.parse(values[field.id] ?? field.control.defaultValue);
	}
	for (const control of extraControls) {
		stored[control.id] = values[control.id] ?? control.defaultValue;
	}
	return stored;
}

export function buildUiValues(
	fields: InferredField[],
	extraControls: StyleTestControl[],
	storedValues: Record<string, unknown> | undefined,
): StyleTestControlValues {
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

export const optionPresetAdapters = {
	plasma: {
		PLASMA_DEFAULTS,
		PLASMA_NUMBER_OPTION_SPECS,
		isPlasmaOptionsPresetValid,
		normalizePlasmaOptions,
	},
	starfield: {
		STARFIELD_DEFAULTS,
		STARFIELD_NUMBER_OPTION_SPECS,
		isStarfieldOptionsPresetValid,
		normalizeStarfieldOptions,
	},
	waterRipple: {
		WATER_RIPPLE_DEFAULTS,
		WATER_RIPPLE_NUMBER_OPTION_SPECS,
		isWaterRippleOptionsPresetValid,
		normalizeWaterRippleOptions,
	},
	vortex: {
		VORTEX_DEFAULTS,
		VORTEX_NUMBER_OPTION_SPECS,
		isVortexOptionsPresetValid,
		normalizeVortexOptions,
	},
};

export type { PlasmaOptions, StarfieldOptions, WaterRippleOptions, VortexOptions };
