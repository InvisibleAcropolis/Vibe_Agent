import assert from "node:assert";
import { describe, it } from "node:test";
import type { Component, OverlayOptions, TUI } from "@mariozechner/pi-tui";
import { DefaultOverlayController } from "../src/overlay-controller.js";
import type { MouseEvent } from "../src/mouse.js";
import type { HostedSizeRequirements, HostedViewportDimensions } from "../src/types.js";

type OverlayRecordStub = {
	component: Component;
	options: OverlayOptions;
	hidden: boolean;
};

class HostedProbeComponent implements Component {
	readonly viewportHistory: HostedViewportDimensions[] = [];
	readonly mouseRects: Array<{ width: number; height: number; row: number; col: number }> = [];
	constructor(
		private readonly lines: (viewport: HostedViewportDimensions) => string[],
		private readonly sizing: HostedSizeRequirements,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const viewport = this.viewportHistory.at(-1) ?? { width, height: this.sizing.preferredHeight ?? this.sizing.minHeight ?? 1 };
		return this.lines({ width, height: viewport.height });
	}

	handleMouse(_event: MouseEvent, rect: { width: number; height: number; row: number; col: number }): boolean {
		this.mouseRects.push({ ...rect });
		return true;
	}

	getHostedSizeRequirements(): HostedSizeRequirements {
		return this.sizing;
	}

	setHostedViewportSize(viewport: HostedViewportDimensions): void {
		this.viewportHistory.push({ ...viewport });
	}
}

function createMouseEvent(overrides: Partial<MouseEvent>): MouseEvent {
	return {
		action: "down",
		button: "left",
		row: 1,
		col: 1,
		shift: false,
		alt: false,
		ctrl: false,
		...overrides,
	};
}

function createController(columns = 80, rows = 30): {
	controller: DefaultOverlayController;
	overlays: OverlayRecordStub[];
	focusLabels: string[];
	focusTargets: Array<Component | null>;
	requestRenderCount: { value: number };
	state: { overlayIds: string[]; focusLabel: string };
	tui: TUI;
} {
	const overlays: OverlayRecordStub[] = [];
	const requestRenderCount = { value: 0 };
	const focusLabels: string[] = [];
	const focusTargets: Array<Component | null> = [];
	const state = { overlayIds: [] as string[], focusLabel: "root" };
	const tui = {
		terminal: { columns, rows },
		showOverlay(component: Component, options: OverlayOptions) {
			const record: OverlayRecordStub = { component, options, hidden: false };
			overlays.push(record);
			return {
				hide() {
					record.hidden = true;
				},
				setHidden(hidden: boolean) {
					record.hidden = hidden;
				},
				isHidden() {
					return record.hidden;
				},
			};
		},
		requestRender() {
			requestRenderCount.value += 1;
		},
	} as unknown as TUI;
	const stateStore = {
		pushOverlay(id: string) {
			state.overlayIds.push(id);
		},
		removeOverlay(id: string) {
			state.overlayIds = state.overlayIds.filter((entry) => entry !== id);
		},
		clearOverlays() {
			state.overlayIds = [];
		},
		setFocusLabel(label: string) {
			state.focusLabel = label;
		},
		getState() {
			return state;
		},
	};
	const debuggerSink = { log() {} };
	const controller = new DefaultOverlayController(
		tui,
		stateStore as never,
		debuggerSink as never,
		{} as never,
		() => null,
		(component, label) => {
			focusTargets.push(component);
			focusLabels.push(label);
			state.focusLabel = label;
		},
	);
	return { controller, overlays, focusLabels, focusTargets, requestRenderCount, state, tui };
}

