import type { KeyEvent } from "@opentui/core";

export interface LegacyRenderableLike {
	render(width: number): string[];
	handleInput?(data: string): void;
	invalidate?(): void;
	focused?: boolean;
	dispose?(): void;
}

export function isLegacyRenderableLike(value: unknown): value is LegacyRenderableLike {
	return typeof value === "object" && value !== null && typeof (value as { render?: unknown }).render === "function";
}

export function renderLegacyRenderable(value: unknown, width: number): string[] {
	if (!isLegacyRenderableLike(value)) {
		return [];
	}
	try {
		return value.render(Math.max(1, width));
	} catch (error) {
		return [`[legacy render failed: ${error instanceof Error ? error.message : String(error)}]`];
	}
}

export function focusLegacyRenderable(value: unknown, focused: boolean): void {
	if (!isLegacyRenderableLike(value)) {
		return;
	}
	if ("focused" in value) {
		try {
			value.focused = focused;
		} catch {
			// Ignore focus bridge failures for legacy components.
		}
	}
}

export function dispatchLegacyKey(value: unknown, event: KeyEvent): boolean {
	if (!isLegacyRenderableLike(value) || typeof value.handleInput !== "function") {
		return false;
	}
	value.handleInput(event.raw || event.sequence || "");
	return true;
}

export function disposeLegacyRenderable(value: unknown): void {
	if (isLegacyRenderableLike(value)) {
		value.dispose?.();
	}
}
