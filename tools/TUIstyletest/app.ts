import { ProcessTerminal, TUI, Text, matchesKey, truncateToWidth, visibleWidth, type Component, type Terminal } from "@mariozechner/pi-tui";
import { createAppDebugger } from "../../src/app-debugger.js";
import { DefaultAppStateStore } from "../../src/app-state-store.js";
import { AnimationEngine, setGlobalAnimationEngine } from "../../src/animation-engine.js";
import { paintBoxLineTwoParts, paintLine } from "../../src/ansi.js";
import { initTheme, KeybindingsManager } from "../../src/local-coding-agent.js";
import { MouseEnabledTerminal } from "../../src/mouse-enabled-terminal.js";
import type { MouseEvent, Rect } from "../../src/mouse.js";
import { parseMouseEvent, pointInRect } from "../../src/mouse.js";
import { DefaultOverlayController } from "../../src/overlay-controller.js";
import { SideBySideContainer } from "../../src/components/side-by-side-container.js";
import { renderMenuBar, type MenuBarItem } from "../../src/components/menu-bar.js";
import { agentTheme, createDynamicTheme } from "../../src/theme.js";
import type {
	StyleTestControl,
	StyleTestControlValues,
	StyleTestDemoDefinition,
	StyleTestRuntime,
	StyleTestRuntimeContext,
} from "../../src/style-test-contract.js";
import { getActiveTheme, getThemeNames, setActiveTheme, type ThemeName } from "../../src/themes/index.js";
import { buildDemoCatalog, createCatalogErrorDemo, getDefaultDemoId, getDefaultDemoValues, getDemoById } from "./catalog/build-demo-catalog.js";

type FocusPane = "browser" | "preview" | "controls";

type PanelListRow = { kind: "group"; label: string } | { kind: "demo"; id: string; title: string; sourceFile: string; kindLabel: string };
type ActionRow = { id: string; label: string; type: "action" };

