import type { Component } from "@mariozechner/pi-tui";
import { createOverlayPreviewRuntime } from "../style-test-fixtures.js";
import { defineStyleTestDemos } from "../style-test-contract.js";
import { agentTheme } from "../theme.js";
import type { HostedSizeRequirements, HostedViewportDimensions } from "../types.js";

class HostedFixturePanel implements Component {
	private viewport: HostedViewportDimensions = { width: 1, height: 1 };

	constructor(
		private readonly title: string,
		private readonly sizing: HostedSizeRequirements,
		private readonly renderer: (viewport: HostedViewportDimensions) => string[],
	) {}

	invalidate(): void {}

	render(_width: number): string[] {
		return [
			agentTheme.accentStrong(this.title),
			agentTheme.dim(`viewport ${this.viewport.width}×${this.viewport.height}`),
			"",
			...this.renderer(this.viewport),
		];
	}

	getHostedSizeRequirements(): HostedSizeRequirements {
		return this.sizing;
	}

	setHostedViewportSize(viewport: HostedViewportDimensions): void {
		this.viewport = viewport;
	}
}

function menuFixture(): Component {
	return new HostedFixturePanel(
		"Floating Menu Host",
		{ minWidth: 28, minHeight: 8, preferredWidth: 36, preferredHeight: 12, maxWidth: 52, maxHeight: 18 },
		(viewport) => {
			const itemWidth = Math.max(12, Math.min(viewport.width - 6, 24));
			return [
				agentTheme.text("┌ Actions ───────────────┐"),
				agentTheme.text(`│ ${"Open Workspace".padEnd(itemWidth)} │`),
				agentTheme.text(`│ ${"> Theme Presets".padEnd(itemWidth)} │`),
				agentTheme.text(`│ ${"Inspect Overlay".padEnd(itemWidth)} │`),
				agentTheme.text("└────────────────────────┘"),
				agentTheme.dim("Use this host to inspect drag, focus, and overlap behavior."),
			];
		},
	);
}

function promptFixture(): Component {
	return new HostedFixturePanel(
		"Floating Prompt Host",
		{ minWidth: 32, minHeight: 8, preferredWidth: 44, preferredHeight: 11, maxWidth: 60, maxHeight: 16 },
		() => [
			agentTheme.text("Rename branch before publishing:"),
			agentTheme.dim("┌───────────────────────────────┐"),
			agentTheme.text("│ feature/floating-window-pass │"),
			agentTheme.dim("└───────────────────────────────┘"),
			agentTheme.dim("Enter submit  •  Esc cancel"),
		],
	);
}

function editorFixture(): Component {
	return new HostedFixturePanel(
		"Floating Editor Host",
		{ minWidth: 42, minHeight: 10, preferredWidth: 60, preferredHeight: 16, maxWidth: 84, maxHeight: 24 },
		(viewport) => {
			const codeWidth = Math.max(18, viewport.width - 4);
			return [
				agentTheme.dim("1  export function layoutFloatingWindow() {"),
				agentTheme.dim(`2    return { width: ${String(codeWidth).padEnd(3)}, mode: \"editor\" };`),
				agentTheme.dim("3  }"),
				"",
				agentTheme.text("Status: cursor + selection state should remain stable while resizing."),
			];
		},
	);
}

function animationFixture(frame: number): Component {
	return new HostedFixturePanel(
		"Floating Animation Host",
		{ minWidth: 24, minHeight: 8, preferredWidth: 40, preferredHeight: 12, maxWidth: 58, maxHeight: 18 },
		(viewport) => {
			const phases = ["⠁", "⠂", "⠄", "⠂"];
			const spinner = phases[frame % phases.length] ?? "⠁";
			const meterWidth = Math.max(8, viewport.width - 10);
			const fill = (frame % meterWidth) + 1;
			return [
				agentTheme.accent(`${spinner} reactive frame ${frame}`),
				agentTheme.text(`[${"█".repeat(fill)}${"·".repeat(Math.max(0, meterWidth - fill))}]`),
				agentTheme.dim("Resize to confirm the hosted viewport updates animation primitives cleanly."),
			];
		},
	);
}

export const styleTestDemos = defineStyleTestDemos({
	exports: {
		openFloatingMenuHost: {
			title: "Floating Menu Host",
			category: "Overlays",
			kind: "overlay",
			description: "Floating window fixture that hosts a representative action menu surface.",
			createRuntime: (_moduleNamespace, _exportName, _exportValue, context) =>
				createOverlayPreviewRuntime(
					"Floating window fixture that hosts a representative action menu surface.",
					"src/components/floating-window-hosts.ts",
					() => context.showOverlay("floating-menu-host", menuFixture(), { anchor: "top-left", row: 4, col: 8, width: 36, maxHeight: 12 }),
				),
		},
		openFloatingPromptHost: {
			title: "Floating Prompt Host",
			category: "Overlays",
			kind: "overlay",
			description: "Floating window fixture that hosts a text-prompt style surface for drag and resize checks.",
			createRuntime: (_moduleNamespace, _exportName, _exportValue, context) =>
				createOverlayPreviewRuntime(
					"Floating window fixture that hosts a text-prompt style surface for drag and resize checks.",
					"src/components/floating-window-hosts.ts",
					() => context.showOverlay("floating-prompt-host", promptFixture(), { anchor: "top-left", row: 5, col: 12, width: 44, maxHeight: 11 }),
				),
		},
		openFloatingEditorHost: {
			title: "Floating Editor Host",
			category: "Overlays",
			kind: "overlay",
			description: "Floating window fixture that hosts an editor-like surface with a larger minimum viewport.",
			createRuntime: (_moduleNamespace, _exportName, _exportValue, context) =>
				createOverlayPreviewRuntime(
					"Floating window fixture that hosts an editor-like surface with a larger minimum viewport.",
					"src/components/floating-window-hosts.ts",
					() => context.showOverlay("floating-editor-host", editorFixture(), { anchor: "top-left", row: 3, col: 10, width: 60, maxHeight: 16 }),
				),
		},
		openFloatingAnimationHost: {
			title: "Floating Animation Host",
			category: "Overlays",
			kind: "overlay",
			description: "Floating window fixture that hosts a lightweight animation primitive preview.",
			createRuntime: (_moduleNamespace, _exportName, _exportValue, context) =>
				createOverlayPreviewRuntime(
					"Floating window fixture that hosts a lightweight animation primitive preview.",
					"src/components/floating-window-hosts.ts",
					() => context.showOverlay("floating-animation-host", animationFixture(context.getAnimationState().spinnerFrame), { anchor: "top-left", row: 6, col: 18, width: 40, maxHeight: 12 }),
				),
		},
	},
});
