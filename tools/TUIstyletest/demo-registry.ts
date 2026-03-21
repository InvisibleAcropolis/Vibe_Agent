import type { Component, OverlayOptions, TUI } from "@mariozechner/pi-tui";
import type { AgentHostState } from "../../src/agent-host.js";
import type { AnimationState } from "../../src/animation-engine.js";
import { renderBoxLine, renderSeparator } from "../../src/components/style-primitives.js";
import {
	createBoids as createBaseBoids,
	createDoomFire as createBaseDoomFire,
	createFlowField as createBaseFlowField,
	createGameOfLife as createBaseGameOfLife,
	createGlyphCascade as createBaseGlyphCascade,
	createLaserScan as createBaseLaserScan,
	createLissajous as createBaseLissajous,
	createMatrixRain as createBaseMatrixRain,
	createSpectrumBars as createBaseSpectrumBars,
	createStarfield as createBaseStarfield,
	createVortex as createBaseVortex,
	createWaterRipple as createBaseWaterRipple,
	renderDataRain as renderBaseDataRain,
	renderNoiseField as renderBaseNoiseField,
	renderOrbitArc as renderBaseOrbitArc,
	renderPlasma as renderBasePlasma,
	renderPulseMeter as renderBasePulseMeter,
	renderSynthgrid as renderBaseSynthgrid,
	renderWaveSweep as renderBaseWaveSweep,
} from "../../src/components/animation-primitives.js";
import { ArtifactViewer } from "../../src/components/artifact-viewer.js";
import { createBoids } from "../../src/components/anim_boids.js";
import { renderDataRain } from "../../src/components/anim_datarain.js";
import { createDoomFire } from "../../src/components/anim_doomfire.js";
import { createFlowField } from "../../src/components/anim_flowfield.js";
import { createGameOfLife } from "../../src/components/anim_gameoflife.js";
import { createGlyphCascade, renderGlyphCascadeDemo } from "../../src/components/anim_glyphcascade.js";
import { HelpOverlay } from "../../src/components/help-overlay.js";
import { createLaserScan } from "../../src/components/anim_laserscan.js";
import { createLissajous } from "../../src/components/anim_lissajous.js";
import { createMatrixRain } from "../../src/components/anim_matrixrain.js";
import { LogoBlockView } from "../../src/components/logo-block-view.js";
import { renderMenuBar, type MenuBarItem } from "../../src/components/menu-bar.js";
import { renderNoiseField } from "../../src/components/anim_noisefield.js";
import { renderOrbitArc } from "../../src/components/anim_orbitarc.js";
import { renderPlasma } from "../../src/components/anim_plasma.js";
import { createPulseMeterTracker, renderDualPulseMeter, renderPulseMeter } from "../../src/components/anim_pulsemeter.js";
import { FilterSelectOverlay } from "../../src/components/filter-select-overlay.js";
import { SessionStatsOverlay } from "../../src/components/session-stats-overlay.js";
import { SessionsPanel } from "../../src/components/sessions-panel.js";
import { type ShellMenuDefinition } from "../../src/components/shell-menu-overlay.js";
import { SideBySideContainer } from "../../src/components/side-by-side-container.js";
import { createSpectrumBars, renderSpectrumBarsStereo } from "../../src/components/anim_spectrumbars.js";
import { createStarfield } from "../../src/components/anim_starfield.js";
import { renderSynthgrid } from "../../src/components/anim_synthgrid.js";
import { TextPromptOverlay } from "../../src/components/text-prompt-overlay.js";
import { ThinkingTray } from "../../src/components/thinking-tray.js";
import { createVortex } from "../../src/components/anim_vortex.js";
import { createWaterRipple } from "../../src/components/anim_waterripple.js";
import { renderWaveSweep } from "../../src/components/anim_wavesweep.js";
import type { Artifact } from "../../src/types.js";
import type { ThemeConfig, ThemeName } from "../../src/themes/index.js";
import { agentTheme } from "../../src/theme.js";
import type { SessionInfo, SessionStats } from "../../src/local-coding-agent.js";

type ControlValue = number | boolean | string;
export type DemoControlValues = Record<string, ControlValue>;

export type DemoKind = "animation" | "component" | "overlay" | "primitive";

interface ControlBase {
	id: string;
	label: string;
	description?: string;
}

export interface NumberControl extends ControlBase {
	type: "number";
	defaultValue: number;
	min: number;
	max: number;
	step: number;
}

export interface BooleanControl extends ControlBase {
	type: "boolean";
	defaultValue: boolean;
}

export interface EnumControl extends ControlBase {
	type: "enum";
	defaultValue: string;
	options: string[];
}

export interface TextControl extends ControlBase {
	type: "text";
	defaultValue: string;
	placeholder?: string;
}

export type DemoControl = NumberControl | BooleanControl | EnumControl | TextControl;

export interface DemoPreset {
	id: string;
	label: string;
	values: DemoControlValues;
}

export interface DemoRuntime {
	render(width: number, height: number): string[];
	handleInput?(data: string): void;
	openOverlay?(): void;
	dispose?(): void;
	component?: Component;
}

export interface DemoRuntimeContext {
	tui: TUI;
	getAnimationState(): AnimationState;
	getTheme(): ThemeConfig;
	getThemeName(): ThemeName;
	openSelectOverlay(id: string, title: string, description: string): void;
	openTextPrompt(title: string, description: string, initialValue: string): void;
	openEditorPrompt(title: string, prefill: string): void;
	showOverlay(id: string, component: Component, options: OverlayOptions): void;
	openShellMenu(id: string, definition: ShellMenuDefinition): void;
	closeOverlay(id: string): void;
}

export interface DemoDefinition {
	id: string;
	title: string;
	category: string;
	sourceFile: string;
	kind: DemoKind;
	description: string;
	controls: DemoControl[];
	presets?: DemoPreset[];
	createRuntime(context: DemoRuntimeContext, values: DemoControlValues): DemoRuntime;
}

class ArrayTextComponent implements Component {
	constructor(private readonly lines: string[]) {}

	invalidate(): void {}

	render(): string[] {
		return this.lines;
	}
}

function numberControl(id: string, label: string, defaultValue: number, min: number, max: number, step: number, description?: string): NumberControl {
	return { id, label, type: "number", defaultValue, min, max, step, description };
}

function booleanControl(id: string, label: string, defaultValue: boolean, description?: string): BooleanControl {
	return { id, label, type: "boolean", defaultValue, description };
}

function enumControl(id: string, label: string, defaultValue: string, options: string[], description?: string): EnumControl {
	return { id, label, type: "enum", defaultValue, options, description };
}

