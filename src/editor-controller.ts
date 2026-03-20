import { createHash } from "node:crypto";
import type { TUI } from "@mariozechner/pi-tui";
import type { PiMonoAppDebugger } from "./app-debugger.js";
import type { AppStateStore } from "./app-state-store.js";
import { CustomEditor, getEditorTheme, type KeybindingsManager } from "./local-coding-agent.js";
import type { AppEditorComponent } from "./types.js";

type EditorFactory = (tui: TUI, theme: ReturnType<typeof getEditorTheme>, keybindings: KeybindingsManager) => AppEditorComponent;

interface EditorControllerHandlers {
	onOpenCommandPalette: () => void;
	onAbort: () => void;
	onStop: () => void;
	isStreaming: () => boolean;
	onCycleThinkingLevel: () => void;
	onCycleModelForward: () => void;
	onCycleModelBackward: () => void;
	onSelectModel: () => void;
	onExpandTools: () => void;
	onToggleThinking: () => void;
	onSubmit: (text: string, streamingBehavior: "steer" | "followUp") => Promise<void>;
}

export interface EditorController {
	readonly keybindings: KeybindingsManager;
	getComponent(): AppEditorComponent;
	getText(): string;
	setText(text: string): void;
	getCursor(): { line: number; col: number } | undefined;
	paste(text: string): void;
	addToHistory(text: string): void;
	replaceEditor(factory?: EditorFactory): void;
	restoreText(text: string): void;
}

function describeText(text: string, debuggerSink: PiMonoAppDebugger): Record<string, unknown> {
	return {
		length: text.length,
		lines: text.length === 0 ? 1 : text.split(/\r?\n/).length,
		hash: createHash("sha1").update(text).digest("hex").slice(0, 12),
		redacted: true,
		kind: debuggerSink.describeInput(text).kind,
	};
}

export class DefaultEditorController implements EditorController {
	readonly keybindings: KeybindingsManager;
	private readonly defaultEditor: CustomEditor;
	private editor: AppEditorComponent;
	private readonly tui: TUI;

	constructor(
		tui: TUI,
		keybindings: KeybindingsManager,
		private readonly stateStore: AppStateStore,
		private readonly debuggerSink: PiMonoAppDebugger,
		private readonly handlers: EditorControllerHandlers,
		private readonly onEditorChanged: (component: AppEditorComponent) => void,
	) {
		this.tui = tui;
		this.keybindings = keybindings;
		this.defaultEditor = new CustomEditor(tui, getEditorTheme(), keybindings, {
			paddingX: 1,
			autocompleteMaxVisible: 8,
		});
		this.editor = this.defaultEditor;
		this.configureEditor(this.defaultEditor);
	}

	getComponent(): AppEditorComponent {
		return this.editor;
	}

	getText(): string {
		return this.editor.getText();
	}

	setText(text: string): void {
		this.debuggerSink.log("editor.setText", describeText(text, this.debuggerSink));
		this.editor.setText(text);
	}

	getCursor(): { line: number; col: number } | undefined {
		const editorWithCursor = this.editor as AppEditorComponent & { getCursor?: () => { line: number; col: number } };
		return editorWithCursor.getCursor?.();
	}

	paste(text: string): void {
		this.debuggerSink.log("editor.paste", this.debuggerSink.describeInput(`\x1b[200~${text}\x1b[201~`));
		this.editor.handleInput(`\x1b[200~${text}\x1b[201~`);
	}

	addToHistory(text: string): void {
		this.editor.addToHistory?.(text);
	}

	replaceEditor(factory?: EditorFactory): void {
		const currentText = this.editor.getText();
		this.debuggerSink.log("editor.replace", { custom: !!factory, currentLength: currentText.length });
		if (!factory) {
			this.editor = this.defaultEditor;
			this.editor.setText(currentText);
			this.onEditorChanged(this.editor);
			return;
		}

		const customEditor = factory(this.tui, getEditorTheme(), this.keybindings);
		customEditor.setText(currentText);
		this.editor = customEditor;
		this.onEditorChanged(this.editor);
	}

	restoreText(text: string): void {
		this.editor.setText(text);
		this.onEditorChanged(this.editor);
	}

	private configureEditor(editor: CustomEditor): void {
		editor.onChange = (text) => {
			this.debuggerSink.log("editor.change", {
				...describeText(text, this.debuggerSink),
				cursor: this.getCursor(),
			});
		};
		editor.onEscape = () => {
			this.debuggerSink.log("editor.escape", { textLength: editor.getText().length });
			if (this.handlers.isStreaming()) {
				this.handlers.onAbort();
				return;
			}
			if (!editor.getText().trim()) {
				this.handlers.onOpenCommandPalette();
			}
		};
		editor.onCtrlD = () => {
			this.debuggerSink.log("editor.ctrlD", { textLength: editor.getText().length });
			if (!editor.getText().trim()) {
				this.handlers.onStop();
			}
		};
		editor.onAction("clear", () => editor.setText(""));
		editor.onAction("cycleThinkingLevel", () => this.handlers.onCycleThinkingLevel());
		editor.onAction("cycleModelForward", () => this.handlers.onCycleModelForward());
		editor.onAction("cycleModelBackward", () => this.handlers.onCycleModelBackward());
		editor.onAction("selectModel", () => this.handlers.onSelectModel());
		editor.onAction("expandTools", () => this.handlers.onExpandTools());
		editor.onAction("toggleThinking", () => this.handlers.onToggleThinking());
		editor.onAction("followUp", () => void this.handlers.onSubmit(editor.getText(), "followUp"));
		editor.onSubmit = async (text) => {
			await this.handlers.onSubmit(text, "steer");
		};
	}
}
