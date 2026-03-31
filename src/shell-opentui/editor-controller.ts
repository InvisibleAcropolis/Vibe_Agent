import { createHash } from "node:crypto";
import type { KeyEvent } from "@opentui/core";
import type { PiMonoAppDebugger } from "../app-debugger.js";
import type { AppStateStore } from "../app-state-store.js";
import type { KeybindingsManager } from "../local-coding-agent.js";

type EditorFactory = (...args: any[]) => unknown;

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

export interface OpenTuiEditorComponent {
	readonly kind: "opentui-editor";
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

export class OpenTuiEditorController {
	readonly keybindings: KeybindingsManager;
	private readonly defaultEditor: OpenTuiEditorComponent = { kind: "opentui-editor" };
	private editor: unknown = this.defaultEditor;
	private text = "";
	private cursor = { line: 1, col: 1 };

	constructor(
		keybindings: KeybindingsManager,
		private readonly stateStore: AppStateStore,
		private readonly debuggerSink: PiMonoAppDebugger,
		private readonly handlers: EditorControllerHandlers,
		private readonly onEditorChanged: (component: unknown) => void,
	) {
		this.keybindings = keybindings;
	}

	getComponent(): unknown {
		return this.editor;
	}

	getText(): string {
		return this.text;
	}

	setText(text: string): void {
		this.text = text;
		this.cursor = this.measureCursor(text);
		this.debuggerSink.log("editor.setText", describeText(text, this.debuggerSink));
	}

	getCursor(): { line: number; col: number } | undefined {
		return this.cursor;
	}

	paste(text: string): void {
		this.debuggerSink.log("editor.paste", this.debuggerSink.describeInput(`\x1b[200~${text}\x1b[201~`));
		this.setText(`${this.text}${text}`);
	}

	addToHistory(_text: string): void {}

	replaceEditor(factory?: EditorFactory): void {
		if (!factory) {
			this.editor = this.defaultEditor;
			this.onEditorChanged(this.editor);
			return;
		}
		this.stateStore.setStatusMessage("Custom editor components are not available in the OpenTUI shell.");
	}

	restoreText(text: string): void {
		this.setText(text);
		this.onEditorChanged(this.editor);
	}

	updateFromView(text: string, cursor?: { line: number; col: number }): void {
		this.text = text;
		this.cursor = cursor ?? this.measureCursor(text);
		this.debuggerSink.log("editor.change", {
			...describeText(text, this.debuggerSink),
			cursor: this.cursor,
		});
	}

	async handleKeyEvent(event: KeyEvent): Promise<boolean> {
		if (event.ctrl && event.name === "p" && !event.shift) {
			this.handlers.onCycleModelForward();
			return true;
		}
		if (event.ctrl && event.name === "p" && event.shift) {
			this.handlers.onCycleModelBackward();
			return true;
		}
		if (event.ctrl && event.name === "l") {
			this.handlers.onSelectModel();
			return true;
		}
		if (event.ctrl && event.name === "o") {
			this.handlers.onExpandTools();
			return true;
		}
		if (event.ctrl && event.name === "t") {
			this.handlers.onToggleThinking();
			return true;
		}
		if (event.shift && event.name === "tab") {
			this.handlers.onCycleThinkingLevel();
			return true;
		}
		if (event.meta && (event.name === "return" || event.name === "enter")) {
			await this.handlers.onSubmit(this.text, "followUp");
			return true;
		}
		if ((event.name === "escape" || event.name === "esc") && !this.text.trim()) {
			this.handlers.onOpenCommandPalette();
			return true;
		}
		if ((event.name === "escape" || event.name === "esc") && this.handlers.isStreaming()) {
			this.handlers.onAbort();
			return true;
		}
		if (event.ctrl && event.name === "d" && !this.text.trim()) {
			this.handlers.onStop();
			return true;
		}
		return false;
	}

	async submit(streamingBehavior: "steer" | "followUp"): Promise<void> {
		await this.handlers.onSubmit(this.text, streamingBehavior);
	}

	private measureCursor(text: string): { line: number; col: number } {
		const lines = text.split(/\r?\n/);
		const line = Math.max(1, lines.length);
		const currentLine = lines.at(-1) ?? "";
		return { line, col: currentLine.length + 1 };
	}
}
