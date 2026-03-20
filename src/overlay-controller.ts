import { type Component, type OverlayHandle, type OverlayOptions, type TUI } from "@mariozechner/pi-tui";
import type { PiMonoAppDebugger } from "./app-debugger.js";
import type { AppStateStore } from "./app-state-store.js";
import { EditorOverlay } from "./components/editor-overlay.js";
import { FilterSelectOverlay, type OverlaySelectItem } from "./components/filter-select-overlay.js";
import { ShellMenuOverlay, type ShellMenuDefinition } from "./components/shell-menu-overlay.js";
import { TextPromptOverlay } from "./components/text-prompt-overlay.js";
import type { KeybindingsManager } from "./local-coding-agent.js";
import type { MouseEvent, Rect } from "./mouse.js";
import { pointInRect } from "./mouse.js";
import { resolveOverlayRect } from "./overlay-layout.js";
import type { OverlayRecord } from "./types.js";

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
	showCustomOverlay(id: string, component: Component, options: OverlayOptions): OverlayHandle;
	closeTopOverlay(): void;
	closeOverlay(id: string): void;
	closeAllOverlays(): void;
	dispatchMouse(event: MouseEvent): void;
	getOverlayDepth(): number;
}

export class DefaultOverlayController implements OverlayController {
	private readonly overlays: OverlayRecord[] = [];

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

	showCustomOverlay(id: string, component: Component, options: OverlayOptions): OverlayHandle {
		return this.showOverlay(id, component, options);
	}

	closeTopOverlay(): void {
		const overlay = this.overlays.pop();
		if (!overlay) {
			return;
		}
		this.debuggerSink.log("overlay.hide", { id: overlay.id, mode: "top" });
		overlay.hide();
		this.stateStore.removeOverlay(overlay.id);
		this.setFocus(this.overlays[this.overlays.length - 1]?.component ?? this.getFocusRestoreTarget(), "overlay.closeTop");
	}

	closeOverlay(id: string): void {
		const index = this.overlays.findIndex((entry) => entry.id === id);
		if (index === -1) {
			return;
		}
		const [overlay] = this.overlays.splice(index, 1);
		this.debuggerSink.log("overlay.hide", { id, mode: "specific" });
		overlay.hide();
		this.stateStore.removeOverlay(id);
		this.setFocus(this.overlays[this.overlays.length - 1]?.component ?? this.getFocusRestoreTarget(), `overlay.close:${id}`);
	}

	closeAllOverlays(): void {
		while (this.overlays.length > 0) {
			const overlay = this.overlays.pop();
			if (!overlay) {
				continue;
			}
			this.debuggerSink.log("overlay.hide", { id: overlay.id, mode: "all" });
			overlay.hide();
		}
		this.stateStore.clearOverlays();
	}

	dispatchMouse(event: MouseEvent): void {
		for (let index = this.overlays.length - 1; index >= 0; index--) {
			const overlay = this.overlays[index];
			const rect = resolveOverlayRect(overlay.component, overlay.options, this.tui.terminal.columns, this.tui.terminal.rows);
			if (!pointInRect(event, rect)) {
				return;
			}
			(overlay.component as { handleMouse?: (evt: MouseEvent, rect: Rect) => boolean }).handleMouse?.(event, rect);
			return;
		}
	}

	getOverlayDepth(): number {
		return this.overlays.length;
	}

	private showOverlay(id: string, component: Component, options: OverlayOptions): OverlayHandle {
		this.closeOverlay(id);
		this.debuggerSink.log("overlay.show", { id });
		const handle = this.tui.showOverlay(component, options);
		this.overlays.push({
			id,
			component,
			options,
			hide: () => handle.hide(),
		});
		this.stateStore.pushOverlay(id);
		this.setFocus(component, `overlay:${id}`);
		return {
			hide: () => this.closeOverlay(id),
			setHidden: (hidden) => handle.setHidden(hidden),
			isHidden: () => handle.isHidden(),
		};
	}
}