interface MouseAwareComponent extends Component {
	handleMouse?(event: MouseEvent, rect: Rect): boolean;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function padVisible(text: string, width: number): string {
	return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

class BrowserPanel implements MouseAwareComponent {
	private readonly rows: PanelListRow[] = [];
	private readonly renderedRows: Array<{ row: number; demoId: string }> = [];
	public maxHeight = 20;

	constructor(
		private readonly getDemos: () => StyleTestDemoDefinition[],
		private readonly getSelectedId: () => string,
		private readonly onSelect: (id: string) => void,
		private readonly isFocused: () => boolean,
	) {}

	invalidate(): void {}

	handleInput(data: string): void {
		const demos = this.getDemos();
		const currentIndex = Math.max(0, demos.findIndex((demo) => demo.id === this.getSelectedId()));
		if (matchesKey(data, "up")) {
			this.onSelect(demos[Math.max(0, currentIndex - 1)]?.id ?? this.getSelectedId());
		}
		if (matchesKey(data, "down")) {
			this.onSelect(demos[Math.min(demos.length - 1, currentIndex + 1)]?.id ?? this.getSelectedId());
		}
	}

	handleMouse(event: MouseEvent, rect: Rect): boolean {
		if (!pointInRect(event, rect) || event.action !== "down" || event.button !== "left") {
			return false;
		}
		const localRow = event.row - rect.row + 1;
		const hit = this.renderedRows.find((entry) => entry.row === localRow);
		if (!hit) {
			return true;
		}
		this.onSelect(hit.demoId);
		return true;
	}

	render(width: number): string[] {
		const selectedId = this.getSelectedId();
		const demos = this.getDemos();
		const grouped = new Map<string, StyleTestDemoDefinition[]>();
		for (const demo of demos) {
			const existing = grouped.get(demo.sourceFile) ?? [];
			existing.push(demo);
			grouped.set(demo.sourceFile, existing);
		}
		this.rows.length = 0;
		for (const [sourceFile, items] of grouped.entries()) {
			this.rows.push({ kind: "group", label: sourceFile });
			for (const demo of items) {
				this.rows.push({ kind: "demo", id: demo.id, title: demo.title, sourceFile: demo.sourceFile, kindLabel: demo.kind.toUpperCase() });
			}
		}
		const selectedRowIndex = Math.max(0, this.rows.findIndex((row) => row.kind === "demo" && row.id === selectedId));
		const availableRows = Math.max(1, this.maxHeight - 5);
		const start = clamp(selectedRowIndex - Math.floor(availableRows / 2), 0, Math.max(0, this.rows.length - availableRows));
		const visibleRows = this.rows.slice(start, start + availableRows);

		const border = this.isFocused() ? agentTheme.accentStrong : agentTheme.dim;
		const lines: string[] = [];
		this.renderedRows.length = 0;
		lines.push(border("╭" + "─".repeat(Math.max(0, width - 2)) + "╮"));
		lines.push(paintLine(agentTheme.accentStrong(" Browser"), width));
		lines.push(paintLine(agentTheme.dim(" Grouped by source file"), width));
		let rowNumber = 4;
		for (const row of visibleRows) {
			if (row.kind === "group") {
				lines.push(paintLine(agentTheme.warning(` ${truncateToWidth(row.label, Math.max(1, width - 2), "")}`), width));
			} else {
				const selected = row.id === selectedId;
				const prefix = selected ? agentTheme.accent(" › ") : agentTheme.dim("   ");
				const title = selected ? agentTheme.accentStrong(row.title) : agentTheme.text(row.title);
				const meta = agentTheme.dim(` ${row.kindLabel}`);
				lines.push(paintLine(`${prefix}${title}${meta}`, width));
				this.renderedRows.push({ row: rowNumber, demoId: row.id });
			}
			rowNumber++;
		}
		lines.push(paintLine("", width));
		lines.push(paintLine(agentTheme.dim(" Up/Down browse  |  Tab focus"), width));
		lines.push(border("╰" + "─".repeat(Math.max(0, width - 2)) + "╯"));
		return lines;
	}
}

class ControlsPanel implements MouseAwareComponent {
	private renderedControlRows: Array<{ row: number; controlId: string }> = [];
	private selectedIndex = 0;
	public maxHeight = 20;

	constructor(
		private readonly getDemo: () => StyleTestDemoDefinition,
		private readonly getValues: () => StyleTestControlValues,
		private readonly getThemeName: () => ThemeName,
		private readonly getPresetActions: () => ActionRow[],
		private readonly isFocused: () => boolean,
		private readonly onAdjust: (controlId: string, delta: number) => void,
		private readonly onEditNumber: (controlId: string) => void,
		private readonly onToggle: (controlId: string) => void,
		private readonly onCycleEnum: (controlId: string, direction: number) => void,
		private readonly onEditText: (controlId: string) => void,
		private readonly onAction: (actionId: string) => void,
	) {}

	invalidate(): void {}

	private controlsForRender(): Array<StyleTestControl | ActionRow> {
		const demo = this.getDemo();
		const actionRows: ActionRow[] = [
			{ id: "action-cycle-theme", label: `Theme: ${this.getThemeName()}`, type: "action" },
			{ id: "action-reset", label: "Reset Demo", type: "action" },
			{ id: "action-randomize", label: "Randomize Values", type: "action" },
		];
		actionRows.push(...this.getPresetActions());
		for (const preset of demo.presets ?? []) {
			actionRows.push({ id: `preset:${preset.id}`, label: `Preset: ${preset.label}`, type: "action" });
		}
		if (demo.kind === "overlay") {
			actionRows.push({ id: "action-open-overlay", label: "Open Overlay", type: "action" });
		}
		return [...demo.controls, ...actionRows];
	}

	private currentControlId(): string | undefined {
		return this.controlsForRender()[clamp(this.selectedIndex, 0, Math.max(0, this.controlsForRender().length - 1))]?.id;
	}

	handleInput(data: string): void {
		const rows = this.controlsForRender();
		if (matchesKey(data, "up")) {
			this.selectedIndex = clamp(this.selectedIndex - 1, 0, Math.max(0, rows.length - 1));
			return;
		}
		if (matchesKey(data, "down")) {
			this.selectedIndex = clamp(this.selectedIndex + 1, 0, Math.max(0, rows.length - 1));
			return;
		}
		const current = rows[this.selectedIndex];
		if (!current) {
			return;
		}
		if ("type" in current && current.type === "action") {
			if (matchesKey(data, "enter") || matchesKey(data, "right")) {
				this.onAction(current.id);
			}
			return;
		}
		switch (current.type) {
			case "number":
				if (matchesKey(data, "left")) this.onAdjust(current.id, -1);
				if (matchesKey(data, "right")) this.onAdjust(current.id, 1);
				if (matchesKey(data, "enter")) this.onEditNumber(current.id);
				break;
			case "boolean":
				if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "enter")) this.onToggle(current.id);
				break;
			case "enum":
				if (matchesKey(data, "left")) this.onCycleEnum(current.id, -1);
				if (matchesKey(data, "right") || matchesKey(data, "enter")) this.onCycleEnum(current.id, 1);
				break;
			case "text":
				if (matchesKey(data, "enter") || matchesKey(data, "right")) this.onEditText(current.id);
				break;
		}
	}

