import type { Component, OverlayHandle, OverlayOptions, TUI } from "@mariozechner/pi-tui";
import {
	type ExtensionUIContext,
	getAvailableThemesWithPaths,
	getThemeByName,
	type KeybindingsManager,
	setTheme as setAgentTheme,
	theme as agentTheme,
	type Theme,
} from "./local-coding-agent.js";
import type { PiMonoAppDebugger } from "./app-debugger.js";
import type { AppStateStore } from "./app-state-store.js";
import type { CommandController } from "./command-controller.js";
import type { EditorController } from "./editor-controller.js";
import type { OverlayController } from "./overlay-controller.js";
import type { ShellView } from "./shell-view.js";

type TerminalInputHandler = (data: string) => { consume?: boolean; data?: string } | undefined;
type WidgetFactory = (tui: TUI, theme: Theme) => Component & { dispose?(): void };
type FooterFactory = (tui: TUI, theme: Theme, footerData: ShellView["footerData"]) => Component & { dispose?(): void };
type HeaderFactory = (tui: TUI, theme: Theme) => Component & { dispose?(): void };
type EditorFactory = (...args: any[]) => ReturnType<EditorController["getComponent"]>;

export interface ExtensionUiHost {
	createContext(): ExtensionUIContext;
}

export class DefaultExtensionUiHost implements ExtensionUiHost {
	private readonly customFocusOwners = new Set<string>();
	private customFocusOwnerCounter = 0;

	constructor(
		private readonly shellView: ShellView,
		private readonly stateStore: AppStateStore,
		private readonly editorController: EditorController,
		private readonly overlayController: OverlayController,
		private readonly commandController: CommandController,
		private readonly debuggerSink: PiMonoAppDebugger,
		private readonly keybindings: KeybindingsManager,
		private readonly registerTerminalInputHandler: (handler: TerminalInputHandler) => () => void,
		private readonly setFocus: (component: Component | null, label: string) => void,
	) {}

	createContext(): ExtensionUIContext {
		return {
			select: async (title, options) =>
				await new Promise<string | undefined>((resolve) => {
					this.overlayController.openSelectOverlay(
						`select:${title}`,
						title,
						"Choose an option.",
						options.map((option) => ({ value: option, label: option })),
						(value) => resolve(value),
						() => resolve(undefined),
					);
				}),
			confirm: async (title, message) =>
				await new Promise<boolean>((resolve) => {
					this.overlayController.openSelectOverlay(
						`confirm:${title}`,
						title,
						message,
						[
							{ value: true, label: "Yes" },
							{ value: false, label: "No" },
						],
						(value) => resolve(value),
						() => resolve(false),
					);
				}),
			input: async (title, placeholder) =>
				await new Promise<string | undefined>((resolve) => {
					this.overlayController.openTextPrompt(title, placeholder ?? "Enter a value.", "", (value) => resolve(value), () =>
						resolve(undefined),
					);
				}),
			notify: (message, type) => {
				this.debuggerSink.log("extension.notify", { type: type ?? "info", length: message.length });
				this.stateStore.setStatusMessage(`${type ?? "info"}: ${message}`);
			},
			onTerminalInput: (handler) => this.registerTerminalInputHandler(handler),
			setStatus: (key, text) => {
				this.shellView.footerData.setExtensionStatus(key, text);
				this.shellView.refresh();
			},
			setWorkingMessage: (message) => this.stateStore.setWorkingMessage(message),
			setWidget: (key, content, options) => {
				if (this.shellView.implementation === "opentui") {
					return;
				}
				this.shellView.setWidget(key, content as WidgetFactory | string[] | undefined, options?.placement);
			},
			setFooter: (factory) => {
				if (this.shellView.implementation === "opentui") {
					return;
				}
				this.shellView.setFooterFactory(factory as FooterFactory | undefined);
			},
			setHeader: (factory) => {
				if (this.shellView.implementation === "opentui") {
					return;
				}
				this.shellView.setHeaderFactory(factory as HeaderFactory | undefined);
			},
			setTitle: (title) => this.shellView.setTitle(title),
			custom: async <T,>(
				factory: (
					tui: TUI,
					theme: Theme,
					keybindings: KeybindingsManager,
					done: (result: T) => void,
				) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
				options?: {
					overlay?: boolean;
					overlayOptions?: OverlayOptions | (() => OverlayOptions);
					onHandle?: (handle: OverlayHandle) => void;
				},
			): Promise<T> =>
				await new Promise<T>((resolve, reject) => {
					const legacyTui = (this.shellView as ShellView & { tui?: TUI }).tui;
					if (!legacyTui) {
						reject(new Error("Custom extension components are not available in the OpenTUI shell."));
						return;
					}
					const savedText = this.editorController.getText();
					const isOverlay = options?.overlay ?? false;
					const focusOwner = `extension-ui-custom-${++this.customFocusOwnerCounter}`;
					let component: (Component & { dispose?(): void }) | undefined;
					let overlayHandle: OverlayHandle | undefined;
					let completed = false;

					const releaseFocusOwner = () => {
						this.customFocusOwners.delete(focusOwner);
					};

					const done = (result: T) => {
						if (completed) {
							return;
						}
						completed = true;
						overlayHandle?.hide();
						if (!isOverlay && this.customFocusOwners.has(focusOwner)) {
							this.editorController.restoreText(savedText);
							this.shellView.setFocus(this.editorController.getComponent());
						}
						releaseFocusOwner();
						component?.dispose?.();
						resolve(result);
					};

					Promise.resolve(factory(legacyTui, agentTheme, this.keybindings, done))
						.then((created) => {
							component = created;
							if (isOverlay) {
								const overlayOptions =
									typeof options?.overlayOptions === "function"
										? options.overlayOptions()
										: (options?.overlayOptions ?? { width: "70%", maxHeight: "70%", anchor: "center", margin: 1 });
								overlayHandle = this.overlayController.showCustomOverlay("extension-custom", component, overlayOptions) as OverlayHandle;
								options?.onHandle?.(overlayHandle);
								this.customFocusOwners.add(focusOwner);
								this.setFocus(component, "extension.custom.overlay");
								return;
							}

							this.customFocusOwners.add(focusOwner);
							this.shellView.setEditor(component);
							this.setFocus(component, "extension.custom.inline");
						})
						.catch((error) => {
							releaseFocusOwner();
							reject(error);
						});
				}),
			pasteToEditor: (text) => this.editorController.paste(text),
			setEditorText: (text) => this.editorController.setText(text),
			getEditorText: () => this.editorController.getText(),
			editor: async (title, prefill) =>
				await new Promise<string | undefined>((resolve) => {
					this.overlayController.openEditorPrompt(title, prefill ?? "", (value) => resolve(value), () => resolve(undefined));
				}),
			setEditorComponent: (factory) => this.editorController.replaceEditor(factory as unknown as EditorFactory | undefined),
			get theme() {
				return agentTheme;
			},
			getAllThemes: () => getAvailableThemesWithPaths(),
			getTheme: (name) => getThemeByName(name),
			setTheme: (theme) => {
				const result = setAgentTheme(typeof theme === "string" ? theme : (theme.name ?? "dark"), false);
				this.shellView.refresh();
				this.shellView.requestRender();
				return result;
			},
			getToolsExpanded: () => this.stateStore.getState().toolOutputExpanded,
			setToolsExpanded: (expanded) => {
				this.stateStore.setToolOutputExpanded(expanded);
				this.shellView.refresh();
				this.shellView.requestRender();
			},
		};
	}
}
