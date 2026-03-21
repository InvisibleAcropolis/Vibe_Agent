import { Container, Spacer, Text, type Focusable, type TUI } from "@mariozechner/pi-tui";
import { CustomEditor, getEditorTheme, type KeybindingsManager } from "../local-coding-agent.js";
import { createOverlayPreviewRuntime } from "../style-test-fixtures.js";
import { defineStyleTestDemos } from "../style-test-contract.js";
import { agentTheme } from "../theme.js";
import type { MouseAwareOverlay } from "../types.js";

export class EditorOverlay extends Container implements MouseAwareOverlay, Focusable {
	private readonly editor: CustomEditor;
	private _focused = false;

	constructor(
		tui: TUI,
		keybindings: KeybindingsManager,
		title: string,
		prefill: string,
		onSubmit: (value: string) => void,
		onClose: () => void,
	) {
		super();
		this.addChild(new Text(agentTheme.accentStrong(title), 1, 0));
		this.addChild(new Spacer(1));

		this.editor = new CustomEditor(tui, getEditorTheme(), keybindings, {
			paddingX: 1,
			autocompleteMaxVisible: 8,
		});
		this.editor.setText(prefill);
		this.editor.onSubmit = (value) => onSubmit(value);
		this.editor.onEscape = onClose;
		this.addChild(this.editor);
		this.addChild(new Spacer(1));
		this.addChild(new Text(agentTheme.dim("Enter submit  |  Esc cancel"), 1, 0));
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.editor.focused = value;
	}

	getEditor(): CustomEditor {
		return this.editor;
	}
}

export const styleTestDemos = defineStyleTestDemos({
	exports: {
		EditorOverlay: {
			title: "Editor Overlay",
			category: "Overlays",
			kind: "overlay",
			description: "Full editor overlay using the production prompt editor.",
			controls: [
				{ id: "prefill", label: "Prefill", type: "text", defaultValue: "const theme = cycleTheme(activeTheme);" },
			],
			createRuntime: (_moduleNamespace, _exportName, _exportValue, context, values) =>
				createOverlayPreviewRuntime(
					"Full editor overlay using the production prompt editor.",
					"src/components/editor-overlay.ts",
					() => context.openEditorPrompt("Editor Overlay", String(values.prefill)),
				),
		},
	},
});
