import { type Component, type OverlayHandle, type OverlayOptions, type TUI } from "@mariozechner/pi-tui";
import type { PiMonoAppDebugger } from "./app-debugger.js";
import type { AppStateStore } from "./app-state-store.js";
import { FloatWindow, adaptHostedComponent, type FloatWindowModel } from "./components/float_window.js";
import { EditorOverlay } from "./components/editor-overlay.js";
import { FilterSelectOverlay, type OverlaySelectItem } from "./components/filter-select-overlay.js";
import { ShellMenuOverlay, type ShellMenuDefinition } from "./components/shell-menu-overlay.js";
import { TextPromptOverlay } from "./components/text-prompt-overlay.js";
import type { KeybindingsManager } from "./local-coding-agent.js";
import type { MouseEvent, Rect } from "./mouse.js";
import { pointInRect } from "./mouse.js";
import { resolveOverlayRect } from "./overlay-layout.js";
import type { OverlayMousePolicy, OverlayOutsideClickPolicy, OverlayRecord } from "./types.js";
import type { HostedViewportDimensions } from "./types.js";

interface FramedOverlayComponent extends Component {
	getOverlayRect(): Rect;
	isPointerCaptureActive?(): boolean;
	setOverlayActive?(active: boolean, zIndex: number): void;
	setHostedViewportSize?(viewport: HostedViewportDimensions): void;
}

interface FloatingOverlayGeometry {
	row: number;
	col: number;
	width: number;
	height: number;
	active: boolean;
}

type OverlayOptionsWithMousePolicy = OverlayOptions & {
	minHeight?: number;
	maxWidth?: number;
	mousePolicy?: OverlayMousePolicy;
	floatingTitle?: string;
	floatingContentViewport?: HostedViewportDimensions;
	onHide?: () => void;
	onFloatingWindowStateChange?: (model: FloatWindowModel) => void;
};

export interface OverlayController {
	openSelectOverlay<T>(
		id: string,
		title: string,
		description: string,
		items: OverlaySelectItem<T>[],
		onSelect: (value: T) => void,
		onCancel?: () => void,
	): void;
	openTextPrompt(
		title: string,
		description: string,
		initialValue: string,
		onSubmit: (value: string) => void,
		onCancel?: () => void,
	): void;
	openEditorPrompt(title: string, prefill: string, onSubmit: (value: string) => void, onCancel: () => void): void;
	openMenuOverlay(id: string, definition: ShellMenuDefinition): void;
	showCustomOverlay(id: string, component: Component, options: OverlayOptionsWithMousePolicy): OverlayHandle;
	showFramedOverlay(id: string, component: Component, options: OverlayOptionsWithMousePolicy): OverlayHandle;
	updateFloatingOverlayGeometry(id: string, geometry: { row?: number; col?: number; width?: number; height?: number }): void;
	closeTopOverlay(): void;
	closeOverlay(id: string): void;
	closeAllOverlays(): void;
	dispatchMouse(event: MouseEvent): boolean;
	getOverlayDepth(): number;
}

export class DefaultOverlayController implements OverlayController {
	private readonly overlays: OverlayRecord[] = [];
	private readonly floatingGeometry = new Map<string, FloatingOverlayGeometry>();
	private capturedFloatingOverlayId?: string;

	constructor(
		private readonly tui: TUI,
		private readonly stateStore: AppStateStore,
		private readonly debuggerSink: PiMonoAppDebugger,
		private readonly keybindings: KeybindingsManager,
		private readonly getFocusRestoreTarget: () => Component | null,
		private readonly setFocus: (component: Component | null, label: string) => void,
	) {}

	openSelectOverlay<T>(
		id: string,
		title: string,
		description: string,
		items: OverlaySelectItem<T>[],
		onSelect: (value: T) => void,
		onCancel?: () => void,
	): void {
		this.showOverlay(
			id,
			new FilterSelectOverlay(
				title,
				description,
				items,
				(value) => onSelect(value),
				() => {
					onCancel?.();
					this.closeOverlay(id);
				},
			),
			{ width: 88, maxHeight: 18, anchor: "center", margin: 1 },
		);
	}

	openTextPrompt(
		title: string,
		description: string,
		initialValue: string,
		onSubmit: (value: string) => void,
		onCancel?: () => void,
	): void {
		const id = `text:${title}`;
		this.showOverlay(
			id,
			new TextPromptOverlay(
				title,
				description,
				(value) => {
					onSubmit(value);
					this.closeOverlay(id);
				},
				() => {
					onCancel?.();
					this.closeOverlay(id);
				},
				initialValue,
			),
			{ width: 72, maxHeight: 8, anchor: "center", margin: 1 },
		);
	}