function textControl(id: string, label: string, defaultValue: string, description?: string, placeholder?: string): TextControl {
	return { id, label, type: "text", defaultValue, description, placeholder };
}

function toLines(text: string): string[] {
	return text.split("\n");
}

function createRendererDemo(config: {
	id: string;
	title: string;
	category: string;
	sourceFile: string;
	kind?: DemoKind;
	description: string;
	controls: DemoControl[];
	presets?: DemoPreset[];
	buildRenderer: (values: DemoControlValues) => (animState: AnimationState, theme: ThemeConfig) => string;
}): DemoDefinition {
	return {
		id: config.id,
		title: config.title,
		category: config.category,
		sourceFile: config.sourceFile,
		kind: config.kind ?? "animation",
		description: config.description,
		controls: config.controls,
		presets: config.presets,
		createRuntime(context, values) {
			const renderer = config.buildRenderer(values);
			return {
				render() {
					return toLines(renderer(context.getAnimationState(), context.getTheme()));
				},
			};
		},
	};
}

function createComponentDemo(config: {
	id: string;
	title: string;
	category: string;
	sourceFile: string;
	description: string;
	controls: DemoControl[];
	presets?: DemoPreset[];
	buildComponent: (context: DemoRuntimeContext, values: DemoControlValues) => Component;
	openOverlay?: (context: DemoRuntimeContext, values: DemoControlValues) => void;
}): DemoDefinition {
	return {
		id: config.id,
		title: config.title,
		category: config.category,
		sourceFile: config.sourceFile,
		kind: "component",
		description: config.description,
		controls: config.controls,
		presets: config.presets,
		createRuntime(context, values) {
			const component = config.buildComponent(context, values);
			return {
				component,
				render(width) {
					return component.render(width);
				},
				handleInput(data) {
					(component as { handleInput?: (input: string) => void }).handleInput?.(data);
				},
				openOverlay: config.openOverlay ? () => config.openOverlay?.(context, values) : undefined,
			};
		},
	};
}

function createOverlayDemo(config: {
	id: string;
	title: string;
	sourceFile: string;
	description: string;
	controls: DemoControl[];
	presets?: DemoPreset[];
	openOverlay: (context: DemoRuntimeContext, values: DemoControlValues) => void;
}): DemoDefinition {
	return {
		id: config.id,
		title: config.title,
		category: "Overlays",
		sourceFile: config.sourceFile,
		kind: "overlay",
		description: config.description,
		controls: config.controls,
		presets: config.presets,
		createRuntime(context, values) {
			return {
				render(_width, height) {
					return [
						agentTheme.accentStrong("Overlay Preview"),
						"",
						agentTheme.text(config.description),
						"",
						agentTheme.dim("Use the inspector action row to open the live overlay."),
						agentTheme.dim("Press Esc to close overlays once opened."),
						"",
						agentTheme.dim(`Source: ${config.sourceFile}`),
						...Array.from({ length: Math.max(0, height - 8) }, () => ""),
					];
				},
				openOverlay() {
					config.openOverlay(context, values);
				},
			};
		},
	};
}

function defaultValuesFor(demo: DemoDefinition): DemoControlValues {
	const values: DemoControlValues = {};
	for (const control of demo.controls) {
		values[control.id] = control.defaultValue;
	}
	return values;
}

function sampleArtifacts(): Artifact[] {
	return [
		{
			id: "artifact-code",
			type: "code",
			title: "shell-view.ts",
			filePath: "src/shell-view.ts",
			language: "typescript",
			content: [
				"export class DefaultShellView {",
				"\trefresh(): void {",
				"\t\tthis.refreshChrome();",
				"\t\tthis.tui.requestRender();",
				"\t}",
				"}",
			].join("\n"),
		},
		{
			id: "artifact-diff",
			type: "diff",
			title: "styleguide.md",
			filePath: "styleguide.md",
			content: [
				"@@ -1,3 +1,7 @@",
				"+ ## Animation Presets",
				"+ - Plasma",
				"+ - Matrix Rain",
				"  ## Design Principles",
			].join("\n"),
		},
	];
}

function sampleHostState(): AgentHostState {
	return {
		model: {
			provider: "openai",
			id: "gpt-5.4-mini",
			name: "GPT-5.4 Mini",
			api: "openai-responses",
			baseUrl: "https://api.openai.com/v1",
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			maxTokens: 16_384,
			contextWindow: 200_000,
			reasoning: true,
		} as unknown as AgentHostState["model"],
		thinkingLevel: "high",
		isStreaming: false,
		isCompacting: false,
		steeringMode: "all",
		followUpMode: "all",
		sessionId: "style-lab-session",
		sessionName: "style-lab",
		autoCompactionEnabled: true,
		pendingMessageCount: 0,
		messageCount: 42,
	};
}

function sampleStats(): SessionStats {
	return {
		sessionFile: "sessions/style-lab.json",
		sessionId: "style-lab-session",
		userMessages: 12,
		assistantMessages: 19,
		toolCalls: 8,
		toolResults: 8,
		totalMessages: 39,
		tokens: {
			input: 18_500,
			output: 7_800,
			cacheRead: 1_200,
			cacheWrite: 700,
			total: 28_200,
		},
		cost: 0.0274,
	};
}

function sampleSessions(): SessionInfo[] {
	const now = Date.now();
	return [
		{ path: "sessions/current.json", name: "Current Session", created: new Date(now - 20 * 60 * 1000) } as SessionInfo,
		{ path: "sessions/theme-lab.json", name: "Theme Tweaks", created: new Date(now - 2 * 60 * 60 * 1000) } as SessionInfo,
		{ path: "sessions/overlay-pass.json", name: "Overlay Pass", created: new Date(now - 28 * 60 * 60 * 1000) } as SessionInfo,
		{ path: "sessions/animation-fire.json", name: "Doom Fire Notes", created: new Date(now - 4 * 24 * 60 * 60 * 1000) } as SessionInfo,
	] as SessionInfo[];
}

function sampleMenuDefinition(): ShellMenuDefinition {
	return {
		title: "Style Lab Menu",
		subtitle: "Curated demo actions",
		anchor: { row: 2, col: 4 },
		width: 34,
		childWidth: 30,
		items: [
			{
				kind: "action",
				id: "cycle-theme",
				label: "Cycle Theme",
				description: "Swap the active demo palette",
				onSelect: () => undefined,
			},
			{
				kind: "submenu",
				id: "animations",
				label: "Animation Presets",
				description: "Jump to animated demos",
				items: [
					{
						kind: "action",
						id: "plasma",
						label: "Plasma",
						onSelect: () => undefined,
					},
					{
						kind: "action",
						id: "matrix-rain",
						label: "Matrix Rain",
						onSelect: () => undefined,
					},
				],
			},
		],
	};
}