	handleMouse(event: MouseEvent, rect: Rect): boolean {
		if (!pointInRect(event, rect) || event.action !== "down" || event.button !== "left") {
			return false;
		}
		const localRow = event.row - rect.row + 1;
		const hit = this.renderedControlRows.find((entry) => entry.row === localRow);
		if (!hit) {
			return true;
		}
		const rows = this.controlsForRender();
		this.selectedIndex = clamp(rows.findIndex((entry) => entry.id === hit.controlId), 0, Math.max(0, rows.length - 1));
		const current = rows[this.selectedIndex];
		if (!current) {
			return true;
		}
		if ("type" in current && current.type === "action") {
			this.onAction(current.id);
			return true;
		}
		if (current.type === "boolean") {
			this.onToggle(current.id);
		}
		return true;
	}

	render(width: number): string[] {
		const demo = this.getDemo();
		const values = this.getValues();
		const rows = this.controlsForRender();
		this.selectedIndex = clamp(this.selectedIndex, 0, Math.max(0, rows.length - 1));
		const availableRows = Math.max(1, this.maxHeight - 5);
		const start = clamp(this.selectedIndex - Math.floor(availableRows / 2), 0, Math.max(0, rows.length - availableRows));
		const visibleRows = rows.slice(start, start + availableRows);
		const border = this.isFocused() ? agentTheme.accentStrong : agentTheme.dim;
		const lines: string[] = [];
		lines.push(border("╭" + "─".repeat(Math.max(0, width - 2)) + "╮"));
		lines.push(paintLine(agentTheme.accentStrong(" Inspector"), width));
		lines.push(paintLine(agentTheme.dim(` ${demo.title}`), width));
		this.renderedControlRows = [];
		let row = 4;
		for (const entry of visibleRows) {
			const selected = this.currentControlId() === entry.id;
			const prefix = selected ? agentTheme.accent(" › ") : agentTheme.dim("   ");
			if ("type" in entry && entry.type === "action") {
				lines.push(paintLine(`${prefix}${selected ? agentTheme.accentStrong(entry.label) : agentTheme.muted(entry.label)}`, width));
				this.renderedControlRows.push({ row, controlId: entry.id });
				row++;
				continue;
			}
			const value = values[entry.id];
			const label = truncateToWidth(entry.label, Math.max(1, width - 18), "");
			let valueText = "";
			switch (entry.type) {
				case "number":
					valueText = `${value}`;
					break;
				case "boolean":
					valueText = value ? "ON" : "OFF";
					break;
				case "enum":
				case "text":
					valueText = String(value);
					break;
			}
			const renderedValue = truncateToWidth(valueText, 14, "");
			const content = `${prefix}${selected ? agentTheme.text(label) : agentTheme.dim(label)} ${agentTheme.accent(renderedValue)}`;
			lines.push(paintLine(content, width));
			this.renderedControlRows.push({ row, controlId: entry.id });
			row++;
		}
		lines.push(paintLine("", width));
		lines.push(paintLine(agentTheme.dim(" Left/Right adjust  |  Enter edit"), width));
		lines.push(border("╰" + "─".repeat(Math.max(0, width - 2)) + "╯"));
		return lines;
	}
}

class PreviewPanel implements MouseAwareComponent {
	public maxHeight = 20;

	constructor(
		private readonly getDemo: () => StyleTestDemoDefinition,
		private readonly getRuntime: () => StyleTestRuntime | undefined,
		private readonly isFocused: () => boolean,
	) {}