	openEditorPrompt(title: string, prefill: string, onSubmit: (value: string) => void, onCancel: () => void): void {
		const id = `editor:${title}`;
		this.showOverlay(
			id,
			new EditorOverlay(
				this.tui,
				this.keybindings,
				title,
				prefill,
				(value) => {
					onSubmit(value);
					this.closeOverlay(id);
				},
				() => {
					onCancel();
					this.closeOverlay(id);
				},
			),
			{ width: "80%", maxHeight: "70%", anchor: "center", margin: 1 },
		);
	}

	openMenuOverlay(id: string, definition: ShellMenuDefinition): void {
		const width = Math.min(
			this.tui.terminal.columns - definition.anchor.col + 1,
			(definition.width ?? 38) + (definition.childWidth ?? 48) + 8,
		);
		this.showOverlay(
			id,
			new ShellMenuOverlay(
				definition,
				Math.min(22, this.tui.terminal.rows - definition.anchor.row + 1),
				() => this.closeOverlay(id),
			),
			{
				width,
				maxHeight: 22,
				anchor: "top-left",
				margin: {
					top: Math.max(0, definition.anchor.row),
					left: Math.max(0, definition.anchor.col - 1),
				},
			},
		);
	}

	showCustomOverlay(id: string, component: Component, options: OverlayOptionsWithMousePolicy): OverlayHandle {
		return this.showOverlay(id, component, options, { floating: true, title: options.floatingTitle ?? id });
	}

	showFramedOverlay(id: string, component: Component, options: OverlayOptionsWithMousePolicy): OverlayHandle {
		return this.showOverlay(id, component, options, { framed: true });
	}

	updateFloatingOverlayGeometry(id: string, geometry: { row?: number; col?: number; width?: number; height?: number }): void {
		const overlay = this.overlays.find((entry) => entry.id === id);
		if (!overlay) {
			return;
		}
		if (typeof geometry.row === "number") {
			if (overlay.window) {
				overlay.window.model.row = geometry.row;
			}
			overlay.options.row = geometry.row;
		}
		if (typeof geometry.col === "number") {
			if (overlay.window) {
				overlay.window.model.col = geometry.col;
			}
			overlay.options.col = geometry.col;
		}
		if (typeof geometry.width === "number") {
			if (overlay.window) {
				overlay.window.model.width = geometry.width;
			}
			overlay.options.width = geometry.width;
		}
		if (typeof geometry.height === "number") {
			if (overlay.window) {
				overlay.window.model.height = geometry.height;
			}
			overlay.options.maxHeight = geometry.height;
		}
		this.syncOverlayViewport(overlay);
		this.captureFloatingGeometry(overlay);
		this.tui.requestRender();
	}

	closeTopOverlay(): void {
		const overlay = this.overlays.pop();
		if (!overlay) {
			return;
		}
		this.releaseFloatingCaptureIfMatches(overlay.id);
		this.captureFloatingGeometry(overlay);
		this.debuggerSink.log("overlay.hide", { id: overlay.id, mode: "top" });
		overlay.hide();
		overlay.onHide?.();
		this.stateStore.removeOverlay(overlay.id);
		this.setFocus(this.overlays[this.overlays.length - 1]?.component ?? this.getFocusRestoreTarget(), "overlay.closeTop");
	}

	closeOverlay(id: string): void {
		const index = this.overlays.findIndex((entry) => entry.id === id);
		if (index === -1) {
			return;
		}
		const [overlay] = this.overlays.splice(index, 1);
		this.releaseFloatingCaptureIfMatches(id);
		this.captureFloatingGeometry(overlay);
		this.debuggerSink.log("overlay.hide", { id, mode: "specific" });
		overlay.hide();
		overlay.onHide?.();
		this.stateStore.removeOverlay(id);
		this.setFocus(this.overlays[this.overlays.length - 1]?.component ?? this.getFocusRestoreTarget(), `overlay.close:${id}`);
	}

	closeAllOverlays(): void {
		while (this.overlays.length > 0) {
			const overlay = this.overlays.pop();
			if (!overlay) {
				continue;
			}
			this.releaseFloatingCaptureIfMatches(overlay.id);
			this.captureFloatingGeometry(overlay);
			this.debuggerSink.log("overlay.hide", { id: overlay.id, mode: "all" });
			overlay.hide();
			overlay.onHide?.();
		}
		this.stateStore.clearOverlays();
	}