const baseAnimationDemos: DemoDefinition[] = [
	createRendererDemo({
		id: "base-glyph-cascade",
		title: "Base Glyph Cascade",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "The canonical glyph cascade preset.",
		controls: [
			numberControl("maxCount", "Max Count", 8, 2, 20, 1),
			numberControl("historyRows", "History Rows", 11, 3, 16, 1),
			numberControl("ticksPerStep", "Ticks / Step", 2, 1, 8, 1),
		],
		buildRenderer: (v) => createBaseGlyphCascade({
			maxCount: Number(v.maxCount),
			historyRows: Number(v.historyRows),
			ticksPerStep: Number(v.ticksPerStep),
		}),
	}),
	createRendererDemo({
		id: "base-pulse-meter",
		title: "Base Pulse Meter",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "The canonical progress meter preset.",
		controls: [
			numberControl("width", "Width", 24, 8, 48, 1),
			numberControl("value", "Value", 67, 0, 100, 1),
			textControl("label", "Label", "67%"),
		],
		buildRenderer: (v) => (animState, theme) =>
			renderBasePulseMeter(Number(v.value) / 100, animState, theme, {
				width: Number(v.width),
				label: String(v.label),
			}),
	}),
	createRendererDemo({
		id: "base-orbit-arc",
		title: "Base Orbit Arc",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "Spinner head with a simple trailing arc.",
		controls: [
			numberControl("trailLength", "Trail", 6, 2, 10, 1),
			textControl("label", "Label", "Processing"),
		],
		buildRenderer: (v) => (animState, theme) =>
			renderBaseOrbitArc(animState, theme, {
				trailLength: Number(v.trailLength),
				label: String(v.label),
			}),
	}),
	createRendererDemo({
		id: "base-data-rain",
		title: "Base Data Rain",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "Canonical grid-based data rain.",
		controls: [
			numberControl("cols", "Cols", 4, 2, 12, 1),
			numberControl("rows", "Rows", 3, 2, 8, 1),
			numberControl("refreshEveryN", "Refresh", 4, 1, 10, 1),
		],
		buildRenderer: (v) => (animState, theme) =>
			renderBaseDataRain(animState, theme, {
				cols: Number(v.cols),
				rows: Number(v.rows),
				refreshEveryN: Number(v.refreshEveryN),
			}),
	}),
	createRendererDemo({
		id: "base-wave-sweep",
		title: "Base Wave Sweep",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "Canonical wave interference sweep.",
		controls: [
			numberControl("width", "Width", 24, 8, 48, 1),
			numberControl("speed", "Speed", 0.5, 0.1, 2, 0.1),
			numberControl("sigma", "Sigma", 5, 1, 12, 0.5),
		],
		buildRenderer: (v) => (animState, theme) =>
			renderBaseWaveSweep(animState, theme, {
				width: Number(v.width),
				speed: Number(v.speed),
				sigma: Number(v.sigma),
			}),
	}),
	createRendererDemo({
		id: "base-plasma",
		title: "Base Plasma",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "Canonical plasma field renderer.",
		controls: [
			numberControl("width", "Width", 24, 12, 48, 1),
			numberControl("height", "Height", 8, 4, 16, 1),
			numberControl("freq", "Freq", 0.35, 0.1, 1, 0.05),
		],
		buildRenderer: (v) => (animState, theme) =>
			renderBasePlasma(animState, theme, {
				width: Number(v.width),
				height: Number(v.height),
				freq: Number(v.freq),
			}),
	}),
	createRendererDemo({
		id: "base-synthgrid",
		title: "Base Synthgrid",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "Canonical retro perspective grid.",
		controls: [
			numberControl("cols", "Cols", 36, 16, 60, 1),
			numberControl("rows", "Rows", 10, 6, 18, 1),
			numberControl("speed", "Speed", 0.4, 0.1, 1.2, 0.05),
		],
		buildRenderer: (v) => (animState, theme) =>
			renderBaseSynthgrid(animState, theme, {
				cols: Number(v.cols),
				rows: Number(v.rows),
				speed: Number(v.speed),
			}),
	}),
	createRendererDemo({
		id: "base-noise-field",
		title: "Base Noise Field",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "Canonical procedural noise field.",
		controls: [
			numberControl("cols", "Cols", 24, 12, 48, 1),
			numberControl("rows", "Rows", 8, 4, 16, 1),
			numberControl("octaves", "Octaves", 3, 1, 6, 1),
		],
		buildRenderer: (v) => (animState, theme) =>
			renderBaseNoiseField(animState, theme, {
				cols: Number(v.cols),
				rows: Number(v.rows),
			}),
	}),
	createRendererDemo({
		id: "base-doom-fire",
		title: "Base Doom Fire",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "Canonical stateful fire preset.",
		controls: [
			numberControl("width", "Width", 20, 12, 40, 1),
			numberControl("height", "Height", 8, 4, 16, 1),
			numberControl("coolingStrength", "Cooling", 0.15, 0.01, 0.5, 0.01),
		],
		buildRenderer: (v) => createBaseDoomFire({
			width: Number(v.width),
			height: Number(v.height),
			coolingStrength: Number(v.coolingStrength),
		}),
	}),
	createRendererDemo({
		id: "base-spectrum-bars",
		title: "Base Spectrum Bars",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "Canonical audio-bar visualization.",
		controls: [
			numberControl("cols", "Cols", 12, 4, 20, 1),
			numberControl("rows", "Rows", 6, 3, 12, 1),
			numberControl("speed", "Speed", 1, 0.2, 2, 0.1),
		],
		buildRenderer: (v) => createBaseSpectrumBars({
			cols: Number(v.cols),
			rows: Number(v.rows),
			speed: Number(v.speed),
		}),
	}),
	createRendererDemo({
		id: "base-starfield",
		title: "Base Starfield",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "Canonical particle starfield.",
		controls: [
			numberControl("cols", "Cols", 24, 12, 48, 1),
			numberControl("rows", "Rows", 8, 4, 16, 1),
			numberControl("count", "Stars", 80, 20, 140, 5),
		],
		buildRenderer: (v) => createBaseStarfield({
			cols: Number(v.cols),
			rows: Number(v.rows),
			count: Number(v.count),
		}),
	}),
	createRendererDemo({
		id: "base-vortex",
		title: "Base Vortex",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "Canonical vortex particle field.",
		controls: [
			numberControl("cols", "Cols", 24, 12, 40, 1),
			numberControl("rows", "Rows", 10, 6, 16, 1),
			numberControl("count", "Particles", 35, 10, 60, 1),
		],
		buildRenderer: (v) => createBaseVortex({
			cols: Number(v.cols),
			rows: Number(v.rows),
			count: Number(v.count),
		}),
	}),
	createRendererDemo({
		id: "base-boids",
		title: "Base Boids",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "Canonical boid flocking simulation.",
		controls: [
			numberControl("cols", "Cols", 28, 16, 50, 1),
			numberControl("rows", "Rows", 8, 4, 16, 1),
			numberControl("count", "Count", 25, 10, 50, 1),
		],
		buildRenderer: (v) => createBaseBoids({
			cols: Number(v.cols),
			rows: Number(v.rows),
			count: Number(v.count),
		}),
	}),
	createRendererDemo({
		id: "base-flow-field",
		title: "Base Flow Field",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "Canonical flow field particle simulation.",
		controls: [
			numberControl("cols", "Cols", 28, 16, 50, 1),
			numberControl("rows", "Rows", 8, 4, 16, 1),
			numberControl("count", "Particles", 40, 10, 70, 1),
		],
		buildRenderer: (v) => createBaseFlowField({
			cols: Number(v.cols),
			rows: Number(v.rows),
			count: Number(v.count),
		}),
	}),
	createRendererDemo({
		id: "base-game-of-life",
		title: "Base Game Of Life",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "Canonical cellular automata demo.",
		controls: [
			numberControl("cols", "Cols", 24, 12, 40, 1),
			numberControl("rows", "Rows", 8, 4, 16, 1),
			numberControl("density", "Density", 35, 5, 80, 1),
		],
		buildRenderer: (v) => createBaseGameOfLife({
			cols: Number(v.cols),
			rows: Number(v.rows),
			density: Number(v.density) / 100,
		}),
	}),
	createRendererDemo({
		id: "base-water-ripple",
		title: "Base Water Ripple",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "Canonical ripple simulation.",
		controls: [
			numberControl("cols", "Cols", 24, 12, 40, 1),
			numberControl("rows", "Rows", 8, 4, 16, 1),
			numberControl("damping", "Damping", 0.98, 0.8, 0.999, 0.005),
		],
		buildRenderer: (v) => createBaseWaterRipple({
			cols: Number(v.cols),
			rows: Number(v.rows),
			damping: Number(v.damping),
		}),
	}),
	createRendererDemo({
		id: "base-matrix-rain",
		title: "Base Matrix Rain",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "Canonical matrix rain preset.",
		controls: [
			numberControl("cols", "Cols", 12, 6, 24, 1),
			numberControl("rows", "Rows", 8, 4, 16, 1),
			numberControl("charDensity", "Density", 100, 20, 100, 5),
		],
		buildRenderer: (v) => createBaseMatrixRain({
			cols: Number(v.cols),
			rows: Number(v.rows),
		}),
	}),
	createRendererDemo({
		id: "base-laser-scan",
		title: "Base Laser Scan",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "Canonical sweeping scanline renderer.",
		controls: [
			numberControl("cols", "Cols", 28, 12, 50, 1),
			numberControl("rows", "Rows", 6, 4, 12, 1),
			numberControl("beamWidth", "Beam Width", 5, 1, 12, 1),
		],
		buildRenderer: (v) => createBaseLaserScan({
			cols: Number(v.cols),
			rows: Number(v.rows),
			beamWidth: Number(v.beamWidth),
		}),
	}),
	createRendererDemo({
		id: "base-lissajous",
		title: "Base Lissajous",
		category: "Animations",
		sourceFile: "src/components/animation-primitives.ts",
		description: "Canonical parametric curve renderer.",
		controls: [
			numberControl("cols", "Cols", 24, 12, 40, 1),
			numberControl("rows", "Rows", 12, 6, 18, 1),
			numberControl("a", "A", 3, 1, 6, 1),
			numberControl("b", "B", 2, 1, 6, 1),
		],
		buildRenderer: (v) => createBaseLissajous({
			cols: Number(v.cols),
			rows: Number(v.rows),
			a: Number(v.a),
			b: Number(v.b),
		}),
	}),
];
const enhancedAnimationDemos: DemoDefinition[] = [
	createRendererDemo({
		id: "enhanced-glyph-cascade",
		title: "Enhanced Glyph Cascade",
		category: "Animations",
		sourceFile: "src/components/anim_glyphcascade.ts",
		description: "Directional cascade with seeded randomness and multi-row mode.",
		controls: [
			numberControl("maxCount", "Max Count", 12, 3, 24, 1),
			enumControl("direction", "Direction", "alternate", ["up", "down", "alternate"]),
			booleanControl("multiRow", "Multi Row", true),
			booleanControl("seeded", "Seeded", true),
		],
		presets: [
			{ id: "demo", label: "Demo Preset", values: { maxCount: 12, direction: "alternate", multiRow: true, seeded: true } },
		],
		buildRenderer: (v) => createGlyphCascade({
			maxCount: Number(v.maxCount),
			direction: String(v.direction) as "up" | "down" | "alternate",
			multiRow: Boolean(v.multiRow),
			seeded: Boolean(v.seeded),
			rowHeight: 2,
		}),
	}),
	createRendererDemo({
		id: "glyph-cascade-demo-helper",
		title: "Glyph Cascade Demo Helper",
		category: "Animations",
		sourceFile: "src/components/anim_glyphcascade.ts",
		description: "The built-in demo helper exported by the enhanced glyph cascade module.",
		controls: [],
		buildRenderer: () => (animState, theme) => renderGlyphCascadeDemo(theme, animState),
	}),
	createRendererDemo({
		id: "enhanced-pulse-meter",
		title: "Enhanced Pulse Meter",
		category: "Animations",
		sourceFile: "src/components/anim_pulsemeter.ts",
		description: "Segment modes, orientations, and peak-hold tracking.",
		controls: [
			numberControl("width", "Width", 24, 8, 40, 1),
			numberControl("value", "Value", 74, 0, 100, 1),
			enumControl("segmentMode", "Segments", "gradient", ["smooth", "discrete", "gradient"]),
			enumControl("orientation", "Orientation", "left", ["left", "right", "center"]),
			booleanControl("peakHold", "Peak Hold", true),
		],
		buildRenderer: (v) => {
			const tracker = createPulseMeterTracker();
			return (animState, theme) => {
				const value = Number(v.value) / 100;
				const peak = Boolean(v.peakHold) ? tracker.update(value, 24) : value;
				return `${renderPulseMeter(value, animState, theme, {
					width: Number(v.width),
					segmentMode: String(v.segmentMode) as "smooth" | "discrete" | "gradient",
					orientation: String(v.orientation) as "left" | "right" | "center",
					peakHold: Boolean(v.peakHold),
				})}\n${agentTheme.dim(`Peak ${Math.round(peak * 100)}%`)}`;
			};
		},
	}),
	createRendererDemo({
		id: "dual-pulse-meter",
		title: "Dual Pulse Meter",
		category: "Animations",
		sourceFile: "src/components/anim_pulsemeter.ts",
		description: "Stereo pair using the enhanced meter renderer.",
		controls: [
			numberControl("leftValue", "Left", 45, 0, 100, 1),
			numberControl("rightValue", "Right", 80, 0, 100, 1),
			numberControl("width", "Width", 10, 6, 20, 1),
		],
		buildRenderer: (v) => (animState, theme) =>
			renderDualPulseMeter(Number(v.leftValue) / 100, Number(v.rightValue) / 100, animState, theme, {
				width: Number(v.width),
				segmentMode: "gradient",
			}),
	}),
	createRendererDemo({
		id: "enhanced-orbit-arc",
		title: "Enhanced Orbit Arc",
		category: "Animations",
		sourceFile: "src/components/anim_orbitarc.ts",
		description: "Trail styles and orbital variants.",
		controls: [
			numberControl("trailLength", "Trail", 6, 2, 8, 1),
			enumControl("trailStyle", "Trail Style", "gradient", ["dots", "line", "dashed", "gradient"]),
			enumControl("orbitType", "Orbit Type", "circular", ["circular", "elliptical", "figure8"]),
			booleanControl("reverse", "Reverse", false),
		],
		buildRenderer: (v) => (animState, theme) =>
			renderOrbitArc(animState, theme, {
				trailLength: Number(v.trailLength),
				trailStyle: String(v.trailStyle) as "dots" | "line" | "dashed" | "gradient",
				orbitType: String(v.orbitType) as "circular" | "elliptical" | "figure8",
				reverse: Boolean(v.reverse),
			}),
	}),
	createRendererDemo({
		id: "enhanced-data-rain",
		title: "Enhanced Data Rain",
		category: "Animations",
		sourceFile: "src/components/anim_datarain.ts",
		description: "Glyph-set variants and seeded randomness.",
		controls: [
			numberControl("cols", "Cols", 6, 2, 12, 1),
			numberControl("rows", "Rows", 4, 2, 10, 1),
			enumControl("glyphSet", "Glyph Set", "katakana", ["default", "hex", "binary", "katakana", "symbols"]),
			booleanControl("seeded", "Seeded", false),
		],
		buildRenderer: (v) => (animState, theme) =>
			renderDataRain(animState, theme, {
				cols: Number(v.cols),
				rows: Number(v.rows),
				glyphSet: String(v.glyphSet) as "default" | "hex" | "binary" | "katakana" | "symbols",
				seeded: Boolean(v.seeded),
			}),
	}),
	createRendererDemo({
		id: "enhanced-wave-sweep",
		title: "Enhanced Wave Sweep",
		category: "Animations",
		sourceFile: "src/components/anim_wavesweep.ts",
		description: "Multiple superposed waves with interference control.",
		controls: [
			numberControl("width", "Width", 24, 8, 48, 1),
			numberControl("waveCount", "Waves", 3, 1, 5, 1),
			enumControl("interference", "Interference", "add", ["add", "multiply", "max"]),
			numberControl("damping", "Damping", 0.3, 0, 1, 0.05),
		],
		buildRenderer: (v) => (animState, theme) =>
			renderWaveSweep(animState, theme, {
				width: Number(v.width),
				waveCount: Number(v.waveCount),
				interference: String(v.interference) as "add" | "multiply" | "max",
				damping: Number(v.damping),
			}),
	}),
	createRendererDemo({
		id: "enhanced-plasma",
		title: "Enhanced Plasma",
		category: "Animations",
		sourceFile: "src/components/anim_plasma.ts",
		description: "Palette cycling and frequency modulation.",
		controls: [
			numberControl("width", "Width", 24, 12, 48, 1),
			numberControl("height", "Height", 8, 4, 16, 1),
			enumControl("palette", "Palette", "ocean", ["default", "fire", "ocean", "toxic"]),
			booleanControl("colorCycle", "Color Cycle", true),
		],
		buildRenderer: (v) => (animState, theme) =>
			renderPlasma(animState, theme, {
				width: Number(v.width),
				height: Number(v.height),
				palette: String(v.palette) as "default" | "fire" | "ocean" | "toxic",
				colorCycle: Boolean(v.colorCycle),
			}),
	}),
	createRendererDemo({
		id: "enhanced-synthgrid",
		title: "Enhanced Synthgrid",
		category: "Animations",
		sourceFile: "src/components/anim_synthgrid.ts",
		description: "Animated vanishing point and perspective controls.",
		controls: [
			numberControl("cols", "Cols", 36, 16, 60, 1),
			numberControl("rows", "Rows", 10, 6, 18, 1),
			numberControl("numVLines", "V-Lines", 7, 3, 12, 1),
			booleanControl("animateVanishingPoint", "Animate VP", true),
		],
		buildRenderer: (v) => (animState, theme) =>
			renderSynthgrid(animState, theme, {
				cols: Number(v.cols),
				rows: Number(v.rows),
				numVLines: Number(v.numVLines),
				animateVanishingPoint: Boolean(v.animateVanishingPoint),
			}),
	}),
	createRendererDemo({
		id: "enhanced-noise-field",
		title: "Enhanced Noise Field",
		category: "Animations",
		sourceFile: "src/components/anim_noisefield.ts",
		description: "FBM palette control with optional flow integration.",
		controls: [
			numberControl("cols", "Cols", 24, 12, 48, 1),
			numberControl("rows", "Rows", 8, 4, 16, 1),
			numberControl("octaves", "Octaves", 3, 1, 6, 1),
			enumControl("palette", "Palette", "default", ["default", "fire", "ice", "toxic"]),
			booleanControl("flowIntegration", "Flow", false),
		],
		buildRenderer: (v) => (animState, theme) =>
			renderNoiseField(animState, theme, {
				cols: Number(v.cols),
				rows: Number(v.rows),
				octaves: Number(v.octaves),
				palette: String(v.palette) as "default" | "fire" | "ice" | "toxic",
				flowIntegration: Boolean(v.flowIntegration),
			}),
	}),
	createRendererDemo({
		id: "enhanced-doom-fire",
		title: "Enhanced Doom Fire",
		category: "Animations",
		sourceFile: "src/components/anim_doomfire.ts",
		description: "Palette, cooling pattern, and wind controls.",
		controls: [
			numberControl("width", "Width", 20, 12, 40, 1),
			numberControl("height", "Height", 8, 4, 16, 1),
			enumControl("colorMapping", "Palette", "electric", ["default", "electric", "lava", "plasma"]),
			enumControl("coolingPattern", "Cooling Pattern", "random", ["random", "wave", "radial", "edge"]),
			numberControl("windDirection", "Wind", 1, -1, 1, 1),
		],
		buildRenderer: (v) => createDoomFire({
			width: Number(v.width),
			height: Number(v.height),
			colorMapping: String(v.colorMapping) as "default" | "electric" | "lava" | "plasma",
			coolingPattern: String(v.coolingPattern) as "random" | "wave" | "radial" | "edge",
			windDirection: Number(v.windDirection) as -1 | 0 | 1,
		}),
	}),
	createRendererDemo({
		id: "enhanced-spectrum-bars",
		title: "Enhanced Spectrum Bars",
		category: "Animations",
		sourceFile: "src/components/anim_spectrumbars.ts",
		description: "Peak-hold and stereo variants.",
		controls: [
			numberControl("cols", "Cols", 12, 4, 20, 1),
			numberControl("rows", "Rows", 6, 3, 12, 1),
			booleanControl("peakHold", "Peak Hold", true),
		],
		buildRenderer: (v) => createSpectrumBars({
			cols: Number(v.cols),
			rows: Number(v.rows),
			peakHold: Boolean(v.peakHold),
		}),
	}),
	createRendererDemo({
		id: "stereo-spectrum-bars",
		title: "Stereo Spectrum Bars",
		category: "Animations",
		sourceFile: "src/components/anim_spectrumbars.ts",
		description: "Stereo helper exported from the enhanced spectrum module.",
		controls: [
			numberControl("cols", "Cols", 6, 4, 12, 1),
			numberControl("rows", "Rows", 6, 3, 12, 1),
		],
		buildRenderer: (v) => (animState, theme) =>
			renderSpectrumBarsStereo(animState, theme, {
				cols: Number(v.cols),
				rows: Number(v.rows),
			}),
	}),
	createRendererDemo({
		id: "enhanced-starfield",
		title: "Enhanced Starfield",
		category: "Animations",
		sourceFile: "src/components/anim_starfield.ts",
		description: "Comet tails and depth-of-field.",
		controls: [
			numberControl("cols", "Cols", 24, 12, 48, 1),
			numberControl("rows", "Rows", 8, 4, 16, 1),
			numberControl("count", "Stars", 80, 20, 140, 5),
			booleanControl("cometTail", "Comet Tail", true),
		],
		buildRenderer: (v) => createStarfield({
			cols: Number(v.cols),
			rows: Number(v.rows),
			count: Number(v.count),
			cometTail: Boolean(v.cometTail),
		}),
	}),
	createRendererDemo({
		id: "enhanced-vortex",
		title: "Enhanced Vortex",
		category: "Animations",
		sourceFile: "src/components/anim_vortex.ts",
		description: "Spawn patterns and magnetic field behavior.",
		controls: [
			numberControl("cols", "Cols", 24, 12, 40, 1),
			numberControl("rows", "Rows", 10, 6, 16, 1),
			enumControl("spawnPattern", "Spawn", "spiral", ["random", "ring", "spiral", "burst"]),
			booleanControl("magneticField", "Magnetic", false),
		],
		buildRenderer: (v) => createVortex({
			cols: Number(v.cols),
			rows: Number(v.rows),
			spawnPattern: String(v.spawnPattern) as "random" | "ring" | "spiral" | "burst",
			magneticField: Boolean(v.magneticField),
		}),
	}),
	createRendererDemo({
		id: "enhanced-boids",
		title: "Enhanced Boids",
		category: "Animations",
		sourceFile: "src/components/anim_boids.ts",
		description: "Predator mode and boundary behaviors.",
		controls: [
			numberControl("cols", "Cols", 28, 16, 50, 1),
			numberControl("rows", "Rows", 8, 4, 16, 1),
			numberControl("count", "Boids", 25, 10, 50, 1),
			enumControl("boundaryBehavior", "Boundary", "wrap", ["wrap", "bounce", "restrict"]),
			booleanControl("predatorEnabled", "Predator", false),
		],
		buildRenderer: (v) => createBoids({
			cols: Number(v.cols),
			rows: Number(v.rows),
			count: Number(v.count),
			boundaryBehavior: String(v.boundaryBehavior) as "wrap" | "bounce" | "restrict",
			predatorEnabled: Boolean(v.predatorEnabled),
		}),
	}),
	createRendererDemo({
		id: "enhanced-flow-field",
		title: "Enhanced Flow Field",
		category: "Animations",
		sourceFile: "src/components/anim_flowfield.ts",
		description: "Particle inertia, curl, and turbulence.",
		controls: [
			numberControl("cols", "Cols", 28, 16, 50, 1),
			numberControl("rows", "Rows", 8, 4, 16, 1),
			numberControl("count", "Particles", 40, 10, 70, 1),
			numberControl("turbulence", "Turbulence", 0.1, 0, 1, 0.05),
			numberControl("curlStrength", "Curl", 0, 0, 1, 0.05),
		],
		buildRenderer: (v) => createFlowField({
			cols: Number(v.cols),
			rows: Number(v.rows),
			count: Number(v.count),
			turbulence: Number(v.turbulence),
			curlStrength: Number(v.curlStrength),
		}),
	}),
	createRendererDemo({
		id: "enhanced-game-of-life",
		title: "Enhanced Game Of Life",
		category: "Animations",
		sourceFile: "src/components/anim_gameoflife.ts",
		description: "Rule-string parsing and cell aging.",
		controls: [
			numberControl("cols", "Cols", 24, 12, 40, 1),
			numberControl("rows", "Rows", 8, 4, 16, 1),
			textControl("rule", "Rule", "B3/S23"),
			booleanControl("cellAging", "Cell Aging", true),
		],
		buildRenderer: (v) => createGameOfLife({
			cols: Number(v.cols),
			rows: Number(v.rows),
			rule: String(v.rule),
			cellAging: Boolean(v.cellAging),
		}),
	}),
	createRendererDemo({
		id: "enhanced-water-ripple",
		title: "Enhanced Water Ripple",
		category: "Animations",
		sourceFile: "src/components/anim_waterripple.ts",
		description: "Multiple raindrops and reflection controls.",
		controls: [
			numberControl("cols", "Cols", 24, 12, 40, 1),
			numberControl("rows", "Rows", 8, 4, 16, 1),
			booleanControl("multipleDrops", "Multiple Drops", true),
			booleanControl("reflectionEnabled", "Reflections", true),
		],
		buildRenderer: (v) => createWaterRipple({
			cols: Number(v.cols),
			rows: Number(v.rows),
			multipleDrops: Boolean(v.multipleDrops),
			reflectionEnabled: Boolean(v.reflectionEnabled),
		}),
	}),
	createRendererDemo({
		id: "enhanced-matrix-rain",
		title: "Enhanced Matrix Rain",
		category: "Animations",
		sourceFile: "src/components/anim_matrixrain.ts",
		description: "Glyph density, fade modes, and brightness gradients.",
		controls: [
			numberControl("cols", "Cols", 12, 6, 24, 1),
			numberControl("rows", "Rows", 8, 4, 16, 1),
			enumControl("glyphSet", "Glyph Set", "katakana", ["katakana", "hex", "binary", "mixed", "fullwidth"]),
			enumControl("fadeMode", "Fade", "gradient", ["solid", "gradient", "sharp"]),
		],
		buildRenderer: (v) => createMatrixRain({
			cols: Number(v.cols),
			rows: Number(v.rows),
			glyphSet: String(v.glyphSet) as "katakana" | "hex" | "binary" | "mixed" | "fullwidth",
			fadeMode: String(v.fadeMode) as "solid" | "gradient" | "sharp",
		}),
	}),
	createRendererDemo({
		id: "enhanced-laser-scan",
		title: "Enhanced Laser Scan",
		category: "Animations",
		sourceFile: "src/components/anim_laserscan.ts",
		description: "Beam styles, reflection passes, and reverse scanning.",
		controls: [
			numberControl("cols", "Cols", 28, 12, 50, 1),
			numberControl("rows", "Rows", 6, 4, 12, 1),
			enumControl("beamStyle", "Beam Style", "gaussian", ["gaussian", "sharp", "sine"]),
			numberControl("beamCount", "Beams", 2, 1, 4, 1),
			booleanControl("reverseScan", "Reverse", false),
		],
		buildRenderer: (v) => createLaserScan({
			cols: Number(v.cols),
			rows: Number(v.rows),
			beamStyle: String(v.beamStyle) as "gaussian" | "sharp" | "sine",
			beamCount: Number(v.beamCount),
			reverseScan: Boolean(v.reverseScan),
		}),
	}),
	createRendererDemo({
		id: "enhanced-lissajous",
		title: "Enhanced Lissajous",
		category: "Animations",
		sourceFile: "src/components/anim_lissajous.ts",
		description: "3D projection and resonance controls.",
		controls: [
			numberControl("cols", "Cols", 24, 12, 40, 1),
			numberControl("rows", "Rows", 12, 6, 18, 1),
			numberControl("a", "A", 3, 1, 6, 1),
			numberControl("b", "B", 2, 1, 6, 1),
			booleanControl("threeDimensional", "3D", false),
		],
		buildRenderer: (v) => createLissajous({
			cols: Number(v.cols),
			rows: Number(v.rows),
			a: Number(v.a),
			b: Number(v.b),
			threeDimensional: Boolean(v.threeDimensional),
		}),
	}),
];
const primitiveDemos: DemoDefinition[] = [
	createComponentDemo({
		id: "style-primitives",
		title: "Style Primitives",
		category: "Primitives",
		sourceFile: "src/components/style-primitives.ts",
		description: "Box lines and animated separators using shared ANSI helpers.",
		controls: [
			numberControl("width", "Width", 36, 16, 60, 1),
			textControl("left", "Left", " Demo Surface "),
			textControl("right", "Right", " 80x24 "),
		],
		buildComponent: (_context, values) =>
			new ArrayTextComponent([
				renderBoxLine(String(values.left), String(values.right), Number(values.width), "═", agentTheme.accent, agentTheme.dim),
				renderSeparator(Number(values.width), 4, agentTheme.border),
				renderBoxLine("╭", "╮", Number(values.width), "─", agentTheme.dim, agentTheme.dim),
				renderBoxLine("│ style helpers", "live", Number(values.width), " ", undefined, agentTheme.dim),
				renderBoxLine("╰", "╯", Number(values.width), "─", agentTheme.dim, agentTheme.dim),
			]),
	}),
];