	invalidate(): void {}

	handleMouse(_event: MouseEvent, _rect: Rect): boolean {
		return false;
	}

	handleInput(data: string): void {
		this.getRuntime()?.handleInput?.(data);
	}

	render(width: number): string[] {
		const height = this.maxHeight;
		const demo = this.getDemo();
		const runtime = this.getRuntime();
		const border = this.isFocused() ? agentTheme.accentStrong : agentTheme.dim;
		const bodyWidth = Math.max(1, width - 2);
		const bodyHeight = Math.max(1, height - 6);
		const lines: string[] = [];
		lines.push(border("╭" + "─".repeat(Math.max(0, width - 2)) + "╮"));
		lines.push(paintLine(agentTheme.accentStrong(` ${demo.title}`), width));
		lines.push(paintLine(agentTheme.dim(` ${demo.description}`), width));
		lines.push(paintLine(border("├" + "─".repeat(Math.max(0, width - 2)) + "┤"), width));
		const rendered = runtime?.render(bodyWidth, bodyHeight) ?? [agentTheme.warning("No preview runtime available.")];
		for (const line of rendered.slice(0, bodyHeight)) {
			lines.push(border("│") + padVisible(truncateToWidth(line, bodyWidth, ""), bodyWidth) + border("│"));
		}
		while (lines.length < height - 1) {
			lines.push(border("│") + " ".repeat(bodyWidth) + border("│"));
		}
		lines.push(border("╰" + "─".repeat(Math.max(0, width - 2)) + "╯"));
		return lines;
	}
}

export interface StyleTestAppOptions {
	terminal?: Terminal;
}

export class TUIStyleTestApp {
	private readonly terminal: MouseEnabledTerminal;
	private readonly tui: TUI;
	private readonly header = new Text("", 0, 0);
	private readonly menu = new Text("", 0, 0);
	private readonly separatorTop = new Text("", 0, 0);
	private readonly separatorBottom = new Text("", 0, 0);
	private readonly footer = new Text("", 0, 0);
	private readonly stateStore = new DefaultAppStateStore();
	private readonly debuggerSink = createAppDebugger({ appName: "tuistyletest", appRoot: process.cwd() });
	private readonly animationEngine = new AnimationEngine();
	private readonly overlayController: DefaultOverlayController;
	private demos: StyleTestDemoDefinition[] = [createCatalogErrorDemo("Catalog has not been loaded yet.")];
	private readonly browserPanel: BrowserPanel;
	private readonly controlsPanel: ControlsPanel;
	private readonly previewPanel: PreviewPanel;
	private readonly innerContent: SideBySideContainer;
	private readonly outerContent: SideBySideContainer;
	private readonly values = new Map<string, StyleTestControlValues>();
	private readonly activePresetIds = new Map<string, string>();
	private runtime?: StyleTestRuntime;
	private running = false;
	private focusedPane: FocusPane = "browser";
	private selectedDemoId = "catalog#error";

	constructor(options: StyleTestAppOptions = {}) {
		this.terminal = new MouseEnabledTerminal(options.terminal ?? new ProcessTerminal());
		this.tui = new TUI(this.terminal, true);
		initTheme("dark", false);
		setGlobalAnimationEngine(this.animationEngine);
		this.values.set(this.demos[0]!.id, getDefaultDemoValues(this.demos[0]!));
		this.browserPanel = new BrowserPanel(
			() => this.demos,
			() => this.selectedDemoId,
			(id) => this.selectDemo(id),
			() => this.focusedPane === "browser",
		);
		this.controlsPanel = new ControlsPanel(
			() => this.currentDemo(),
			() => this.currentValues(),
			() => this.getThemeName(),
			() => this.currentPresetActions(),
			() => this.focusedPane === "controls",
			(controlId, delta) => this.adjustNumberControl(controlId, delta),
			(controlId) => this.editNumberControl(controlId),
			(controlId) => this.toggleBooleanControl(controlId),
			(controlId, direction) => this.cycleEnumControl(controlId, direction),
			(controlId) => this.editTextControl(controlId),
			(actionId) => this.runAction(actionId),
		);
		this.previewPanel = new PreviewPanel(() => this.currentDemo(), () => this.runtime, () => this.focusedPane === "preview");
		this.innerContent = new SideBySideContainer(this.previewPanel, this.controlsPanel, 34);
		this.outerContent = new SideBySideContainer(this.browserPanel, this.innerContent, 72);
		this.tui.addChild(this.header);
		this.tui.addChild(this.menu);
		this.tui.addChild(this.separatorTop);
		this.tui.addChild(this.outerContent);
		this.tui.addChild(this.separatorBottom);
		this.tui.addChild(this.footer);
		const keybindings = KeybindingsManager.create();
		this.overlayController = new DefaultOverlayController(
			this.tui,
			this.stateStore,
			this.debuggerSink,
			keybindings,
			() => this.getFocusComponent(),
			(component, label) => this.setFocusedComponent(component, label),
		);
		this.rebuildRuntime();
	}

