/** @jsxImportSource @opentui/solid */
import { createCliRenderer, type CliRenderer, type KeyEvent, type ScrollBoxRenderable, type SelectOption } from "@opentui/core";
import { Portal, render as renderSolid, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { AgentHostState } from "../agent-host.js";
import type { AppShellState, AppStateStore } from "../app-state-store.js";
import { FooterDataProvider } from "../footer-data-provider.js";
import type { MouseEvent } from "../mouse.js";
import type { OverlayOptionsWithMousePolicy, ShellOverlayHandle } from "../overlay-controller.js";
import type { ShellView } from "../shell-view.js";
import type { NormalizedTranscriptPublication } from "../shell/transcript-publication.js";
import type { ShellMenuDefinition, ShellMenuItem } from "../components/shell-menu-overlay.js";
import { dispatchLegacyKey, disposeLegacyRenderable, focusLegacyRenderable, renderLegacyRenderable } from "./legacy-adapter.js";
import type { OpenTuiEditorComponent, OpenTuiEditorController } from "./editor-controller.js";

type WidgetPlacement = "aboveEditor" | "belowEditor";

type OverlayRecord =
	| {
		id: string;
		kind: "select";
		title: string;
		description: string;
		items: Array<{ value: unknown; label: string; description?: string }>;
		selectedIndex: number;
		onSelect: (value: unknown) => void;
		onCancel?: () => void;
	}
	| {
		id: string;
		kind: "text-prompt";
		title: string;
		description: string;
		value: string;
		onSubmit: (value: string) => void;
		onCancel?: () => void;
	}
	| {
		id: string;
		kind: "editor-prompt";
		title: string;
		description: string;
		value: string;
		onSubmit: (value: string) => void;
		onCancel: () => void;
	}
	| {
		id: string;
		kind: "menu";
		title: string;
		description?: string;
		items: ShellMenuItem[];
		selectedIndex: number;
		parent?: OverlayRecord;
	}
	| {
		id: string;
		kind: "legacy";
		title: string;
		component: unknown;
		options: OverlayOptionsWithMousePolicy;
	};

interface OpenTuiShellSnapshot {
	headerLines: string[];
	footerLines: string[];
	widgetsAbove: string[];
	widgetsBelow: string[];
	editor: unknown;
	overlays: OverlayRecord[];
	width: number;
	height: number;
	transcriptLines: string[];
	statusLine: string;
	hintLine: string;
	metaLine: string;
}

function isOpenTuiEditor(value: unknown): value is OpenTuiEditorComponent {
	return typeof value === "object" && value !== null && (value as { kind?: string }).kind === "opentui-editor";
}

function menuItemToOption(item: ShellMenuItem): SelectOption {
	return {
		name: item.label,
		value: item.id,
		description: item.description ?? "",
	};
}

function flattenTranscript(publication: NormalizedTranscriptPublication | undefined, shellState: AppShellState): string[] {
	if (!publication) {
		return [];
	}
	const lines: string[] = [];
	const expansion = shellState.transcript.expansionState;
	for (const item of publication.normalizedTranscript.items) {
		if (!shellState.showThinking && item.kind === "assistant-thinking") {
			continue;
		}
		const marker = shellState.transcript.selectedTranscriptItemId === item.id ? ">" : " ";
		lines.push(`${marker} ${item.kind} · ${item.summary}`);
		const expanded = expansion[item.id] ?? item.expanded ?? item.kind === "assistant-thinking";
		for (const part of item.parts) {
			if (part.kind === "thinking" && !shellState.showThinking) {
				continue;
			}
			if (part.kind === "summary") {
				continue;
			}
			if (!expanded && part.kind !== "text" && part.kind !== "status") {
				continue;
			}
			const prefix = part.kind === "thinking" ? "    thinking: " : "    ";
			const text = (part.text ?? "").trim();
			if (!text) {
				continue;
			}
			for (const line of text.split(/\r?\n/)) {
				lines.push(`${prefix}${line}`);
			}
		}
		lines.push("");
	}
	return lines.length > 0 ? lines : ["No transcript yet."];
}

export class OpenTuiShellView implements ShellView {
	readonly implementation = "opentui" as const;
	readonly footerData = new FooterDataProvider(process.cwd());

	private renderer?: CliRenderer;
	private transcriptPublication?: NormalizedTranscriptPublication;
	private editor: unknown;
	private readonly widgets = new Map<string, { lines: string[]; placement: WidgetPlacement }>();
	private headerLines: string[] = [];
	private footerLines: string[] = [];
	private overlays: OverlayRecord[] = [];
	private listeners = new Set<() => void>();
	private debugHandler?: () => void;
	private scrollBox?: ScrollBoxRenderable;
	private viewport = { width: 80, height: 24 };

	constructor(
		private readonly options: {
			stateStore: AppStateStore;
			getHostState: () => AgentHostState | undefined;
			editorController?: OpenTuiEditorController;
			onShellAction?: (action: { type: "overlay-open"; target: "command-palette" | "settings" | "sessions" | "orchestration" } | { type: "surface-launch"; target: "sessions-browser" | "orc-session" }) => void;
		},
	) {
		this.editor = options.editorController?.getComponent();
		this.options.stateStore.subscribe(() => this.notify());
		this.footerData.onBranchChange(() => this.notify());
	}

	bindEditorController(controller: OpenTuiEditorController): void {
		this.options.editorController = controller;
		this.editor = controller.getComponent();
		this.notify();
	}

	start(): void {
		void this.mount();
	}

	stop(): void {
		this.renderer?.destroy();
		this.renderer = undefined;
		this.footerData.dispose();
		for (const overlay of this.overlays) {
			if (overlay.kind === "legacy") {
				disposeLegacyRenderable(overlay.component);
			}
		}
	}

	setEditor(component: unknown): void {
		if (this.editor && this.editor !== component) {
			disposeLegacyRenderable(this.editor);
		}
		this.editor = component;
		focusLegacyRenderable(component, true);
		this.notify();
	}

	setFocus(component: unknown): void {
		if (component === this.editor) {
			focusLegacyRenderable(this.editor, true);
			this.notify();
			return;
		}
		focusLegacyRenderable(this.editor, false);
		this.notify();
	}

	setMessages(_components: unknown[]): void {
		// Legacy component publication is intentionally not used by the OpenTUI shell.
	}

	publishNormalizedTranscript(publication: NormalizedTranscriptPublication): void {
		this.transcriptPublication = publication;
		this.notify();
	}

	clearMessages(): void {
		this.transcriptPublication = undefined;
		this.notify();
	}

	setWidget(key: string, content: unknown, placement: WidgetPlacement = "aboveEditor"): void {
		if (!content) {
			this.widgets.delete(key);
			this.notify();
			return;
		}
		if (Array.isArray(content)) {
			this.widgets.set(key, { lines: [...content], placement });
			this.notify();
			return;
		}
		this.widgets.set(key, { lines: ["[custom widget unavailable in OpenTUI shell]"], placement });
		this.notify();
	}

	setHeaderFactory(factory: unknown): void {
		if (!factory) {
			this.headerLines = [];
			this.notify();
			return;
		}
		this.headerLines = ["[custom header unavailable in OpenTUI shell]"];
		this.notify();
	}

	setFooterFactory(factory: unknown): void {
		if (!factory) {
			this.footerLines = [];
			this.notify();
			return;
		}
		this.footerLines = ["[custom footer unavailable in OpenTUI shell]"];
		this.notify();
	}

	setTitle(title: string): void {
		process.title = title;
	}

	refresh(): void {
		this.notify();
	}

	requestRender(): void {
		this.renderer?.requestRender();
	}

	toggleSessionsPanel(): void {
		this.options.onShellAction?.({ type: "overlay-open", target: "sessions" });
	}

	scrollTranscript(lines: number): void {
		this.scrollBox?.scrollBy({ y: lines, x: 0 });
		this.requestRender();
	}

	scrollTranscriptToTop(): void {
		this.scrollBox?.scrollTo({ y: 0, x: 0 });
		this.options.stateStore.setFollowMode(false);
		this.requestRender();
	}

	scrollTranscriptToBottom(): void {
		if (this.scrollBox) {
			this.scrollBox.scrollTo({ y: this.scrollBox.scrollHeight, x: 0 });
		}
		this.options.stateStore.setFollowMode(true);
		this.requestRender();
	}

	dispatchMouse(_event: MouseEvent): boolean {
		return false;
	}

	getMenuAnchor(key: string): { row: number; col: number } {
		const mapping: Record<string, number> = { F1: 2, F2: 16, F3: 30 };
		return { row: 2, col: mapping[key] ?? 2 };
	}

	getDebugSnapshot(): { width: number; height: number; lines: string[] } {
		const snapshot = this.getSnapshot();
		const lines = [
			snapshot.metaLine,
			...snapshot.headerLines,
			...snapshot.transcriptLines.slice(0, Math.max(1, snapshot.height - 8)),
			...snapshot.widgetsAbove,
			...snapshot.widgetsBelow,
			snapshot.statusLine,
			snapshot.hintLine,
		];
		return { width: snapshot.width, height: snapshot.height, lines };
	}

	setDebugHandler(handler: (() => void) | undefined): void {
		this.debugHandler = handler;
	}

	openSelectOverlay<T>(
		id: string,
		title: string,
		description: string,
		items: Array<{ value: T; label: string; description?: string }>,
		onSelect: (value: T) => void,
		onCancel?: () => void,
	): void {
		this.overlays.push({
			id,
			kind: "select",
			title,
			description,
			items,
			selectedIndex: 0,
			onSelect: (value) => onSelect(value as T),
			onCancel,
		});
		this.notify();
	}

	openTextPrompt(title: string, description: string, initialValue: string, onSubmit: (value: string) => void, onCancel?: () => void): void {
		this.overlays.push({
			id: `text:${title}`,
			kind: "text-prompt",
			title,
			description,
			value: initialValue,
			onSubmit,
			onCancel,
		});
		this.notify();
	}

	openEditorPrompt(title: string, prefill: string, onSubmit: (value: string) => void, onCancel: () => void): void {
		this.overlays.push({
			id: `editor:${title}`,
			kind: "editor-prompt",
			title,
			description: "Edit text and submit.",
			value: prefill,
			onSubmit,
			onCancel,
		});
		this.notify();
	}

	openMenuOverlay(id: string, definition: ShellMenuDefinition): void {
		this.overlays.push({
			id,
			kind: "menu",
			title: definition.title,
			description: definition.subtitle,
			items: definition.items,
			selectedIndex: 0,
		});
		this.notify();
	}

	showCustomOverlay(id: string, component: unknown, options: OverlayOptionsWithMousePolicy): ShellOverlayHandle {
		const record: OverlayRecord = {
			id,
			kind: "legacy",
			title: options.floatingTitle ?? id,
			component,
			options,
		};
		this.overlays.push(record);
		this.notify();
		return {
			hide: () => this.closeOverlay(id),
			isHidden: () => !this.overlays.some((overlay) => overlay.id === id),
			setHidden: (hidden) => {
				if (hidden) {
					this.closeOverlay(id);
				}
			},
		};
	}

	closeTopOverlay(): void {
		const overlay = this.overlays.pop();
		if (overlay?.kind === "legacy") {
			disposeLegacyRenderable(overlay.component);
		}
		if (overlay && "onCancel" in overlay) {
			overlay.onCancel?.();
		}
		this.notify();
	}

	closeOverlay(id: string): void {
		const index = this.overlays.findIndex((overlay) => overlay.id === id);
		if (index < 0) {
			return;
		}
		const [overlay] = this.overlays.splice(index, 1);
		if (overlay?.kind === "legacy") {
			disposeLegacyRenderable(overlay.component);
		}
		if (overlay && "onCancel" in overlay) {
			overlay.onCancel?.();
		}
		this.notify();
	}

	closeAllOverlays(): void {
		while (this.overlays.length > 0) {
			this.closeTopOverlay();
		}
	}

	getOverlayDepth(): number {
		return this.overlays.length;
	}

	private async mount(): Promise<void> {
		if (this.renderer) {
			return;
		}
		this.renderer = await createCliRenderer({
			exitOnCtrlC: false,
			useMouse: true,
			autoFocus: true,
		});
		await renderSolid(() => this.renderRoot(), this.renderer);
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener();
		}
		this.requestRender();
	}

	private getSnapshot(): OpenTuiShellSnapshot {
		const shellState = this.options.stateStore.getState();
		const hostState = this.options.getHostState();
		const widgetsAbove = [...this.widgets.values()].filter((entry) => entry.placement === "aboveEditor").flatMap((entry) => entry.lines);
		const widgetsBelow = [...this.widgets.values()].filter((entry) => entry.placement === "belowEditor").flatMap((entry) => entry.lines);
		const branch = this.footerData.getGitBranch();
		const surfaces = shellState.transcript.launchedSurfaceIds.length > 0 ? `surfaces:${shellState.transcript.launchedSurfaceIds.join(",")}` : undefined;
		return {
			headerLines: [...this.headerLines],
			footerLines: [...this.footerLines],
			widgetsAbove,
			widgetsBelow,
			editor: this.editor,
			overlays: [...this.overlays],
			width: this.viewport.width,
			height: this.viewport.height,
			transcriptLines: flattenTranscript(this.transcriptPublication, shellState),
			statusLine: shellState.workingMessage ?? shellState.contextMessage ?? shellState.helpMessage ?? shellState.statusMessage,
			hintLine: [branch ? `git:${branch}` : undefined, surfaces, "F1 settings", "F2 sessions", "F3 orc", "Ctrl+B surface"].filter(Boolean).join(" · "),
			metaLine: [
				hostState?.model ? `${hostState.model.provider}/${hostState.model.id}` : "model:none",
				`runtime:${shellState.activeRuntimeId}`,
				shellState.showThinking ? "thinking:visible" : "thinking:hidden",
				shellState.toolOutputExpanded ? "tools:expanded" : "tools:collapsed",
				this.footerData.getPsmuxRuntimeLabel() ?? "local",
			].join(" · "),
		};
	}

	private renderRoot() {
		const [snapshot, setSnapshot] = createSignal(this.getSnapshot());
		const dimensions = useTerminalDimensions();
		let composerRef: any;
		let editorPromptRef: any;

		const listener = () => setSnapshot(this.getSnapshot());
		this.listeners.add(listener);

		onMount(() => {
			const size = dimensions();
			this.viewport = { width: size.width, height: size.height };
			setSnapshot(this.getSnapshot());
		});

		onCleanup(() => {
			this.listeners.delete(listener);
		});

		createEffect(() => {
			const nextText = this.options.editorController?.getText() ?? "";
			if (composerRef && typeof composerRef.setText === "function" && composerRef.plainText !== nextText) {
				composerRef.setText(nextText);
			}
		});

		useKeyboard((event) => {
			const current = snapshot();
			this.viewport = { width: dimensions().width, height: dimensions().height };
			const topOverlay = current.overlays.at(-1);
			if (topOverlay) {
				if ((event.name === "escape" || event.name === "esc") && topOverlay.kind !== "text-prompt" && topOverlay.kind !== "editor-prompt") {
					event.preventDefault();
					this.closeTopOverlay();
					return;
				}
				if (topOverlay.kind === "legacy") {
					dispatchLegacyKey(topOverlay.component, event);
					this.requestRender();
					return;
				}
				return;
			}
			if (event.name === "f1") {
				event.preventDefault();
				this.options.onShellAction?.({ type: "overlay-open", target: "settings" });
				return;
			}
			if (event.name === "f2") {
				event.preventDefault();
				this.options.onShellAction?.({ type: "overlay-open", target: "sessions" });
				return;
			}
			if (event.name === "f3") {
				event.preventDefault();
				this.options.onShellAction?.({ type: "overlay-open", target: "orchestration" });
				return;
			}
			if (event.ctrl && event.name === "b") {
				event.preventDefault();
				this.options.onShellAction?.({ type: "surface-launch", target: "sessions-browser" });
				return;
			}
			if (event.shift && event.ctrl && event.name === "d") {
				event.preventDefault();
				this.debugHandler?.();
				return;
			}
			if (!isOpenTuiEditor(this.editor)) {
				dispatchLegacyKey(this.editor, event);
			}
		});

		const overlayWidth = () => Math.max(48, Math.min(Math.floor(dimensions().width * 0.72), 96));
		const overlayLeft = () => Math.max(0, Math.floor((dimensions().width - overlayWidth()) / 2));
		const overlayTop = () => Math.max(1, Math.floor((dimensions().height - Math.min(dimensions().height - 2, 20)) / 2));

		return (
			<box flexDirection="column" width="100%" height="100%">
				<box border padding={1}>
					<text>{snapshot().metaLine}</text>
				</box>
				<For each={snapshot().headerLines}>{(line: string) => <text>{line}</text>}</For>
				<scrollbox
					ref={(value) => {
						this.scrollBox = value;
					}}
					flexGrow={1}
					scrollY
					stickyScroll={snapshot().overlays.length === 0 && this.options.stateStore.getState().transcript.followMode}
					stickyStart="bottom"
					border
					padding={1}
				>
					<For each={snapshot().transcriptLines}>{(line: string) => <text>{line}</text>}</For>
				</scrollbox>
				<For each={snapshot().widgetsAbove}>{(line: string) => <text>{line}</text>}</For>
				<box border padding={1}>
					<Show
						when={isOpenTuiEditor(snapshot().editor)}
						fallback={
							<box flexDirection="column">
								<For each={renderLegacyRenderable(snapshot().editor, Math.max(1, dimensions().width - 4))}>{(line: string) => <text>{line}</text>}</For>
							</box>
						}
					>
						<textarea
							ref={(value) => {
								composerRef = value;
							}}
							focused={snapshot().overlays.length === 0}
							initialValue={this.options.editorController?.getText() ?? ""}
							height={6}
							onContentChange={() => this.options.editorController?.updateFromView(composerRef?.plainText ?? "")}
							onCursorChange={(value) => this.options.editorController?.updateFromView(this.options.editorController?.getText() ?? "", {
								line: value.line,
								col: value.visualColumn + 1,
							})}
							onKeyDown={(event) => {
								const text = this.options.editorController?.getText() ?? "";
								if (event.meta && (event.name === "return" || event.name === "enter")) {
									event.preventDefault();
									void this.options.editorController?.handleKeyEvent(event);
									return;
								}
								if ((event.name === "return" || event.name === "enter") && !event.shift && !event.ctrl && !event.meta && !event.option) {
									event.preventDefault();
									void this.options.editorController?.handleKeyEvent({ ...event, meta: false } as KeyEvent);
									if (text.trim()) {
										void this.options.editorController?.submit("steer");
									}
									return;
								}
								void this.options.editorController?.handleKeyEvent(event);
							}}
						/>
					</Show>
				</box>
				<For each={snapshot().widgetsBelow}>{(line: string) => <text>{line}</text>}</For>
				<For each={snapshot().footerLines}>{(line: string) => <text>{line}</text>}</For>
				<text>{snapshot().statusLine}</text>
				<text>{snapshot().hintLine}</text>

				<Show when={snapshot().overlays.length > 0}>
					<Portal mount={this.renderer?.root}>
						<For each={snapshot().overlays}>
							{(overlay: OverlayRecord) => (
								<box
									position="absolute"
									left={overlayLeft()}
									top={overlayTop()}
									width={overlayWidth()}
									border
									padding={1}
									flexDirection="column"
									backgroundColor="#111111"
								>
									<text>{overlay.title}</text>
									<Show when={"description" in overlay && overlay.description}>
										<text>{("description" in overlay ? overlay.description : "") as string}</text>
									</Show>
									<Show when={overlay.kind === "select"}>
										<select
											focused
											options={(overlay.kind === "select" ? overlay.items : []).map((item: { label: string; description?: string }) => ({
												name: item.label,
												value: String(item.label),
												description: item.description ?? "",
											}))}
											onSelect={(index) => {
												if (overlay.kind !== "select") {
													return;
												}
												const item = overlay.items[index];
												if (!item) {
													return;
												}
												overlay.onSelect(item.value);
												this.closeOverlay(overlay.id);
											}}
										/>
									</Show>
									<Show when={overlay.kind === "menu"}>
										<select
											focused
											options={(overlay.kind === "menu" ? overlay.items : []).map(menuItemToOption)}
											onSelect={(index) => {
												if (overlay.kind !== "menu") {
													return;
												}
												const item = overlay.items[index];
												if (!item) {
													return;
												}
												if (item.kind === "submenu") {
													this.overlays.push({
														id: `${overlay.id}:${item.id}`,
														kind: "menu",
														title: item.label,
														description: item.description,
														items: item.items,
														selectedIndex: 0,
													});
													this.notify();
													return;
												}
												void Promise.resolve(item.onSelect()).finally(() => this.closeOverlay(overlay.id));
											}}
										/>
									</Show>
									<Show when={overlay.kind === "text-prompt"}>
										<input
											focused
											value={overlay.kind === "text-prompt" ? overlay.value : ""}
											onInput={(value) => {
												if (overlay.kind === "text-prompt") {
													overlay.value = value;
												}
											}}
											onSubmit={(value) => {
												if (overlay.kind !== "text-prompt") {
													return;
												}
												const nextValue = typeof value === "string" ? value : overlay.value;
												overlay.onSubmit(nextValue.trim());
												this.closeOverlay(overlay.id);
											}}
										/>
									</Show>
									<Show when={overlay.kind === "editor-prompt"}>
										<textarea
											ref={(value) => {
												editorPromptRef = value;
											}}
											focused
											initialValue={overlay.kind === "editor-prompt" ? overlay.value : ""}
											height={8}
											onContentChange={() => {
												if (overlay.kind === "editor-prompt") {
													overlay.value = editorPromptRef?.plainText ?? overlay.value;
												}
											}}
											onKeyDown={(event) => {
												if (overlay.kind !== "editor-prompt") {
													return;
												}
												if ((event.name === "return" || event.name === "enter") && event.ctrl) {
													event.preventDefault();
													overlay.onSubmit(overlay.value);
													this.closeOverlay(overlay.id);
												}
											}}
										/>
									</Show>
									<Show when={overlay.kind === "legacy"}>
										<box flexDirection="column">
											<For each={renderLegacyRenderable(overlay.kind === "legacy" ? overlay.component : undefined, overlayWidth() - 4)}>
												{(line: string) => <text>{line}</text>}
											</For>
										</box>
									</Show>
								</box>
							)}
						</For>
					</Portal>
				</Show>
			</box>
		);
	}
}
