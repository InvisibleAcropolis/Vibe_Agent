import { createPlaceholderRuntime } from "../../../../src/style-test-fixtures.js";
import { optionPresetAdapters, PLASMA_FRACTAL_JULIA_MACRO_VERSION, isLegacyPlasmaFractalPreset, type PlasmaOptions, type StarfieldOptions, type VortexOptions, type WaterRippleOptions } from "./presets.js";
import type { AnimationAdapter } from "./types.js";

const { plasma, starfield, waterRipple, vortex } = optionPresetAdapters;

export const ADAPTERS: Record<string, AnimationAdapter> = {
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
		omitOptionFields: ["stereoLayout", "stereoStartOffsetStep", "stereoFlipHueShift", "stereoFlipGlyphOrder"],
	},
	"src/components/anim_plasma.ts#renderPlasma": {
		customizeField(field) {
			if (field.control.type === "number" && field.id in plasma.PLASMA_NUMBER_OPTION_SPECS) {
				const spec = plasma.PLASMA_NUMBER_OPTION_SPECS[field.id as keyof typeof plasma.PLASMA_NUMBER_OPTION_SPECS];
				const label = field.id === "fractalJuliaX" ? "Fractal Julia X" : field.id === "fractalJuliaY" ? "Fractal Julia Y" : field.label;
				const description = field.id === "fractalJuliaX" || field.id === "fractalJuliaY" ? "1 = tuned base" : field.control.description;
				return { ...field, label, defaultValue: spec.defaultValue, control: { ...field.control, label, defaultValue: spec.defaultValue, min: spec.min, max: spec.max, step: spec.step, description } };
			}
			if (field.control.type === "boolean" && field.id in plasma.PLASMA_DEFAULTS) {
				const defaultValue = plasma.PLASMA_DEFAULTS[field.id as keyof typeof plasma.PLASMA_DEFAULTS];
				if (typeof defaultValue === "boolean") {
					return { ...field, defaultValue, control: { ...field.control, defaultValue } };
				}
			}
			if (field.control.type === "enum" && field.id in plasma.PLASMA_DEFAULTS) {
				const defaultValue = plasma.PLASMA_DEFAULTS[field.id as keyof typeof plasma.PLASMA_DEFAULTS];
				if (typeof defaultValue === "string" && field.control.options.includes(defaultValue)) {
					return { ...field, defaultValue, control: { ...field.control, defaultValue } };
				}
			}
			return field;
		},
		loadStoredValues(presetStore, presetId) {
			const stored = presetStore.load(presetId);
			if (isLegacyPlasmaFractalPreset(stored)) {
				const repaired = { ...stored, fractalJuliaX: 1, fractalJuliaY: 1, __plasmaFractalJuliaMacroVersion: PLASMA_FRACTAL_JULIA_MACRO_VERSION };
				presetStore.save(repaired, presetId);
				return repaired;
			}
			if (plasma.isPlasmaOptionsPresetValid(stored)) {
				return stored;
			}
			const repaired: Record<string, unknown> = { ...plasma.PLASMA_DEFAULTS, __plasmaFractalJuliaMacroVersion: PLASMA_FRACTAL_JULIA_MACRO_VERSION };
			presetStore.save(repaired, presetId);
			return repaired;
		},
		saveStoredValues(presetStore, values, presetId) {
			const normalized: Record<string, unknown> = { ...plasma.normalizePlasmaOptions(values as PlasmaOptions), __plasmaFractalJuliaMacroVersion: PLASMA_FRACTAL_JULIA_MACRO_VERSION };
			return presetStore.save(normalized, presetId);
		},
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
			if (field.control.type === "number" && field.id in waterRipple.WATER_RIPPLE_NUMBER_OPTION_SPECS) {
				const spec = waterRipple.WATER_RIPPLE_NUMBER_OPTION_SPECS[field.id as keyof typeof waterRipple.WATER_RIPPLE_NUMBER_OPTION_SPECS];
				return { ...field, defaultValue: spec.defaultValue, control: { ...field.control, defaultValue: spec.defaultValue, min: spec.min, max: spec.max, step: spec.step } };
			}
			if (field.control.type === "boolean" && field.id in waterRipple.WATER_RIPPLE_DEFAULTS) {
				const defaultValue = waterRipple.WATER_RIPPLE_DEFAULTS[field.id as keyof typeof waterRipple.WATER_RIPPLE_DEFAULTS];
				if (typeof defaultValue === "boolean") {
					return { ...field, defaultValue, control: { ...field.control, defaultValue } };
				}
			}
			return field;
		},
		loadStoredValues(presetStore, presetId) {
			const stored = presetStore.load(presetId);
			if (waterRipple.isWaterRippleOptionsPresetValid(stored)) {
				return stored;
			}
			const repaired: Record<string, unknown> = { ...waterRipple.WATER_RIPPLE_DEFAULTS };
			presetStore.save(repaired, presetId);
			return repaired;
		},
		saveStoredValues(presetStore, values, presetId) {
			const normalized: Record<string, unknown> = { ...waterRipple.normalizeWaterRippleOptions(values as WaterRippleOptions) };
			return presetStore.save(normalized, presetId);
		},
	},
	"src/components/anim_vortex.ts#createVortex": {
		customizeField(field) {
			if (field.control.type === "number" && field.id in vortex.VORTEX_NUMBER_OPTION_SPECS) {
				const spec = vortex.VORTEX_NUMBER_OPTION_SPECS[field.id as keyof typeof vortex.VORTEX_NUMBER_OPTION_SPECS];
				return { ...field, defaultValue: spec.defaultValue, control: { ...field.control, defaultValue: spec.defaultValue, min: spec.min, max: spec.max, step: spec.step } };
			}
			if (field.control.type === "boolean" && field.id in vortex.VORTEX_DEFAULTS) {
				const defaultValue = vortex.VORTEX_DEFAULTS[field.id as keyof typeof vortex.VORTEX_DEFAULTS];
				if (typeof defaultValue === "boolean") {
					return { ...field, defaultValue, control: { ...field.control, defaultValue } };
				}
			}
			if (field.control.type === "enum" && field.id in vortex.VORTEX_DEFAULTS) {
				const defaultValue = vortex.VORTEX_DEFAULTS[field.id as keyof typeof vortex.VORTEX_DEFAULTS];
				if (typeof defaultValue === "string" && field.control.options.includes(defaultValue)) {
					return { ...field, defaultValue, control: { ...field.control, defaultValue } };
				}
			}
			return field;
		},
		loadStoredValues(presetStore, presetId) {
			const stored = presetStore.load(presetId);
			if (vortex.isVortexOptionsPresetValid(stored)) {
				return stored;
			}
			const repaired: Record<string, unknown> = { ...vortex.VORTEX_DEFAULTS };
			presetStore.save(repaired, presetId);
			return repaired;
		},
		saveStoredValues(presetStore, values, presetId) {
			const normalized: Record<string, unknown> = { ...vortex.normalizeVortexOptions(values as VortexOptions) };
			return presetStore.save(normalized, presetId);
		},
	},
	"src/components/anim_starfield.ts#createStarfield": {
		customizeField(field) {
			if (field.control.type === "number" && field.id in starfield.STARFIELD_NUMBER_OPTION_SPECS) {
				const spec = starfield.STARFIELD_NUMBER_OPTION_SPECS[field.id as keyof typeof starfield.STARFIELD_NUMBER_OPTION_SPECS];
				return { ...field, defaultValue: spec.defaultValue, control: { ...field.control, defaultValue: spec.defaultValue, min: spec.min, max: spec.max, step: spec.step } };
			}
			return field;
		},
		loadStoredValues(presetStore, presetId) {
			const stored = presetStore.load(presetId);
			if (starfield.isStarfieldOptionsPresetValid(stored)) {
				return stored;
			}
			const repaired: Record<string, unknown> = { ...starfield.STARFIELD_DEFAULTS };
			presetStore.save(repaired, presetId);
			return repaired;
		},
		saveStoredValues(presetStore, values, presetId) {
			const normalized: Record<string, unknown> = { ...starfield.normalizeStarfieldOptions(values as StarfieldOptions) };
			return presetStore.save(normalized, presetId);
		},
	},
};