	async start(): Promise<void> {
		if (this.running) return;
		await this.loadCatalog();
		this.running = true;
		this.refreshChrome();
		this.animationEngine.setOnTick(() => {
			this.applyWipeState();
			this.refreshChrome();
			this.tui.requestRender();
		});
		this.animationEngine.start();
		this.tui.addInputListener((data) => this.handleGlobalInput(data));
		this.tui.start();
		this.tui.setFocus(this.browserPanel as unknown as Component);
		this.terminal.setTitle("TUIstyletest");
	}

	stop(): void {
		if (!this.running) return;
		this.running = false;
		this.runtime?.dispose?.();
		this.animationEngine.stop();
		this.overlayController.closeAllOverlays();
		this.tui.stop();
	}

	currentDemo(): StyleTestDemoDefinition {
		return getDemoById(this.demos, this.selectedDemoId);
	}

	currentValues(): StyleTestControlValues {
		return { ...(this.values.get(this.selectedDemoId) ?? {}) };
	}

	private currentPresetId(): string {
		return this.activePresetIds.get(this.selectedDemoId) ?? "default";
	}

	private currentPresetLabel(): string {
		const variants = this.currentDemo().listPresetVariants?.() ?? [];
		const currentId = this.currentPresetId();
		return variants.find((entry) => entry.id === currentId)?.label ?? "Default";
	}

	private currentPresetActions(): ActionRow[] {
		const variants = this.currentDemo().listPresetVariants?.() ?? [];
		if (variants.length === 0) {
			return [];
		}
		return [
			{ id: "action-save-preset-as", label: `Save Preset As (${this.currentPresetLabel()})`, type: "action" },
			...variants.map((variant) => ({
				id: `variant:${variant.id}`,
				label: `${variant.id === this.currentPresetId() ? "Variant *" : "Variant"}: ${variant.label}`,
				type: "action" as const,
			})),
		];
	}

	getThemeName(): ThemeName {
		return getActiveTheme().name;
	}

	selectDemo(id: string): void {
		if (this.selectedDemoId === id) return;
		this.selectedDemoId = id;
		this.animationEngine.triggerWipeTransition();
		this.rebuildRuntime();
		this.refreshChrome();
		this.tui.requestRender();
	}

	updateControlValue(controlId: string, value: string | number | boolean): void {
		const next = { ...this.currentValues(), [controlId]: value };
		this.values.set(this.selectedDemoId, next);
		this.currentDemo().saveValues?.(next, this.currentPresetId());
		this.rebuildRuntime();
		this.tui.requestRender();
	}

	openCurrentOverlay(): void {
		this.runtime?.openOverlay?.();
		this.tui.requestRender();
	}

	private setFocusedComponent(component: Component | null, label: string): void {
		this.stateStore.setFocusLabel(label);
		this.tui.setFocus(component);
	}

	private getFocusComponent(): Component | null {
		if (this.focusedPane === "browser") return this.browserPanel as unknown as Component;
		if (this.focusedPane === "controls") return this.controlsPanel as unknown as Component;
		return this.previewPanel as unknown as Component;
	}

	private setFocusPane(pane: FocusPane): void {
		this.focusedPane = pane;
		const focusKind = pane === "preview" ? "editor" : "sessions";
		this.animationEngine.triggerFocusFlash(focusKind);
		this.setFocusedComponent(this.getFocusComponent(), pane);
		this.tui.requestRender();
	}