const componentDemos: DemoDefinition[] = [
	createComponentDemo({
		id: "menu-bar",
		title: "Menu Bar",
		category: "Components",
		sourceFile: "src/components/menu-bar.ts",
		description: "Top chrome bar using the existing menu-bar renderer.",
		controls: [
			numberControl("width", "Width", 64, 24, 96, 1),
			textControl("labelA", "Item A", "Library"),
			textControl("labelB", "Item B", "Overlays"),
		],
		buildComponent: (_context, values) => {
			const items: MenuBarItem[] = [
				{ key: "F1", label: String(values.labelA) },
				{ key: "F2", label: String(values.labelB) },
				{ key: "F3", label: "Themes" },
			];
			return new ArrayTextComponent([
				renderMenuBar(items, Number(values.width), agentTheme.accent, agentTheme.dim, agentTheme.muted, agentTheme.dim),
			]);
		},
	}),
	createComponentDemo({
		id: "logo-block",
		title: "Logo Block",
		category: "Components",
		sourceFile: "src/components/logo-block-view.ts",
		description: "Logo dissolve animation using the production component.",
		controls: [
			numberControl("progress", "Progress", 30, 0, 42, 1),
			numberControl("totalSteps", "Total Steps", 42, 10, 64, 1),
		],
		buildComponent: (_context, values) =>
			new LogoBlockView(() => ({
				progress: Number(values.progress),
				totalSteps: Number(values.totalSteps),
			})),
	}),
	createComponentDemo({
		id: "thinking-tray",
		title: "Thinking Tray",
		category: "Components",
		sourceFile: "src/components/thinking-tray.ts",
		description: "Expandable reasoning tray with markdown rendering.",
		controls: [
			booleanControl("enabled", "Enabled", true),
			textControl("text", "Text", "Evaluating a new border cadence.\n\n- tune palette\n- check scroll behavior"),
		],
		buildComponent: (_context, values) => {
			const tray = new ThinkingTray();
			tray.setEnabled(Boolean(values.enabled));
			tray.setThinkingText(String(values.text));
			return tray;
		},
	}),
	createComponentDemo({
		id: "side-by-side",
		title: "Side By Side Container",
		category: "Components",
		sourceFile: "src/components/side-by-side-container.ts",
		description: "Three-state preview of the shared split container.",
		controls: [
			numberControl("rightWidth", "Right Width", 22, 10, 30, 1),
			booleanControl("wipe", "Wipe", false),
		],
		buildComponent: (_context, values) => {
			const left = new ArrayTextComponent([
				agentTheme.accentStrong("Preview"),
				"",
				agentTheme.text("The left side tracks the active demo output."),
				agentTheme.dim("It reuses the same shared split container as the app shell."),
			]);
			const right = new ArrayTextComponent([
				agentTheme.accentStrong("Inspector"),
				"",
				agentTheme.text("The right side is a fixed-width rail."),
				agentTheme.dim("Toggle wipe to force the transition fill path."),
			]);
			const split = new SideBySideContainer(left, right, Number(values.rightWidth));
			if (Boolean(values.wipe)) {
				split.wipeChar = "▓";
				split.maxHeight = 10;
			}
			return split;
		},
	}),
	createComponentDemo({
		id: "sessions-panel",
		title: "Sessions Panel",
		category: "Components",
		sourceFile: "src/components/sessions-panel.ts",
		description: "Fixture-backed panel using the production sessions component.",
		controls: [],
		buildComponent: () =>
			new SessionsPanel({
				getSessions: async () => sampleSessions(),
				getCurrentSessionFile: () => "sessions/current.json",
				onSwitch: async () => undefined,
				onClose: () => undefined,
			}),
	}),
];