	dispatchMouse(event: MouseEvent): boolean {
		if (this.shouldRouteToCapturedFloatingOverlay(event)) {
			const captured = this.dispatchToCapturedFloatingOverlay(event);
			if (captured !== undefined) {
				this.tui.requestRender();
				return captured;
			}
		}

		for (let index = this.overlays.length - 1; index >= 0; index--) {
			let overlay = this.overlays[index];
			this.syncOverlayViewport(overlay);
			const rect = this.getOverlayRect(overlay);
			if (!pointInRect(event, rect)) {
				continue;
			}
			if (this.shouldBringToFront(overlay, event)) {
				overlay = this.bringOverlayToFront(index);
			}
			this.activateOverlay(this.overlays.indexOf(overlay));
			const handled = (overlay.component as { handleMouse?: (evt: MouseEvent, rect: Rect) => boolean }).handleMouse?.(event, rect) ?? true;
			this.syncFloatingCapture(overlay);
			this.tui.requestRender();
			return handled;
		}
		if (this.capturedFloatingOverlayId) {
			return false;
		}
		const outsideResult = this.applyOutsideClickPolicy(event);
		if (outsideResult !== "ignored") {
			this.tui.requestRender();
		}
		return outsideResult === "consumed";
	}

	getOverlayDepth(): number {
		return this.overlays.length;
	}

	private activateOverlay(activeIndex: number): void {
		for (let index = 0; index < this.overlays.length; index++) {
			const entry = this.overlays[index];
			if (entry.window) {
				entry.window.model.active = index === activeIndex;
				entry.window.model.zIndex = index;
				if (index === activeIndex) {
					this.captureFloatingGeometry(entry);
				}
				continue;
			}
			if (entry.framed) {
				(entry.component as FramedOverlayComponent).setOverlayActive?.(index === activeIndex, index);
				if (index === activeIndex) {
					this.captureFloatingGeometry(entry);
				}
			}
		}
	}

	private shouldBringToFront(overlay: OverlayRecord, event: MouseEvent): boolean {
		return this.isFramedLikeOverlay(overlay) && (overlay.mousePolicy?.activateOnLeftClick ?? true) && event.action === "down" && event.button === "left";
	}

	private bringOverlayToFront(index: number): OverlayRecord {
		const [overlay] = this.overlays.splice(index, 1);
		this.overlays.push(overlay);
		return overlay;
	}

	private applyOutsideClickPolicy(event: MouseEvent): "consumed" | "focus-cleared" | "ignored" {
		if (event.action !== "down" || event.button !== "left") {
			return "ignored";
		}
		for (let index = this.overlays.length - 1; index >= 0; index--) {
			const overlay = this.overlays[index];
			const policy = overlay.mousePolicy?.outsideClick ?? this.getDefaultOutsideClickPolicy(overlay);
			if (policy === "noop") {
				continue;
			}
			if (policy === "close") {
				this.closeOverlay(overlay.id);
				return "consumed";
			}
			this.setFocus(this.getFocusRestoreTarget(), `overlay.outside:${overlay.id}`);
			this.activateOverlay(-1);
			return "focus-cleared";
		}
		return "ignored";
	}

	private getDefaultOutsideClickPolicy(overlay: OverlayRecord): OverlayOutsideClickPolicy {
		return this.isFramedLikeOverlay(overlay) ? "clear-focus" : "noop";
	}

	private shouldRouteToCapturedFloatingOverlay(event: MouseEvent): boolean {
		return !!this.capturedFloatingOverlayId && (event.action === "drag" || event.action === "up");
	}

	private dispatchToCapturedFloatingOverlay(event: MouseEvent): boolean | undefined {
		const captured = this.overlays.find((overlay) => overlay.id === this.capturedFloatingOverlayId);
		if (!captured || !this.isFramedLikeOverlay(captured)) {
			this.capturedFloatingOverlayId = undefined;
			return undefined;
		}
		this.syncOverlayViewport(captured);
		const rect = this.getOverlayRect(captured);
		this.activateOverlay(this.overlays.indexOf(captured));
		const handled = (captured.component as { handleMouse?: (evt: MouseEvent, rect: Rect) => boolean }).handleMouse?.(event, rect) ?? true;
		this.syncFloatingCapture(captured);
		return handled;
	}

	private syncFloatingCapture(overlay: OverlayRecord): void {
		if (!this.isFramedLikeOverlay(overlay)) {
			return;
		}
		if (this.isOverlayPointerCaptureActive(overlay)) {
			this.capturedFloatingOverlayId = overlay.id;
			return;
		}
		this.releaseFloatingCaptureIfMatches(overlay.id);
	}

	private releaseFloatingCaptureIfMatches(id: string): void {
		if (this.capturedFloatingOverlayId === id) {
			this.capturedFloatingOverlayId = undefined;
		}
	}

	private getOverlayRect(overlay: OverlayRecord): Rect {
		if (overlay.window) {
			return {
				row: overlay.window.model.row,
				col: overlay.window.model.col,
				width: overlay.window.model.width,
				height: overlay.window.model.height,
			};
		}
		if (overlay.framed) {
			return (overlay.component as FramedOverlayComponent).getOverlayRect();
		}
		return resolveOverlayRect(overlay.component, overlay.options, this.tui.terminal.columns, this.tui.terminal.rows);
	}