	private cycleFocus(direction: 1 | -1): void {
		const order: FocusPane[] = ["browser", "preview", "controls"];
		const index = order.indexOf(this.focusedPane);
		const next = order[(index + direction + order.length) % order.length]!;
		this.setFocusPane(next);
	}

	private async loadCatalog(): Promise<void> {
		try {
			const demos = await buildDemoCatalog();
			this.demos = demos.length > 0 ? demos : [createCatalogErrorDemo("No style demos were discovered.")];
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.demos = [createCatalogErrorDemo(`Failed to build the live style catalog: ${message}`)];
		}
		this.values.clear();
		this.activePresetIds.clear();
		for (const demo of this.demos) {
			this.values.set(demo.id, getDefaultDemoValues(demo));
			this.activePresetIds.set(demo.id, "default");
		}
		this.selectedDemoId = getDefaultDemoId(this.demos);
		this.rebuildRuntime();
	}

	private refreshChrome(): void {
		const dynamicTheme = createDynamicTheme(this.animationEngine.getState());
		const themeName = this.getThemeName();
		const headerLeft = `${agentTheme.chromeBadge(" TUIstyletest ")} ${agentTheme.chromeMeta(`Standalone style lab  |  ${this.currentDemo().kind.toUpperCase()}`)}`;
		const presetLabel = this.currentDemo().listPresetVariants ? this.currentPresetLabel() : undefined;
		const headerRight = agentTheme.dim(`theme=${themeName}  demo=${this.currentDemo().title}${presetLabel ? `  preset=${presetLabel}` : ""}`);
		this.header.setText(paintBoxLineTwoParts(headerLeft, headerRight, this.terminal.columns, " ", undefined, dynamicTheme.borderAnimated));
		const menuItems: MenuBarItem[] = [
			{ key: "Tab", label: "Focus" },
			{ key: "Enter", label: "Edit" },
			{ key: "Esc", label: "Close Overlay" },
			{ key: "Ctrl+Q", label: "Quit" },
		];
		this.menu.setText(renderMenuBar(menuItems, this.terminal.columns, dynamicTheme.borderAnimated, agentTheme.dim, agentTheme.muted, dynamicTheme.borderAnimated));
		this.separatorTop.setText(dynamicTheme.borderAnimated("─".repeat(this.terminal.columns)));
		this.separatorBottom.setText(dynamicTheme.borderAnimated("─".repeat(this.terminal.columns)));
		const footerLeft = agentTheme.dim(`focus=${this.focusedPane}  overlays=${this.overlayController.getOverlayDepth()}  controls=${this.currentDemo().controls.length}`);
		const footerRight = agentTheme.text(this.stateStore.getState().focusLabel);
		this.footer.setText(paintBoxLineTwoParts(footerLeft, footerRight, this.terminal.columns, " ", undefined, dynamicTheme.borderAnimated));
		this.updateLayoutWidths();
	}

	private updateLayoutWidths(): void {
		const totalWidth = this.terminal.columns;
		const browserWidth = clamp(Math.floor(totalWidth * 0.24), 28, 38);
		const inspectorWidth = clamp(Math.floor(totalWidth * 0.28), 28, 42);
		this.innerContent.rightWidth = inspectorWidth;
		this.outerContent.rightWidth = Math.max(20, totalWidth - browserWidth - 1);
		const bodyHeight = Math.max(10, this.terminal.rows - 5);
		this.innerContent.maxHeight = bodyHeight;
		this.outerContent.maxHeight = bodyHeight;
		this.browserPanel.maxHeight = bodyHeight;
		this.controlsPanel.maxHeight = bodyHeight;
		this.previewPanel.maxHeight = bodyHeight;
	}

	private handleGlobalInput(data: string): { consume?: boolean } | undefined {
		const mouseEvent = parseMouseEvent(data);
		if (mouseEvent) {
			if (this.overlayController.getOverlayDepth() > 0) {
				this.overlayController.dispatchMouse(mouseEvent);
			} else {
				this.dispatchPaneMouse(mouseEvent);
			}
			this.tui.requestRender();
			return { consume: true };
		}

		if (matchesKey(data, "ctrl+q")) {
			this.stop();
			return { consume: true };
		}
		if (matchesKey(data, "tab")) {
			this.cycleFocus(1);
			return { consume: true };
		}
		if (data === "\x1b[Z") {
			this.cycleFocus(-1);
			return { consume: true };
		}
		if ((matchesKey(data, "escape") || matchesKey(data, "esc")) && this.overlayController.getOverlayDepth() > 0) {
			this.overlayController.closeTopOverlay();
			this.tui.requestRender();
			return { consume: true };
		}
		if (matchesKey(data, "f1")) {
			this.runtime?.openOverlay?.();
			return { consume: true };
		}
		return undefined;
	}

