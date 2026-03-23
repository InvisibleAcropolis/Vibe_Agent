import { AnimationEngine } from "../animation-engine.js";
import type {
	StyleTestControl,
	StyleTestControlValues,
	StyleTestDemoDefinition,
	StyleTestRuntime,
	StyleTestRuntimeContext,
} from "../style-test-contract.js";

export interface AnimPreloadTarget {
	sourceFile: string;
	exportName: string;
	presetId: string;
	instanceId: string;
}

interface AnimPreloadEntry {
	target: AnimPreloadTarget;
	demo?: StyleTestDemoDefinition;
	engine: AnimationEngine;
	context: StyleTestRuntimeContext;
	baseValues: StyleTestControlValues;
	runtime?: StyleTestRuntime;
	lastCols?: number;
	lastRows?: number;
	error?: string;
}

function defaultValueForControl(control: StyleTestControl): string | number | boolean {
	return control.defaultValue;
}

function resolveDemoValues(demo: StyleTestDemoDefinition, presetId: string): StyleTestControlValues {
	if (demo.loadValues) {
		return demo.loadValues(presetId);
	}
	if (demo.initialValues) {
		return { ...demo.initialValues };
	}
	return Object.fromEntries(demo.controls.map((control) => [control.id, defaultValueForControl(control)]));
}

function keyForTarget(target: AnimPreloadTarget): string {
	return `${target.sourceFile}#${target.exportName}#${target.presetId}#${target.instanceId}`;
}

export class AnimPreloadService {
	private readonly entries = new Map<string, AnimPreloadEntry>();

	getOrCreateInstance(target: AnimPreloadTarget, hostContext: StyleTestRuntimeContext): string {
		const key = keyForTarget(target);
		if (!this.entries.has(key)) {
			this.entries.set(key, this.createEntry(target, hostContext));
		}
		return key;
	}

	renderInstance(handle: string, cols: number, rows: number): string[] {
		const entry = this.entries.get(handle);
		if (!entry) {
			throw new Error(`Unknown animpreload handle: ${handle}`);
		}
		if (!entry.demo) {
			throw new Error(entry.error ?? "Animation target could not be resolved.");
		}
		if (!entry.runtime || entry.lastCols !== cols || entry.lastRows !== rows) {
			entry.runtime?.dispose?.();
			entry.runtime = this.createRuntime(entry, cols, rows);
			entry.lastCols = cols;
			entry.lastRows = rows;
		}
		return entry.runtime.render(cols, rows);
	}

	disposeAll(): void {
		for (const entry of this.entries.values()) {
			entry.runtime?.dispose?.();
			entry.engine.stop();
		}
		this.entries.clear();
	}

	private createEntry(target: AnimPreloadTarget, hostContext: StyleTestRuntimeContext): AnimPreloadEntry {
		const demo = hostContext.resolveStyleDemo(target.sourceFile, target.exportName);
		const engine = new AnimationEngine();
		engine.start();
		const context: StyleTestRuntimeContext = {
			tui: hostContext.tui,
			getAnimationState: () => engine.getState(),
			getTheme: () => hostContext.getTheme(),
			getThemeName: () => hostContext.getThemeName(),
			resolveStyleDemo: (sourceFile, exportName) => hostContext.resolveStyleDemo(sourceFile, exportName),
			listStyleDemos: () => hostContext.listStyleDemos(),
			setControlValue: () => undefined,
			openSelectOverlay: () => undefined,
			openTextPrompt: () => undefined,
			openEditorPrompt: () => undefined,
			showOverlay: () => undefined,
			openShellMenu: () => undefined,
			closeOverlay: () => undefined,
		};

		if (!demo) {
			return {
				target,
				engine,
				context,
				baseValues: {},
				error: `Animation target not found: ${target.sourceFile}#${target.exportName}`,
			};
		}

		let baseValues: StyleTestControlValues;
		try {
			baseValues = resolveDemoValues(demo, target.presetId);
		} catch {
			baseValues = resolveDemoValues(demo, "default");
		}

		return {
			target,
			demo,
			engine,
			context,
			baseValues,
		};
	}

	private createRuntime(entry: AnimPreloadEntry, cols: number, rows: number): StyleTestRuntime {
		const demo = entry.demo;
		if (!demo) {
			throw new Error(entry.error ?? "Animation target could not be resolved.");
		}
		const values: StyleTestControlValues = {
			...entry.baseValues,
		};
		if (demo.controls.some((control) => control.id === "cols")) {
			values.cols = cols;
		}
		if (demo.controls.some((control) => control.id === "rows")) {
			values.rows = rows;
		}
		return demo.createRuntime(entry.context, values);
	}
}

export const animPreloadService = new AnimPreloadService();