const overlayDemos: DemoDefinition[] = [
	createOverlayDemo({
		id: "overlay-filter-select",
		title: "Filter Select Overlay",
		sourceFile: "src/components/filter-select-overlay.ts",
		description: "Searchable list overlay with keyboard and mouse support.",
		controls: [],
		openOverlay: (context) => {
			context.showOverlay(
				"styletest-filter",
				new FilterSelectOverlay(
					"Overlay Test",
					"Search the available demo presets.",
					[
						{ value: "plasma", label: "Plasma", description: "Animated scalar field" },
						{ value: "matrix", label: "Matrix Rain", description: "Glyph columns" },
						{ value: "shell", label: "Shell Menu", description: "Nested overlay" },
					],
					() => undefined,
					() => context.closeOverlay("styletest-filter"),
				),
				{ width: 72, maxHeight: 14, anchor: "center", margin: 1 },
			);
		},
	}),
	createOverlayDemo({
		id: "overlay-text-prompt",
		title: "Text Prompt Overlay",
		sourceFile: "src/components/text-prompt-overlay.ts",
		description: "Production text prompt overlay used for inline edits.",
		controls: [
			textControl("initialValue", "Initial Value", "Arc Reactor"),
		],
		openOverlay: (context, values) => {
			context.showOverlay(
				"styletest-text-prompt",
				new TextPromptOverlay(
					"Prompt Overlay",
					"Editing demo text uses the same overlay component.",
					() => context.closeOverlay("styletest-text-prompt"),
					() => context.closeOverlay("styletest-text-prompt"),
					String(values.initialValue),
				),
				{ width: 72, maxHeight: 8, anchor: "center", margin: 1 },
			);
		},
	}),
	createOverlayDemo({
		id: "overlay-help",
		title: "Help Overlay",
		sourceFile: "src/components/help-overlay.ts",
		description: "Scrollable keybinding help overlay.",
		controls: [],
		openOverlay: (context) => {
			context.showOverlay("styletest-help", new HelpOverlay(() => context.closeOverlay("styletest-help")), {
				width: "80%",
				maxHeight: "70%",
				anchor: "center",
				margin: 1,
			});
		},
	}),
	createOverlayDemo({
		id: "overlay-shell-menu",
		title: "Shell Menu Overlay",
		sourceFile: "src/components/shell-menu-overlay.ts",
		description: "Nested shell-style overlay menu.",
		controls: [],
		openOverlay: (context) => {
			context.openShellMenu("styletest-shell-menu", sampleMenuDefinition());
		},
	}),
	createOverlayDemo({
		id: "overlay-session-stats",
		title: "Session Stats Overlay",
		sourceFile: "src/components/session-stats-overlay.ts",
		description: "Session metadata overlay rendered with fixture host stats.",
		controls: [],
		openOverlay: (context) => {
			context.showOverlay(
				"styletest-session-stats",
				new SessionStatsOverlay(sampleStats(), sampleHostState(), "codex/stylelab", () => context.closeOverlay("styletest-session-stats")),
				{ width: 72, maxHeight: "80%", anchor: "center", margin: 1 },
			);
		},
	}),
	createOverlayDemo({
		id: "overlay-artifact-viewer",
		title: "Artifact Viewer Overlay",
		sourceFile: "src/components/artifact-viewer.ts",
		description: "Artifact overlay with fixture code and diff output.",
		controls: [],
		openOverlay: (context) => {
			context.showOverlay(
				"styletest-artifacts",
				new ArtifactViewer(sampleArtifacts(), () => context.closeOverlay("styletest-artifacts")),
				{ width: "80%", maxHeight: "75%", anchor: "center", margin: 1 },
			);
		},
	}),
	createOverlayDemo({
		id: "overlay-editor",
		title: "Editor Overlay",
		sourceFile: "src/components/editor-overlay.ts",
		description: "Full editor overlay using the production prompt editor.",
		controls: [
			textControl("prefill", "Prefill", "const theme = cycleTheme(activeTheme);"),
		],
		openOverlay: (context, values) => {
			context.openEditorPrompt("Editor Overlay", String(values.prefill));
		},
	}),
];

const allDemos = [...baseAnimationDemos, ...enhancedAnimationDemos, ...primitiveDemos, ...componentDemos, ...overlayDemos];

export function getDemoRegistry(): DemoDefinition[] {
	return allDemos;
}

export function getDefaultDemoId(): string {
	return allDemos[0]?.id ?? "";
}

export function getDefaultDemoValues(demoId: string): DemoControlValues {
	return defaultValuesFor(getDemoById(demoId));
}

export function getDemoById(demoId: string): DemoDefinition {
	const demo = allDemos.find((entry) => entry.id === demoId);
	if (!demo) {
		throw new Error(`Unknown style-test demo: ${demoId}`);
	}
	return demo;
}