	private dispatchPaneMouse(event: MouseEvent): void {
		const contentTop = 4;
		const totalWidth = this.terminal.columns;
		const browserWidth = totalWidth - this.outerContent.rightWidth - 1;
		const previewWidth = Math.max(10, this.outerContent.rightWidth - this.innerContent.rightWidth - 1);
		const browserRect: Rect = { row: contentTop, col: 1, width: browserWidth, height: this.outerContent.maxHeight ?? 1 };
		const previewRect: Rect = { row: contentTop, col: browserWidth + 2, width: previewWidth, height: this.outerContent.maxHeight ?? 1 };
		const controlsRect: Rect = { row: contentTop, col: browserWidth + previewWidth + 3, width: this.innerContent.rightWidth, height: this.outerContent.maxHeight ?? 1 };

		if (pointInRect(event, browserRect)) {
			this.setFocusPane("browser");
			this.browserPanel.handleMouse?.(event, browserRect);
			return;
		}
		if (pointInRect(event, previewRect)) {
			this.setFocusPane("preview");
			this.previewPanel.handleMouse?.(event, previewRect);
			return;
		}
		if (pointInRect(event, controlsRect)) {
			this.setFocusPane("controls");
			this.controlsPanel.handleMouse?.(event, controlsRect);
		}
	}

