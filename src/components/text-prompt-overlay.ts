import { Input, matchesKey, type Focusable } from "@mariozechner/pi-tui";
import { paintLine } from "../ansi.js";
import { createOverlayPreviewRuntime } from "../style-test-fixtures.js";
import { defineStyleTestDemos } from "../style-test-contract.js";
import { agentTheme } from "../theme.js";
import type { MouseAwareOverlay } from "../types.js";

export class TextPromptOverlay implements MouseAwareOverlay, Focusable {
	private readonly input = new Input();
	private _focused = false;

	constructor(
		private readonly title: string,
		private readonly description: string,
		private readonly onSubmit: (value: string) => void,
		private readonly onClose: () => void,
		initialValue = "",
	) {
		this.input.setValue(initialValue);
		this.input.onSubmit = (value) => this.onSubmit(value.trim());
		this.input.onEscape = this.onClose;
	}

	invalidate(): void {
		this.input.invalidate();
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	render(width: number): string[] {
		const top = agentTheme.dim("╭" + "─".repeat(Math.max(0, width - 2)) + "╮");
		const bottom = agentTheme.dim("╰" + "─".repeat(Math.max(0, width - 2)) + "╯");
		return [
			paintLine(top, width, agentTheme.panelBgActive),
			paintLine(agentTheme.accentStrong(this.title), width, agentTheme.panelBgActive),
			paintLine(agentTheme.muted(this.description), width, agentTheme.panelBgActive),
			paintLine("", width, agentTheme.panelBgActive),
			...this.input.render(width).map((line) => paintLine(line, width, agentTheme.panelBgActive)),
			paintLine("", width, agentTheme.panelBgActive),
			paintLine(agentTheme.dim("Enter submit  |  Esc cancel"), width, agentTheme.panelBgActive),
			paintLine(bottom, width, agentTheme.panelBgActive),
		];
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "esc")) {
			this.onClose();
			return;
		}
		this.input.handleInput(data);
	}
}

export const styleTestDemos = defineStyleTestDemos({
	exports: {
		TextPromptOverlay: {
			title: "Text Prompt Overlay",
			category: "Overlays",
			kind: "overlay",
			description: "Production text prompt overlay used for inline edits.",
			controls: [
				{ id: "initialValue", label: "Initial Value", type: "text", defaultValue: "Arc Reactor" },
			],
			createRuntime: (_moduleNamespace, _exportName, _exportValue, context, values) =>
				createOverlayPreviewRuntime(
					"Production text prompt overlay used for inline edits.",
					"src/components/text-prompt-overlay.ts",
					() =>
						context.showOverlay(
							"styletest-text-prompt",
							new TextPromptOverlay(
								"Prompt Overlay",
								"Editing demo text uses the same overlay component.",
								() => context.closeOverlay("styletest-text-prompt"),
								() => context.closeOverlay("styletest-text-prompt"),
								String(values.initialValue),
							),
							{ width: 72, maxHeight: 8, anchor: "center", margin: 1 },
						),
				),
		},
	},
});
