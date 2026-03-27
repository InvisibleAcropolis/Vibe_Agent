import { ProcessTerminal, TUI, Text, matchesKey, type Component, type Terminal } from "@mariozechner/pi-tui";
import { createAppDebugger } from "../../../src/app-debugger.js";
import { DefaultAppStateStore } from "../../../src/app-state-store.js";
import { AnimationEngine, setGlobalAnimationEngine } from "../../../src/animation-engine.js";
import { paintBoxLineTwoParts } from "../../../src/ansi.js";
import { initTheme, KeybindingsManager } from "../../../src/local-coding-agent.js";
import { MouseEnabledTerminal } from "../../../src/mouse-enabled-terminal.js";
import type { MouseEvent } from "../../../src/mouse.js";
import { parseMouseEvent, pointInRect } from "../../../src/mouse.js";
import { DefaultOverlayController } from "../../../src/overlay-controller.js";
import { SideBySideContainer } from "../../../src/components/side-by-side-container.js";
import { renderMenuBar, type MenuBarItem } from "../../../src/components/menu-bar.js";
import { animPreloadService } from "../../../src/components/animpreload-service.js";
import { agentTheme, createDynamicTheme } from "../../../src/theme.js";
import type { StyleTestControl, StyleTestControlValues, StyleTestDemoDefinition, StyleTestRuntime } from "../../../src/style-test-contract.js";
import { getActiveTheme, type ThemeName } from "../../../src/themes/index.js";
import { buildDemoCatalog, createCatalogErrorDemo, getDefaultDemoId, getDefaultDemoValues, getDemoById } from "../catalog/build-demo-catalog.js";
import { createActionDispatcher, cycleThemeName, randomizeDemoValues, resetDemoValues } from "./actions.js";
import { adjustNumberControl, cycleEnumControl, editNumberControl, editTextControl, toggleBooleanControl } from "./control-editors.js";
import { buildRuntimeContext, createRuntime } from "./runtime-context.js";
import { calculateBodyHeight, calculatePaneRects, calculatePanelWidths } from "./layout.js";
import { BrowserPanel } from "./panels/BrowserPanel.js";
import { ControlsPanel } from "./panels/ControlsPanel.js";
import { PreviewPanel } from "./panels/PreviewPanel.js";
import type { ActionRow, FocusPane } from "./types.js";

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
	private readonly browserPanel: BrowserPanel;
	private readonly controlsPanel: ControlsPanel;
	private readonly previewPanel: PreviewPanel;
	private readonly innerContent: SideBySideContainer;
	private readonly outerContent: SideBySideContainer;
	private readonly dispatchAction: (actionId: string) => void;
	private demos: StyleTestDemoDefinition[] = [createCatalogErrorDemo("Catalog has not been loaded yet.")];
	private readonly values = new Map<string, StyleTestControlValues>();
	private readonly activePresetIds = new Map<string, string>();
	private runtime?: StyleTestRuntime;
	private running = false;
	private focusedPane: FocusPane = "browser";
	private selectedDemoId = "catalog#error";
	private animationUnsubscribe?: () => void;

	constructor(options: StyleTestAppOptions = {}) {
		this.terminal = new MouseEnabledTerminal(options.terminal ?? new ProcessTerminal());
		this.tui = new TUI(this.terminal, true);
		initTheme("dark", false);
		setGlobalAnimationEngine(this.animationEngine);
		this.values.set(this.demos[0]!.id, getDefaultDemoValues(this.demos[0]!));
		this.browserPanel = new BrowserPanel(() => this.demos, () => this.selectedDemoId, (id) => this.selectDemo(id), () => this.focusedPane === "browser");
		this.controlsPanel = new ControlsPanel(
			() => this.currentDemo(),
			() => this.currentValues(),
			() => this.runtime,
			() => this.getThemeName(),
			() => this.currentPresetActions(),
			() => this.focusedPane === "controls",
			(controlId, delta) => this.adjustNumberControl(controlId, delta),
			(controlId) => this.editNumberControl(controlId),
			(controlId) => this.toggleBooleanControl(controlId),
			(controlId, direction) => this.cycleEnumControl(controlId, direction),
			(controlId) => this.editTextControl(controlId),
			(actionId) => this.dispatchAction(actionId),
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
		this.dispatchAction = createActionDispatcher({
			reset: () => this.resetCurrentDemo(),
			randomize: () => this.randomizeCurrentDemo(),
			cycleTheme: () => this.cycleTheme(),
			openOverlay: () => this.openCurrentOverlay(),
			savePresetAs: () => this.savePresetAs(),
			switchVariant: (presetId) => this.switchVariant(presetId),
			applyPreset: (presetId) => this.applyPreset(presetId),
		});
		this.rebuildRuntime();
	}

	async start(): Promise<void> {
		if (this.running) return;
		await this.loadCatalog();
		this.running = true;
		this.refreshChrome();
		this.animationUnsubscribe = this.animationEngine.subscribe(() => {
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
		this.animationUnsubscribe?.();
		this.animationUnsubscribe = undefined;
		this.runtime?.dispose?.();
		this.animationEngine.stop();
		animPreloadService.disposeAll();
		this.overlayController.closeAllOverlays();
		this.tui.stop();
	}

	currentDemo(): StyleTestDemoDefinition {
		return getDemoById(this.demos, this.selectedDemoId);
	}

	currentValues(): StyleTestControlValues {
		const demo = this.currentDemo();
		const values = {
			...getDefaultDemoValues(demo),
			...(this.values.get(this.selectedDemoId) ?? {}),
		};
		if (values.cols !== undefined && values.width === undefined) {
			values.width = values.cols;
		}
		if (values.rows !== undefined && values.height === undefined) {
			values.height = values.rows;
		}
		return values;
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
		const resolvedControlId = this.resolveControlId(controlId);
		const next = { ...this.currentValues(), [resolvedControlId]: value };
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
		const { inspectorWidth, contentRightWidth } = calculatePanelWidths(this.terminal.columns);
		this.innerContent.rightWidth = inspectorWidth;
		this.outerContent.rightWidth = contentRightWidth;
		const bodyHeight = calculateBodyHeight(this.terminal.rows);
		this.innerContent.maxHeight = bodyHeight;
		this.outerContent.maxHeight = bodyHeight;
		this.browserPanel.maxHeight = bodyHeight;
		this.controlsPanel.maxHeight = bodyHeight;
		this.previewPanel.maxHeight = bodyHeight;
	}

	private handleGlobalInput(data: string): { consume?: boolean } | undefined {
		return this.handleMouseInput(data) ?? this.handleKeyboardShortcuts(data);
	}

	private handleMouseInput(data: string): { consume?: boolean } | undefined {
		const mouseEvent = parseMouseEvent(data);
		if (!mouseEvent) {
			return undefined;
		}
		if (this.overlayController.getOverlayDepth() > 0) {
			this.overlayController.dispatchMouse(mouseEvent);
		} else {
			this.dispatchPaneMouse(mouseEvent);
		}
		this.tui.requestRender();
		return { consume: true };
	}

	private handleKeyboardShortcuts(data: string): { consume?: boolean } | undefined {
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
		const paneRects = calculatePaneRects(this.terminal.columns, 4, this.outerContent.maxHeight ?? 1, this.outerContent.rightWidth, this.innerContent.rightWidth);
		if (pointInRect(event, paneRects.browser)) {
			this.setFocusPane("browser");
			this.browserPanel.handleMouse?.(event, paneRects.browser);
			return;
		}
		if (pointInRect(event, paneRects.preview)) {
			this.setFocusPane("preview");
			this.previewPanel.handleMouse?.(event, paneRects.preview);
			return;
		}
		if (pointInRect(event, paneRects.controls)) {
			this.setFocusPane("controls");
			this.controlsPanel.handleMouse?.(event, paneRects.controls);
		}
	}

	private rebuildRuntime(): void {
		this.runtime?.dispose?.();
		const context = buildRuntimeContext({
			tui: this.tui,
			animationEngine: this.animationEngine,
			demos: this.demos,
			stateStore: this.stateStore,
			overlayController: this.overlayController,
			getThemeName: () => this.getThemeName(),
			updateControlValue: (controlId, value) => this.updateControlValue(controlId, value),
		});
		this.runtime = createRuntime(this.currentDemo(), this.currentValues(), context);
	}

	private resolveControlId(controlId: string): string {
		if (this.currentDemo().controls.some((control) => control.id === controlId)) {
			return controlId;
		}
		if (controlId === "width" && this.currentDemo().controls.some((control) => control.id === "cols")) {
			return "cols";
		}
		if (controlId === "height" && this.currentDemo().controls.some((control) => control.id === "rows")) {
			return "rows";
		}
		return controlId;
	}

	private currentControl(controlId: string): StyleTestControl | undefined {
		const resolvedControlId = this.resolveControlId(controlId);
		return this.currentDemo().controls.find((control) => control.id === resolvedControlId);
	}

	private adjustNumberControl(controlId: string, delta: number): void {
		adjustNumberControl(this.currentControl(controlId), this.currentValues()[this.resolveControlId(controlId)], delta, (value) => this.updateControlValue(controlId, value));
	}

	private toggleBooleanControl(controlId: string): void {
		toggleBooleanControl(this.currentControl(controlId), this.currentValues()[this.resolveControlId(controlId)], (value) => this.updateControlValue(controlId, value));
	}

	private editNumberControl(controlId: string): void {
		editNumberControl({
			control: this.currentControl(controlId),
			currentValue: this.currentValues()[this.resolveControlId(controlId)],
			stateStore: this.stateStore,
			overlayController: this.overlayController,
			setFocusPane: () => this.setFocusPane("controls"),
			update: (value) => this.updateControlValue(controlId, value),
		});
	}

	private cycleEnumControl(controlId: string, direction: number): void {
		cycleEnumControl(this.currentControl(controlId), this.currentValues()[this.resolveControlId(controlId)], direction, (value) => this.updateControlValue(controlId, value));
	}

	private editTextControl(controlId: string): void {
		editTextControl({
			control: this.currentControl(controlId),
			currentValue: this.currentValues()[this.resolveControlId(controlId)],
			stateStore: this.stateStore,
			overlayController: this.overlayController,
			setFocusPane: () => this.setFocusPane("controls"),
			update: (value) => this.updateControlValue(controlId, value),
		});
	}

	private resetCurrentDemo(): void {
		this.values.set(this.selectedDemoId, resetDemoValues(this.currentDemo(), this.currentPresetId()));
		this.rebuildRuntime();
		this.tui.requestRender();
	}

	private randomizeCurrentDemo(): void {
		this.values.set(this.selectedDemoId, randomizeDemoValues(this.currentDemo(), this.currentValues()));
		this.rebuildRuntime();
		this.tui.requestRender();
	}

	private cycleTheme(): void {
		cycleThemeName(this.getThemeName());
		this.rebuildRuntime();
		this.tui.requestRender();
	}

	private savePresetAs(): void {
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
	}

	private switchVariant(presetId: string): void {
		const demo = this.currentDemo();
		this.activePresetIds.set(this.selectedDemoId, presetId);
		if (demo.loadValues) {
			this.values.set(this.selectedDemoId, demo.loadValues(presetId));
		}
		this.rebuildRuntime();
		this.refreshChrome();
		this.tui.requestRender();
	}

	private applyPreset(presetId: string): void {
		const preset = this.currentDemo().presets?.find((entry) => entry.id === presetId);
		if (!preset) {
			return;
		}
		this.values.set(this.selectedDemoId, { ...this.currentValues(), ...preset.values });
		this.rebuildRuntime();
		this.tui.requestRender();
	}


	private runAction(actionId: string): void {
		this.dispatchAction(actionId);
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