	private rebuildRuntime(): void {
		this.runtime?.dispose?.();
		const demo = this.currentDemo();
		const values = this.currentValues();
		const context: StyleTestRuntimeContext = {
			tui: this.tui,
			getAnimationState: () => this.animationEngine.getState(),
			getTheme: () => getActiveTheme(),
			getThemeName: () => this.getThemeName(),
			openSelectOverlay: (id, title, description) =>
				this.overlayController.openSelectOverlay(
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
				this.overlayController.openTextPrompt(title, description, initialValue, (value) => {
					const focusLabel = this.stateStore.getState().focusLabel;
					const controlId = focusLabel.startsWith("edit:") ? focusLabel.slice(5) : undefined;
					if (controlId) {
						this.updateControlValue(controlId, value);
					}
				}),
			openEditorPrompt: (title, prefill) => this.overlayController.openEditorPrompt(title, prefill, () => undefined, () => undefined),
			showOverlay: (id, component, options) => {
				this.overlayController.showCustomOverlay(id, component, options);
			},
			openShellMenu: (id, definition) => this.overlayController.openMenuOverlay(id, definition),
			closeOverlay: (id) => this.overlayController.closeOverlay(id),
		};
		this.runtime = demo.createRuntime(context, values);
	}

	private currentControl(controlId: string): StyleTestControl | undefined {
		return this.currentDemo().controls.find((control) => control.id === controlId);
	}

	private adjustNumberControl(controlId: string, delta: number): void {
		const control = this.currentControl(controlId);
		if (!control || control.type !== "number") return;
		const current = Number(this.currentValues()[controlId] ?? control.defaultValue);
		const next = clamp(current + delta * control.step, control.min, control.max);
		this.updateControlValue(controlId, Number(next.toFixed(4)));
	}

	private toggleBooleanControl(controlId: string): void {
		const control = this.currentControl(controlId);
		if (!control || control.type !== "boolean") return;
		this.updateControlValue(controlId, !Boolean(this.currentValues()[controlId]));
	}

	private editNumberControl(controlId: string): void {
		const control = this.currentControl(controlId);
		if (!control || control.type !== "number") return;
		this.stateStore.setFocusLabel(`edit:${controlId}`);
		this.overlayController.openTextPrompt(
			control.label,
			control.description ?? "Enter an exact numeric value.",
			String(this.currentValues()[controlId] ?? control.defaultValue),
			(value) => {
				const numeric = Number(value.trim());
				if (!Number.isFinite(numeric)) {
					this.setFocusPane("controls");
					return;
				}
				const next = clamp(numeric, control.min, control.max);
				this.updateControlValue(controlId, Number(next.toFixed(4)));
				this.setFocusPane("controls");
			},
			() => this.setFocusPane("controls"),
		);
	}

	private cycleEnumControl(controlId: string, direction: number): void {
		const control = this.currentControl(controlId);
		if (!control || control.type !== "enum") return;
		const current = String(this.currentValues()[controlId] ?? control.defaultValue);
		const index = control.options.indexOf(current);
		const next = control.options[(index + direction + control.options.length) % control.options.length]!;
		this.updateControlValue(controlId, next);
	}

	private editTextControl(controlId: string): void {
		const control = this.currentControl(controlId);
		if (!control || control.type !== "text") return;
		this.stateStore.setFocusLabel(`edit:${controlId}`);
		const initialValue = String(this.currentValues()[controlId] ?? control.defaultValue);
		if (control.multiline) {
			this.overlayController.openEditorPrompt(
				control.label,
				initialValue,
				(value) => {
					this.updateControlValue(controlId, value);
					this.setFocusPane("controls");
				},
				() => this.setFocusPane("controls"),
			);
			return;
		}
		this.overlayController.openTextPrompt(control.label, control.description ?? "Edit control value.", initialValue, (value) => {
			this.updateControlValue(controlId, value);
			this.setFocusPane("controls");
		});
	}

	private runAction(actionId: string): void {
		if (actionId === "action-reset") {
			const demo = this.currentDemo();
			this.values.set(this.selectedDemoId, demo.loadValues ? demo.loadValues(this.currentPresetId()) : getDefaultDemoValues(demo));
			this.rebuildRuntime();
			this.tui.requestRender();
			return;
		}
		if (actionId === "action-randomize") {
			const values = this.currentValues();
			for (const control of this.currentDemo().controls) {
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
			this.values.set(this.selectedDemoId, values);
			this.rebuildRuntime();
			this.tui.requestRender();
			return;
		}
		if (actionId === "action-cycle-theme") {
			const themes = getThemeNames();
			const index = themes.indexOf(this.getThemeName());
			setActiveTheme(themes[(index + 1) % themes.length]!);
			this.rebuildRuntime();
			this.tui.requestRender();
			return;
		}
		if (actionId === "action-open-overlay") {
			this.openCurrentOverlay();
			return;
		}
		if (actionId === "action-save-preset-as") {
			const currentDemo = this.currentDemo();
			this.overlayController.openTextPrompt("Save Preset As", "Enter a name for the new preset variant.", "", (value) => {
				const nextId = currentDemo.saveValues?.(this.currentValues(), value.trim());
				if (typeof nextId === "string" && nextId.length > 0) {
					this.activePresetIds.set(this.selectedDemoId, nextId);
				}
				this.rebuildRuntime();
				this.refreshChrome();
				this.tui.requestRender();
				this.setFocusPane("controls");
			}, () => this.setFocusPane("controls"));
			return;
		}
		if (actionId.startsWith("variant:")) {
			const presetId = actionId.slice("variant:".length);
			const demo = this.currentDemo();
			this.activePresetIds.set(this.selectedDemoId, presetId);
			if (demo.loadValues) {
				this.values.set(this.selectedDemoId, demo.loadValues(presetId));
			}
			this.rebuildRuntime();
			this.refreshChrome();
			this.tui.requestRender();
			return;
		}
		if (actionId.startsWith("preset:")) {
			const presetId = actionId.slice("preset:".length);
			const preset = this.currentDemo().presets?.find((entry) => entry.id === presetId);
			if (preset) {
				this.values.set(this.selectedDemoId, { ...this.currentValues(), ...preset.values });
				this.rebuildRuntime();
				this.tui.requestRender();
			}
		}
	}

	private applyWipeState(): void {
		const frame = this.animationEngine.getState().wipeTransition;
		if (!frame.active) {
			this.outerContent.wipeChar = null;
			return;
		}
		const wipeFrames = ["░", "▒", "▓", "█"] as const;
		this.outerContent.wipeChar = wipeFrames[Math.min(wipeFrames.length - 1, frame.frame)] ?? "▓";
	}
}
