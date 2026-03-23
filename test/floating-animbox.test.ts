import assert from "node:assert";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { TUI } from "@mariozechner/pi-tui";
import { createFloatingAnimBoxWindow, DEFAULT_FLOATING_ANIMBOX_PRESET, FloatingAnimBoxContent, type FloatingAnimBoxPreset } from "../src/components/floating_animbox.js";
import { getActiveTheme } from "../src/themes/index.js";
import type { StyleTestRuntimeContext } from "../src/style-test-contract.js";
import { TUIStyleTestApp } from "../tools/TUIstyletest/app.js";
import { VirtualTerminal } from "./helpers/virtual-terminal.js";

function createRuntimeContext(): StyleTestRuntimeContext {
	return {
		tui: null as unknown as TUI,
		getAnimationState: () => ({
			hueOffset: 0,
			spinnerFrame: 2,
			breathPhase: 0.5,
			glitchActive: false,
			tickCount: 8,
			focusFlashTicks: 0,
			focusedComponent: "editor",
			wipeTransition: { active: false, frame: 0 },
			separatorOffset: 0,
			typewriter: { target: "", displayed: "", ticksSinceChar: 0 },
		}),
		getTheme: () => getActiveTheme(),
		getThemeName: () => getActiveTheme().name,
		resolveStyleDemo: () => undefined,
		listStyleDemos: () => [],
		setControlValue: () => undefined,
		openSelectOverlay: () => undefined,
		openTextPrompt: () => undefined,
		openEditorPrompt: () => undefined,
		showOverlay: () => undefined,
		openShellMenu: () => undefined,
		closeOverlay: () => undefined,
	};
}

async function flush(terminal: VirtualTerminal): Promise<string[]> {
	await new Promise<void>((resolve) => setImmediate(resolve));
	await new Promise<void>((resolve) => setImmediate(resolve));
	return terminal.flushAndGetViewport();
}

function createMouseEvent(overrides: Partial<{ action: "down" | "drag" | "up"; button: "left" | "wheelUp" | "wheelDown"; row: number; col: number }>) {
	return {
		action: "down" as const,
		button: "left" as const,
		row: 1,
		col: 1,
		shift: false,
		alt: false,
		ctrl: false,
		...overrides,
	};
}

test("FloatingAnimBoxContent renders and FloatWindow resize updates geometry", () => {
	const preset: FloatingAnimBoxPreset = { ...DEFAULT_FLOATING_ANIMBOX_PRESET, cols: 32, rows: 10 };
	const viewportHistory: Array<{ width: number; height: number }> = [];
	const content = new FloatingAnimBoxContent(createRuntimeContext(), preset, "test-floating-animbox", (viewport) => viewportHistory.push(viewport));
	content.setHostedViewportSize({ width: 32, height: 10 });
	const rendered = content.render(32);
	assert.equal(rendered.length, 10);

	const stateHistory: Array<{ row: number; col: number; width: number; height: number }> = [];
	const window = createFloatingAnimBoxWindow(preset, createRuntimeContext(), {
		instanceId: "test-floating-window",
		onStateChange: (model) => stateHistory.push({ row: model.row, col: model.col, width: model.width, height: model.height }),
		onViewportChange: (viewport) => viewportHistory.push(viewport),
	});
	window.setViewportSize({ width: 120, height: 40 });
	const before = { width: window.model.width, height: window.model.height };
	const rect = { row: window.model.row, col: window.model.col, width: window.model.width, height: window.model.height };
	window.handleMouse(createMouseEvent({ row: rect.row + rect.height - 1, col: rect.col + rect.width - 1 }), rect);
	window.handleMouse(createMouseEvent({ action: "drag", row: rect.row + rect.height + 2, col: rect.col + rect.width + 4 }), rect);
	window.handleMouse(createMouseEvent({ action: "up", row: rect.row + rect.height + 2, col: rect.col + rect.width + 4 }), rect);
	assert.ok(window.model.width > before.width);
	assert.ok(window.model.height > before.height);
	assert.ok(stateHistory.length > 0);
	assert.ok(viewportHistory.some((viewport) => viewport.width >= 32 && viewport.height >= 10));
});

test("TUIStyleTestApp opens floating animbox workflow and persists preset edits", async () => {
	const terminal = new VirtualTerminal(130, 40);
	const presetPath = path.resolve("tools", "TUIstyletest", "presets", "src", "components", "floating_animbox.ts", "floatingAnimBox.json");
	const presetVariantDir = path.resolve("tools", "TUIstyletest", "presets", "src", "components", "floating_animbox.ts", "floatingAnimBox.variants");
	const originalPreset = readFileSync(presetPath, "utf-8");
	const app = new TUIStyleTestApp({ terminal });
	await app.start();

	try {
		const internal = app as unknown as {
			openFloatingWindowMenu(): void;
			openFloatingAnimBoxWindow(presetId?: string): void;
			updateFloatingAnimBoxPreset(partial: Partial<FloatingAnimBoxPreset>, persist?: boolean): void;
			closeActiveFloatingAnimBox(): void;
			activeFloatingAnimBox?: { values: FloatingAnimBoxPreset };
		};

		internal.openFloatingWindowMenu();
		let viewport = (await flush(terminal)).join("\n");
		assert.match(viewport, /Floating Windows/);
		assert.match(viewport, /Floating Animbox/);

		internal.openFloatingAnimBoxWindow();
		viewport = (await flush(terminal)).join("\n");
		assert.match(viewport, /Preset Designer/);
		assert.match(viewport, /Floating Animbox/);
		assert.ok(internal.activeFloatingAnimBox);

		internal.updateFloatingAnimBoxPreset({ cols: 44, rows: 14, x: 12, y: 6 });
		viewport = (await flush(terminal)).join("\n");
		assert.match(viewport, /Cols/);
		assert.equal(internal.activeFloatingAnimBox?.values.cols, 44);
		assert.equal(internal.activeFloatingAnimBox?.values.rows, 14);
		const persisted = JSON.parse(readFileSync(presetPath, "utf-8")) as Record<string, unknown>;
		assert.equal(persisted.cols, 44);
		assert.equal(persisted.rows, 14);
		assert.equal(persisted.x, 12);
		assert.equal(persisted.y, 6);

		internal.closeActiveFloatingAnimBox();
		viewport = (await flush(terminal)).join("\n");
		assert.doesNotMatch(viewport, /Preset Designer/);
		assert.equal(internal.activeFloatingAnimBox, undefined);
	} finally {
		app.stop();
		writeFileSync(presetPath, originalPreset);
		rmSync(presetVariantDir, { recursive: true, force: true });
	}
});