describe("DefaultOverlayController floating overlays", () => {
	it("promotes a lower visible overlapping window above others on click", () => {
		const harness = createController();
		const lower = new HostedProbeComponent(() => ["lower"], { minWidth: 18, minHeight: 4, preferredWidth: 22, preferredHeight: 8 });
		const upper = new HostedProbeComponent(() => ["upper"], { minWidth: 18, minHeight: 4, preferredWidth: 22, preferredHeight: 8 });
		harness.controller.showCustomOverlay("lower", lower, { anchor: "top-left", row: 3, col: 5, width: 22, maxHeight: 8 });
		harness.controller.showCustomOverlay("upper", upper, { anchor: "top-left", row: 4, col: 6, width: 22, maxHeight: 8 });
		const lowerWindow = harness.overlays.at(-2)?.component as unknown as { model: { row: number; col: number; zIndex: number; active: boolean } };
		const upperWindow = harness.overlays.at(-1)?.component as unknown as { model: { row: number; col: number; zIndex: number; active: boolean } };

		assert.deepStrictEqual(harness.state.overlayIds, ["lower", "upper"]);
		const consumed = harness.controller.dispatchMouse(createMouseEvent({ row: lowerWindow.model.row, col: lowerWindow.model.col + 3 }));
		assert.equal(consumed, true);
		assert.deepStrictEqual(harness.state.overlayIds, ["lower", "upper"], "z-order changes without mutating state-store ids");
		assert.equal(harness.focusLabels.at(-1), "overlay:upper");
		assert.equal(lowerWindow.model.active, true);
		assert.equal(lowerWindow.model.zIndex, 1);
		assert.equal(upperWindow.model.active, false);
		assert.equal(upperWindow.model.zIndex, 0);
	});

	it("routes clicks and scrolls to content area while keeping frame chrome separate", () => {
		const harness = createController();
		const hosted = new HostedProbeComponent(
			(viewport) => Array.from({ length: viewport.height }, (_, index) => `line-${index}`),
			{ minWidth: 18, minHeight: 4, preferredWidth: 24, preferredHeight: 9 },
		);
		harness.controller.showCustomOverlay("probe", hosted, { anchor: "top-left", row: 2, col: 4, width: 24, maxHeight: 9 });
		const window = harness.overlays.at(-1)?.component as unknown as { model: { row: number; col: number; width: number; height: number } };
		const contentRect = { row: window.model.row + 1, col: window.model.col + 1, width: window.model.width - 2, height: window.model.height - 4 };

		assert.equal(harness.controller.dispatchMouse(createMouseEvent({ row: contentRect.row + 1, col: contentRect.col + 1 })), true);
		assert.deepStrictEqual(hosted.mouseRects.at(-1), contentRect);
		assert.equal(harness.controller.dispatchMouse(createMouseEvent({ action: "scroll", button: "wheelDown", row: contentRect.row + 1, col: contentRect.col + 1 })), true);
		assert.deepStrictEqual(hosted.mouseRects.at(-1), contentRect);
		const routedCount = hosted.mouseRects.length;
		assert.equal(harness.controller.dispatchMouse(createMouseEvent({ row: window.model.row + window.model.height - 2, col: window.model.col + 3 })), true);
		assert.equal(hosted.mouseRects.length, routedCount, "footer chrome should not be forwarded to hosted content");
	});

	it("re-clamps geometry on terminal resize and preserves hosted child viewport ownership", () => {
		const harness = createController(90, 34);
		const hosted = new HostedProbeComponent(
			(viewport) => [`viewport=${viewport.width}x${viewport.height}`],
			{ minWidth: 20, minHeight: 5, preferredWidth: 28, preferredHeight: 10, maxWidth: 40, maxHeight: 12 },
		);
		harness.controller.showCustomOverlay("resizable", hosted, { anchor: "top-left", row: 20, col: 55, width: 28, maxHeight: 10 });
		const overlayRecord = harness.overlays.at(-1);
		const window = overlayRecord?.component as unknown as { setViewportSize(viewport: HostedViewportDimensions): void; model: { row: number; col: number; width: number; height: number } };
		const before = hosted.viewportHistory.at(-1);
		assert.deepStrictEqual(before, { width: 26, height: 5 });

		(harness.tui.terminal as { columns: number; rows: number }).columns = 44;
		(harness.tui.terminal as { columns: number; rows: number }).rows = 16;
		assert.equal(harness.controller.dispatchMouse(createMouseEvent({ row: 1, col: 1 })), false);
		assert.deepStrictEqual({ width: window.model.width, height: window.model.height }, { width: 28, height: 9 });
		assert.ok(window.model.row >= 1 && window.model.col >= 1);
		assert.deepStrictEqual(hosted.viewportHistory.at(-1), { width: 26, height: 5 });
	});

	it("keeps floating geometry stable on click and drags from the current position", () => {
		const harness = createController(100, 40);
		const hosted = new HostedProbeComponent(
			(viewport) => Array.from({ length: viewport.height }, (_, index) => `row-${index}`),
			{ minWidth: 18, minHeight: 6, preferredWidth: 24, preferredHeight: 10, maxWidth: 40, maxHeight: 16 },
		);
		harness.controller.showCustomOverlay("floating", hosted, { anchor: "top-left", row: 6, col: 12, width: 24, maxHeight: 10 });
		const window = harness.overlays.at(-1)?.component as unknown as {
			model: {
				row: number;
				col: number;
				width: number;
				height: number;
				dragState: object | null;
				resizeState: object | null;
			};
		};
		const initial = {
			row: window.model.row,
			col: window.model.col,
			width: window.model.width,
			height: window.model.height,
		};
		const initialViewport = hosted.viewportHistory.at(-1);

		assert.equal(
			harness.controller.dispatchMouse(createMouseEvent({ row: initial.row + 2, col: initial.col + 4 })),
			true,
		);
		assert.deepStrictEqual(
			{
				row: window.model.row,
				col: window.model.col,
				width: window.model.width,
				height: window.model.height,
			},
			initial,
		);
		assert.equal(window.model.dragState, null);
		assert.equal(window.model.resizeState, null);
		assert.deepStrictEqual(hosted.viewportHistory.at(-1), initialViewport);

		assert.equal(
			harness.controller.dispatchMouse(createMouseEvent({ row: initial.row, col: initial.col + 6 })),
			true,
		);
		assert.equal(window.model.row, initial.row);
		assert.equal(window.model.col, initial.col);
		assert.notEqual(window.model.dragState, null);
		assert.equal(window.model.resizeState, null);

		assert.equal(
			harness.controller.dispatchMouse(createMouseEvent({ action: "drag", row: initial.row + 3, col: initial.col + 10 })),
			true,
		);
		assert.equal(window.model.row, initial.row + 3);
		assert.equal(window.model.col, initial.col + 4);
		assert.equal(
			harness.controller.dispatchMouse(createMouseEvent({ action: "up", row: initial.row + 3, col: initial.col + 10 })),
			true,
		);
		assert.equal(window.model.dragState, null);
		assert.equal(window.model.resizeState, null);
	});
});
