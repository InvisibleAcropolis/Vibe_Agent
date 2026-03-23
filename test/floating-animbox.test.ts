import assert from "node:assert";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { TUI } from "@mariozechner/pi-tui";
import { createFloatingAnimBoxWindow, DEFAULT_FLOATING_ANIMBOX_PRESET, type FloatingAnimBoxPreset } from "../src/components/floating_animbox.js";
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

test("FloatingAnimBoxWindow renders animation content and resizes geometry", () => {
	const preset: FloatingAnimBoxPreset = { ...DEFAULT_FLOATING_ANIMBOX_PRESET, cols: 32, rows: 10 };
	const viewportHistory: Array<{ width: number; height: number }> = [];
	const stateHistory: Array<{ row: number; col: number; width: number; height: number }> = [];
	const window = createFloatingAnimBoxWindow(preset, createRuntimeContext(), {
		instanceId: "test-floating-window",
		onStateChange: (model) => stateHistory.push({ row: model.row, col: model.col, width: model.width, height: model.height }),
		onViewportChange: (viewport) => viewportHistory.push(viewport),
	});
	window.setHostedViewportSize({ width: 120, height: 40 });
	const rendered = window.render(window.model.width);
	assert.ok(rendered.length >= preset.rows);
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

test("FloatingAnimBoxWindow drags from the interior and resizes from wider top and bottom bands", () => {
	const preset: FloatingAnimBoxPreset = { ...DEFAULT_FLOATING_ANIMBOX_PRESET, cols: 32, rows: 10, x: 12, y: 6 };
	const window = createFloatingAnimBoxWindow(preset, createRuntimeContext(), {
		instanceId: "test-floating-window-zones",
		title: "Floating Animbox",
	});
	window.setHostedViewportSize({ width: 120, height: 40 });

	const initialRect = { row: window.model.row, col: window.model.col, width: window.model.width, height: window.model.height };
	window.handleMouse(
		createMouseEvent({ row: initialRect.row + 3, col: initialRect.col + Math.floor(initialRect.width / 2) }),
		initialRect,
	);
	window.handleMouse(
		createMouseEvent({ action: "drag", row: initialRect.row + 6, col: initialRect.col + Math.floor(initialRect.width / 2) + 5 }),
		initialRect,
	);
	window.handleMouse(
		createMouseEvent({ action: "up", row: initialRect.row + 6, col: initialRect.col + Math.floor(initialRect.width / 2) + 5 }),
		initialRect,
	);
	assert.equal(window.model.row, initialRect.row + 3);
	assert.equal(window.model.col, initialRect.col + 5);

	const draggedRect = { row: window.model.row, col: window.model.col, width: window.model.width, height: window.model.height };
	window.handleMouse(
		createMouseEvent({ row: draggedRect.row + draggedRect.height - 2, col: draggedRect.col + Math.floor(draggedRect.width / 2) }),
		draggedRect,
	);
	window.handleMouse(
		createMouseEvent({ action: "drag", row: draggedRect.row + draggedRect.height + 2, col: draggedRect.col + Math.floor(draggedRect.width / 2) }),
		draggedRect,
	);
	window.handleMouse(
		createMouseEvent({ action: "up", row: draggedRect.row + draggedRect.height + 2, col: draggedRect.col + Math.floor(draggedRect.width / 2) }),
		draggedRect,
	);
	assert.ok(window.model.height > draggedRect.height);

	const resizedRect = { row: window.model.row, col: window.model.col, width: window.model.width, height: window.model.height };
	window.handleMouse(
		createMouseEvent({ row: resizedRect.row, col: resizedRect.col + resizedRect.width - 4 }),
		resizedRect,
	);
	window.handleMouse(
		createMouseEvent({ action: "drag", row: resizedRect.row - 2, col: resizedRect.col + resizedRect.width - 4 }),
		resizedRect,
	);
	window.handleMouse(
		createMouseEvent({ action: "up", row: resizedRect.row - 2, col: resizedRect.col + resizedRect.width - 4 }),
		resizedRect,
	);
	assert.ok(window.model.row < resizedRect.row);
	assert.ok(window.model.height > resizedRect.height);
});

test("TUIStyleTestApp heals the corrupted default floating animbox preset and persists on close", async () => {
	const terminal = new VirtualTerminal(130, 40);
	const presetPath = path.resolve("tools", "TUIstyletest", "presets", "src", "components", "floating_animbox.ts", "floatingAnimBox.json");
	const presetVariantDir = path.resolve("tools", "TUIstyletest", "presets", "src", "components", "floating_animbox.ts", "floatingAnimBox.variants");
	const originalPreset = readFileSync(presetPath, "utf-8");
	writeFileSync(
		presetPath,
		`${JSON.stringify({ ...DEFAULT_FLOATING_ANIMBOX_PRESET, cols: 8, rows: 4, x: 1, y: 1 }, null, 2)}\n`,
	);
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
		assert.deepStrictEqual(internal.activeFloatingAnimBox?.values, DEFAULT_FLOATING_ANIMBOX_PRESET);
		let persisted = JSON.parse(readFileSync(presetPath, "utf-8")) as Record<string, unknown>;
		assert.equal(persisted.cols, DEFAULT_FLOATING_ANIMBOX_PRESET.cols);
		assert.equal(persisted.rows, DEFAULT_FLOATING_ANIMBOX_PRESET.rows);
		assert.equal(persisted.x, DEFAULT_FLOATING_ANIMBOX_PRESET.x);
		assert.equal(persisted.y, DEFAULT_FLOATING_ANIMBOX_PRESET.y);

		internal.updateFloatingAnimBoxPreset({ cols: 44, rows: 14, x: 12, y: 6 });
		viewport = (await flush(terminal)).join("\n");
		assert.match(viewport, /Cols/);
		assert.equal(internal.activeFloatingAnimBox?.values.cols, 44);
		assert.equal(internal.activeFloatingAnimBox?.values.rows, 14);
		persisted = JSON.parse(readFileSync(presetPath, "utf-8")) as Record<string, unknown>;
		assert.equal(persisted.cols, DEFAULT_FLOATING_ANIMBOX_PRESET.cols);
		assert.equal(persisted.rows, DEFAULT_FLOATING_ANIMBOX_PRESET.rows);
		assert.equal(persisted.x, DEFAULT_FLOATING_ANIMBOX_PRESET.x);
		assert.equal(persisted.y, DEFAULT_FLOATING_ANIMBOX_PRESET.y);

		internal.closeActiveFloatingAnimBox();
		viewport = (await flush(terminal)).join("\n");
		assert.doesNotMatch(viewport, /Preset Designer/);
		assert.equal(internal.activeFloatingAnimBox, undefined);
		persisted = JSON.parse(readFileSync(presetPath, "utf-8")) as Record<string, unknown>;
		assert.equal(persisted.cols, 44);
		assert.equal(persisted.rows, 14);
		assert.equal(persisted.x, 12);
		assert.equal(persisted.y, 6);
	} finally {
		app.stop();
		writeFileSync(presetPath, originalPreset);
		rmSync(presetVariantDir, { recursive: true, force: true });
	}
});

test("TUIStyleTestApp does not auto-heal named floating animbox variants", async () => {
	const terminal = new VirtualTerminal(130, 40);
	const presetPath = path.resolve("tools", "TUIstyletest", "presets", "src", "components", "floating_animbox.ts", "floatingAnimBox.json");
	const presetVariantDir = path.resolve("tools", "TUIstyletest", "presets", "src", "components", "floating_animbox.ts", "floatingAnimBox.variants");
	const variantPath = path.join(presetVariantDir, "broken.json");
	const originalPreset = readFileSync(presetPath, "utf-8");
	rmSync(presetVariantDir, { recursive: true, force: true });
	mkdirSync(presetVariantDir, { recursive: true });
	writeFileSync(
		variantPath,
		`${JSON.stringify({ ...DEFAULT_FLOATING_ANIMBOX_PRESET, cols: 8, rows: 4, x: 1, y: 1 }, null, 2)}\n`,
	);
	const app = new TUIStyleTestApp({ terminal });
	await app.start();

	try {
		const internal = app as unknown as {
			openFloatingAnimBoxWindow(presetId?: string): void;
			activeFloatingAnimBox?: { values: FloatingAnimBoxPreset };
		};

		internal.openFloatingAnimBoxWindow("broken");
		await flush(terminal);
		assert.equal(internal.activeFloatingAnimBox?.values.cols, 8);
		assert.equal(internal.activeFloatingAnimBox?.values.rows, 4);
		assert.equal(internal.activeFloatingAnimBox?.values.x, 1);
		assert.equal(internal.activeFloatingAnimBox?.values.y, 1);
		const persisted = JSON.parse(readFileSync(variantPath, "utf-8")) as Record<string, unknown>;
		assert.equal(persisted.cols, 8);
		assert.equal(persisted.rows, 4);
		assert.equal(persisted.x, 1);
		assert.equal(persisted.y, 1);
	} finally {
		app.stop();
		writeFileSync(presetPath, originalPreset);
		rmSync(presetVariantDir, { recursive: true, force: true });
	}
});