	private captureFloatingGeometry(overlay: OverlayRecord): void {
		if (!this.isFramedLikeOverlay(overlay)) {
			return;
		}
		const rect = this.getOverlayRect(overlay);
		this.floatingGeometry.set(overlay.id, { row: rect.row, col: rect.col, width: rect.width, height: rect.height, active: true });
	}

	private showOverlay(
		id: string,
		component: Component,
		options: OverlayOptionsWithMousePolicy,
		config?: { floating?: boolean; framed?: boolean; title?: string },
	): OverlayHandle {
		this.closeOverlay(id);
		this.debuggerSink.log("overlay.show", { id, floating: config?.floating ?? false });

		let renderedComponent = component;
		const renderedOptions: OverlayOptions = { ...options };
		let window: FloatWindow | undefined;

		if (config?.floating) {
			const initialRect = this.floatingGeometry.get(id) ?? resolveOverlayRect(component, renderedOptions, this.tui.terminal.columns, this.tui.terminal.rows);
			if (options.floatingContentViewport) {
				initialRect.width = Math.max(10, options.floatingContentViewport.width + 2);
				initialRect.height = Math.max(8, options.floatingContentViewport.height + 4);
			}
			window = new FloatWindow({
				title: config.title ?? id,
				content: adaptHostedComponent(component),
				initialState: {
					row: initialRect.row,
					col: initialRect.col,
					width: initialRect.width,
					height: initialRect.height,
					active: true,
					zIndex: this.overlays.length,
				},
				minWidth: options.minWidth,
				minHeight: typeof options.minHeight === "number" ? options.minHeight : undefined,
				maxWidth: typeof options.maxWidth === "number" ? options.maxWidth : undefined,
				maxHeight: typeof options.maxHeight === "number" ? options.maxHeight : undefined,
				onStateChange: (model) => {
					renderedOptions.row = model.row;
					renderedOptions.col = model.col;
					renderedOptions.width = model.width;
					renderedOptions.maxHeight = model.height;
					this.floatingGeometry.set(id, {
						row: model.row,
						col: model.col,
						width: model.width,
						height: model.height,
						active: model.active,
					});
					options.onFloatingWindowStateChange?.(model);
					this.tui.requestRender();
				},
			});
			window.setViewportSize({ width: this.tui.terminal.columns, height: this.tui.terminal.rows });
			renderedComponent = window;
			renderedOptions.anchor = "top-left";
			renderedOptions.row = window.model.row;
			renderedOptions.col = window.model.col;
			renderedOptions.width = window.model.width;
			renderedOptions.maxHeight = window.model.height;
		} else if (config?.framed) {
			const framedComponent = component as FramedOverlayComponent;
			framedComponent.setHostedViewportSize?.({ width: this.tui.terminal.columns, height: this.tui.terminal.rows });
			const rect = framedComponent.getOverlayRect();
			renderedOptions.anchor = "top-left";
			renderedOptions.row = rect.row;
			renderedOptions.col = rect.col;
			renderedOptions.width = rect.width;
			renderedOptions.maxHeight = rect.height;
		}

		const handle = this.tui.showOverlay(renderedComponent, renderedOptions);
		const record: OverlayRecord = {
			id,
			component: renderedComponent,
			options: renderedOptions,
			handle,
			window,
			framed: config?.framed ?? false,
			mousePolicy: options.mousePolicy,
			onHide: options.onHide,
			onFloatingWindowStateChange: options.onFloatingWindowStateChange,
			hide: () => handle.hide(),
		};
		this.overlays.push(record);
		this.stateStore.pushOverlay(id);
		this.setFocus(component, `overlay:${id}`);
		return {
			hide: () => this.closeOverlay(id),
			setHidden: (hidden) => handle.setHidden(hidden),
			isHidden: () => handle.isHidden(),
		};
	}

	private syncOverlayViewport(overlay: OverlayRecord): void {
		if (overlay.window) {
			overlay.window.setViewportSize({ width: this.tui.terminal.columns, height: this.tui.terminal.rows });
			return;
		}
		if (overlay.framed) {
			(overlay.component as FramedOverlayComponent).setHostedViewportSize?.({
				width: this.tui.terminal.columns,
				height: this.tui.terminal.rows,
			});
		}
	}

	private isFramedLikeOverlay(overlay: OverlayRecord): boolean {
		return !!overlay.window || !!overlay.framed;
	}

	private isOverlayPointerCaptureActive(overlay: OverlayRecord): boolean {
		if (overlay.window) {
			return !!overlay.window.model.dragState || !!overlay.window.model.resizeState;
		}
		if (overlay.framed) {
			return (overlay.component as FramedOverlayComponent).isPointerCaptureActive?.() ?? false;
		}
		return false;
	}
}
