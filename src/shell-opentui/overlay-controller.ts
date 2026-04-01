import type { ShellMenuDefinition } from "../components/shell-menu-overlay.js";
import type { MouseEvent } from "../mouse.js";
import type { OverlayController, OverlayOptionsWithMousePolicy, ShellOverlayHandle } from "../overlay-controller.js";
import type { OpenTuiShellView } from "./shell-opentui-view.js";

export class OpenTuiOverlayController implements OverlayController {
	constructor(private readonly shellView: OpenTuiShellView) {}

	openSelectOverlay<T>(
		id: string,
		title: string,
		description: string,
		items: Array<{ value: T; label: string; description?: string }>,
		onSelect: (value: T) => void,
		onCancel?: () => void,
	): void {
		this.shellView.openSelectOverlay(id, title, description, items, onSelect, onCancel);
	}

	openTextPrompt(
		title: string,
		description: string,
		initialValue: string,
		onSubmit: (value: string) => void,
		onCancel?: () => void,
	): void {
		this.shellView.openTextPrompt(title, description, initialValue, onSubmit, onCancel);
	}

	openEditorPrompt(title: string, prefill: string, onSubmit: (value: string) => void, onCancel: () => void): void {
		this.shellView.openEditorPrompt(title, prefill, onSubmit, onCancel);
	}

	openMenuOverlay(id: string, definition: ShellMenuDefinition): void {
		this.shellView.openMenuOverlay(id, definition);
	}

	showCustomOverlay(id: string, component: unknown, options: OverlayOptionsWithMousePolicy): ShellOverlayHandle {
		return this.shellView.showCustomOverlay(id, component, options);
	}

	showFramedOverlay(id: string, component: unknown, options: OverlayOptionsWithMousePolicy): ShellOverlayHandle {
		return this.shellView.showCustomOverlay(id, component, options);
	}

	updateFloatingOverlayGeometry(_id: string, _geometry: { row?: number; col?: number; width?: number; height?: number }): void {}

	closeTopOverlay(): void {
		this.shellView.closeTopOverlay();
	}

	closeOverlay(id: string): void {
		this.shellView.closeOverlay(id);
	}

	closeAllOverlays(): void {
		this.shellView.closeAllOverlays();
	}

	dispatchMouse(event: MouseEvent): boolean {
		return this.shellView.dispatchMouse(event);
	}

	getOverlayDepth(): number {
		return this.shellView.getOverlayDepth();
	}
}
