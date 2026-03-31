/** @jsxImportSource @opentui/solid */
import { createCliRenderer, type CliRenderer, type ScrollBoxRenderable, type SelectOption } from "@opentui/core";
import { Portal, render as renderSolid, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { AgentHostState } from "../agent-host.js";
import type { AppShellState, AppStateStore } from "../app-state-store.js";
import { FooterDataProvider } from "../footer-data-provider.js";
import type { MouseEvent } from "../mouse.js";
import type { OverlayOptionsWithMousePolicy, ShellOverlayHandle } from "../overlay-controller.js";
import type { ShellView } from "../shell-view.js";
import type { NormalizedTranscriptPublication } from "../shell/transcript-publication.js";
import type { ShellMenuDefinition, ShellMenuItem } from "../components/shell-menu-overlay.js";
import type { TranscriptItem, TranscriptPart } from "../shell-next/shared-models.js";
import type { OpenTuiEditorController } from "./editor-controller.js";
import { isOpenTuiOverlayModel, type OpenTuiDocumentOverlayItem } from "./overlay-models.js";

type OverlayRecord =
	| {
		id: string;
		kind: "select";
		title: string;
		description?: string;
		items: Array<{ value: unknown; label: string; description?: string }>;
		selectedIndex: number;
		onSelect: (value: unknown) => void;
		onCancel?: () => void;
	}
	| {
		id: string;
		kind: "text-prompt";
		title: string;
		description?: string;
		value: string;
		onSubmit: (value: string) => void;
		onCancel?: () => void;
	}
	| {
		id: string;
		kind: "editor-prompt";
		title: string;
		description?: string;
		value: string;
		onSubmit: (value: string) => void;
		onCancel?: () => void;
	}
	| {
		id: string;
		kind: "menu";
		title: string;
		description?: string;
		items: ShellMenuItem[];
		selectedIndex: number;
		parentId?: string;
	}
	| {
		id: string;
		kind: "text";
		title: string;
		description?: string;
		lines: readonly string[];
	}
	| {
		id: string;
		kind: "document";
		title: string;
		description?: string;
		items: readonly OpenTuiDocumentOverlayItem[];
		selectedIndex: number;
		emptyMessage?: string;
	};

interface OpenTuiShellSnapshot {
	width: number;
	height: number;
	menuLine: string;
	metaLine: string;
	transcriptLines: string[];
	composerTitle: string;
	composerHelp: string;
	statusLine: string;
	statusTone: "info" | "warning" | "success" | "accent" | "dim";
	footerLine: string;
	overlays: OverlayRecord[];
}

function menuItemToOption(item: ShellMenuItem): SelectOption {
	return {
		name: item.label,
		value: item.id,
		description: item.description ?? "",
	};
}

function humanizeKind(kind: TranscriptItem["kind"]): string {
	switch (kind) {
		case "user":
			return "You";
		case "assistant-text":
			return "Agent";
		case "assistant-thinking":
			return "Thinking";
		case "tool-call":
			return "Tool Call";
		case "tool-result":
			return "Tool Result";
		case "artifact":
			return "Artifact";
		case "runtime-status":
			return "Runtime";
		case "subagent-event":
			return "Subagent";
		case "checkpoint":
			return "Checkpoint";
		case "error":
			return "Error";
	}
}

function clipLine(line: string, width: number): string {
	if (width <= 0) {
		return "";
	}
	if (line.length <= width) {
		return line;
	}
	if (width <= 1) {
		return line.slice(0, width);
	}
	return `${line.slice(0, width - 1)}…`;
}

function wrapText(text: string, width: number): string[] {
	const normalized = text.replace(/\r/g, "");
	const lines: string[] = [];
	for (const rawLine of normalized.split("\n")) {
		if (!rawLine) {
			lines.push("");
			continue;
		}
		let remainder = rawLine;
		while (remainder.length > width && width > 0) {
			lines.push(remainder.slice(0, width));
			remainder = remainder.slice(width);
		}
		lines.push(remainder);
	}
	return lines;
}

function partPrefix(part: TranscriptPart): string {
	switch (part.kind) {
		case "thinking":
			return "Thinking";
		case "detail":
			return "Detail";
		case "status":
			return "Status";
		case "artifact-link":
			return "Artifact";
		case "metadata":
			return "Meta";
		default:
			return "";
	}
}

function flattenTranscript(publication: NormalizedTranscriptPublication | undefined, shellState: AppShellState, width: number): string[] {
	if (!publication || publication.normalizedTranscript.items.length === 0) {
		return ["No transcript yet.", "", "Type a prompt below and press Enter to send it to the coding agent."];
	}

	const lines: string[] = [];
	const expansionState = shellState.transcript.expansionState;

	for (const item of publication.normalizedTranscript.items) {
		if (!shellState.showThinking && item.kind === "assistant-thinking") {
			continue;
		}
		const selected = shellState.transcript.selectedTranscriptItemId === item.id ? ">" : " ";
		const expanded = expansionState[item.id] ?? item.expanded ?? item.kind === "assistant-thinking";
		lines.push(clipLine(`${selected} ${humanizeKind(item.kind)}  ${item.summary}`, width));

		for (const part of item.parts) {
			if (part.kind === "summary") {
				continue;
			}
			if (!shellState.showThinking && part.kind === "thinking") {
				continue;
			}
			if (!expanded && part.kind !== "text" && part.kind !== "status") {
				continue;
			}

			const prefix = partPrefix(part);
			const partText = part.text?.trim() ?? "";
			if (!partText) {
				continue;
			}
			const partLines = wrapText(partText, Math.max(8, width - 6));
			for (const line of partLines) {
				const rendered = prefix ? `    ${prefix}: ${line}` : `    ${line}`;
				lines.push(clipLine(rendered, width));
			}
		}

		lines.push("");
	}

	return lines;
}

function deriveStatus(snapshotState: AppShellState): { line: string; tone: OpenTuiShellSnapshot["statusTone"] } {
	if (snapshotState.workingMessage) {
		return { line: snapshotState.workingMessage, tone: "accent" };
	}
	if (snapshotState.contextTitle || snapshotState.contextMessage) {
		return {
			line: [snapshotState.contextTitle, snapshotState.contextMessage].filter(Boolean).join(" · "),
			tone: snapshotState.contextTone ?? "info",
		};
	}
	if (snapshotState.helpMessage) {
		return { line: snapshotState.helpMessage, tone: "dim" };
	}
	return { line: snapshotState.statusMessage, tone: "info" };
}

function toneColor(tone: OpenTuiShellSnapshot["statusTone"]): string {
	switch (tone) {
		case "warning":
			return "#3a1f00";
		case "success":
			return "#103320";
		case "accent":
			return "#10263c";
		case "dim":
			return "#1b1b1b";
		default:
			return "#202020";
	}
}

export class OpenTuiShellView implements ShellView {
	readonly implementation = "opentui" as const;
	readonly footerData = new FooterDataProvider(process.cwd());

	private renderer?: CliRenderer;
	private transcriptPublication?: NormalizedTranscriptPublication;
	private readonly listeners = new Set<() => void>();
	private debugHandler?: () => void;
	private scrollBox?: ScrollBoxRenderable;
	private editor: unknown;
	private viewport = { width: 80, height: 24 };
	private overlays: OverlayRecord[] = [];

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
	}

	setEditor(component: unknown): void {
		this.editor = component;
		this.notify();
	}

	setFocus(_component: unknown): void {
		this.notify();
	}

	setMessages(_components: unknown[]): void {
		// The OpenTUI shell renders only from normalized transcript publication.
	}

	publishNormalizedTranscript(publication: NormalizedTranscriptPublication): void {
		this.transcriptPublication = publication;
		const latestItem = publication.normalizedTranscript.items.at(-1);
		if (latestItem) {
			const currentSelection = this.options.stateStore.getState().transcript.selectedTranscriptItemId;
			if (!currentSelection || this.options.stateStore.getState().transcript.followMode) {
				this.options.stateStore.setSelectedTranscriptItem(latestItem.id);
			}
		}
		this.notify();
	}

	clearMessages(): void {
		this.transcriptPublication = undefined;
		this.options.stateStore.setSelectedTranscriptItem(undefined);
		this.notify();
	}

	setWidget(_key: string, _content: unknown, _placement?: "aboveEditor" | "belowEditor"): void {
		// Legacy shell widget chrome is intentionally unsupported in the OpenTUI coding chat.
	}

	setHeaderFactory(_factory: unknown): void {
		// Legacy shell header injection is intentionally unsupported in the OpenTUI coding chat.
	}

	setFooterFactory(_factory: unknown): void {
		// Legacy shell footer injection is intentionally unsupported in the OpenTUI coding chat.
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
		if (!this.scrollBox) {
			return;
		}
		this.scrollBox.scrollBy({ y: lines, x: 0 });
		if (lines < 0) {
			this.options.stateStore.setFollowMode(false);
		}
		this.requestRender();
	}

	scrollTranscriptToTop(): void {
		this.scrollBox?.scrollTo({ x: 0, y: 0 });
		this.options.stateStore.setFollowMode(false);
		this.requestRender();
	}

	scrollTranscriptToBottom(): void {
		if (this.scrollBox) {
			this.scrollBox.scrollTo({ x: 0, y: this.scrollBox.scrollHeight });
		}
		this.options.stateStore.setFollowMode(true);
		this.requestRender();
	}

	dispatchMouse(_event: MouseEvent): boolean {
		return false;
	}

	getMenuAnchor(key: string): { row: number; col: number } {
		const mapping: Record<string, number> = { F1: 2, F2: 18, F3: 34 };
		return { row: 1, col: mapping[key] ?? 2 };
	}

	getDebugSnapshot(): { width: number; height: number; lines: string[] } {
		const snapshot = this.getSnapshot();
		return {
			width: snapshot.width,
			height: snapshot.height,
			lines: [
				snapshot.menuLine,
				snapshot.metaLine,
				...snapshot.transcriptLines,
				snapshot.composerTitle,
				snapshot.composerHelp,
				snapshot.statusLine,
				snapshot.footerLine,
			],
		};
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
		this.closeOverlay(id);
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
		const id = `text:${title}`;
		this.closeOverlay(id);
		this.overlays.push({
			id,
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
		const id = `editor:${title}`;
		this.closeOverlay(id);
		this.overlays.push({
			id,
			kind: "editor-prompt",
			title,
			description: "Ctrl+Enter submits.",
			value: prefill,
			onSubmit,
			onCancel,
		});
		this.notify();
	}

	openMenuOverlay(id: string, definition: ShellMenuDefinition): void {
		this.closeOverlay(id);
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

	showCustomOverlay(id: string, component: unknown, _options: OverlayOptionsWithMousePolicy): ShellOverlayHandle {
		if (!isOpenTuiOverlayModel(component)) {
			throw new Error("OpenTUI coding chat only accepts native OpenTUI overlay models.");
		}

		this.closeOverlay(id);
		if (component.kind === "text") {
			this.overlays.push({
				id,
				kind: "text",
				title: component.title,
				description: component.description,
				lines: [...component.lines],
			});
		} else {
			this.overlays.push({
				id,
				kind: "document",
				title: component.title,
				description: component.description,
				items: [...component.items],
				selectedIndex: 0,
				emptyMessage: component.emptyMessage,
			});
		}
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
		const { line: statusLine, tone: statusTone } = deriveStatus(shellState);
		const branch = this.footerData.getGitBranch();
		const model = hostState?.model ? `${hostState.model.provider}/${hostState.model.id}` : "model not selected";
		const runtime = `${shellState.activeRuntimeName} (${shellState.activeRuntimeId})`;
		const providers = `${this.footerData.getAvailableProviderCount()} provider${this.footerData.getAvailableProviderCount() === 1 ? "" : "s"}`;
		const follow = shellState.transcript.followMode ? "follow on" : "follow off";
		const surfaces = shellState.transcript.launchedSurfaceIds.length > 0
			? `surfaces: ${shellState.transcript.launchedSurfaceIds.join(", ")}`
			: undefined;

		return {
			width: this.viewport.width,
			height: this.viewport.height,
			menuLine: ["[F1] Settings", "[F2] Sessions", "[F3] Orc", "[Esc] Palette"].join("   "),
			metaLine: [
				model,
				runtime,
				shellState.showThinking ? "thinking visible" : "thinking hidden",
				shellState.toolOutputExpanded ? "tools expanded" : "tools collapsed",
			].join("  |  "),
			transcriptLines: flattenTranscript(this.transcriptPublication, shellState, Math.max(20, this.viewport.width - 6)),
			composerTitle: `Composer · ${follow}`,
			composerHelp: "Enter sends prompt · Shift+Enter newline · Ctrl+L model · Ctrl+T thinking · Ctrl+O tools",
			statusLine,
			statusTone,
			footerLine: [
				branch ? `git:${branch}` : undefined,
				this.footerData.getSessionMode(),
				providers,
				this.footerData.getPsmuxRuntimeLabel(),
				surfaces,
			].filter((value): value is string => Boolean(value)).join("  |  "),
			overlays: [...this.overlays],
		};
	}

	private renderRoot() {
		const [snapshot, setSnapshot] = createSignal(this.getSnapshot());
		const dimensions = useTerminalDimensions();
		let composerRef: { plainText: string; setText: (text: string) => void } | undefined;
		let editorPromptRef: { plainText: string } | undefined;

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
			const size = dimensions();
			this.viewport = { width: size.width, height: size.height };
			setSnapshot(this.getSnapshot());
		});

		createEffect(() => {
			const value = this.options.editorController?.getText() ?? "";
			if (composerRef && composerRef.plainText !== value) {
				composerRef.setText(value);
			}
		});

		createEffect(() => {
			const current = snapshot();
			if (this.scrollBox && this.options.stateStore.getState().transcript.followMode && current.overlays.length === 0) {
				this.scrollBox.scrollTo({ x: 0, y: this.scrollBox.scrollHeight });
			}
		});

		useKeyboard((event) => {
			this.viewport = { width: dimensions().width, height: dimensions().height };
			const topOverlay = this.overlays.at(-1);

			if (topOverlay) {
				if (event.name === "escape" || event.name === "esc") {
					event.preventDefault();
					if (topOverlay.kind === "menu" && topOverlay.parentId) {
						this.closeOverlay(topOverlay.id);
						return;
					}
					this.closeTopOverlay();
					return;
				}
				if (topOverlay.kind === "menu" && event.name === "left" && topOverlay.parentId) {
					event.preventDefault();
					this.closeOverlay(topOverlay.id);
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
			if ((event.name === "escape" || event.name === "esc") && !(this.options.editorController?.getText().trim())) {
				event.preventDefault();
				this.options.onShellAction?.({ type: "overlay-open", target: "command-palette" });
				return;
			}
			if (event.ctrl && event.name === "b") {
				event.preventDefault();
				this.options.onShellAction?.({ type: "overlay-open", target: "sessions" });
				return;
			}
			if (event.shift && event.ctrl && event.name === "d") {
				event.preventDefault();
				this.debugHandler?.();
				return;
			}
			if (event.name === "pageup") {
				event.preventDefault();
				this.scrollTranscript(-10);
				return;
			}
			if (event.name === "pagedown") {
				event.preventDefault();
				this.scrollTranscript(10);
				return;
			}
			if (event.name === "home") {
				event.preventDefault();
				this.scrollTranscriptToTop();
				return;
			}
			if (event.name === "end") {
				event.preventDefault();
				this.scrollTranscriptToBottom();
			}
		});

		const overlayWidth = createMemo(() => Math.max(56, Math.min(Math.floor(dimensions().width * 0.82), 120)));
		const overlayHeight = createMemo(() => Math.max(14, Math.min(Math.floor(dimensions().height * 0.78), 28)));
		const overlayLeft = createMemo(() => Math.max(0, Math.floor((dimensions().width - overlayWidth()) / 2)));
		const overlayTop = createMemo(() => Math.max(1, Math.floor((dimensions().height - overlayHeight()) / 2)));

		return (
			<box flexDirection="column" width="100%" height="100%" backgroundColor="#11161d">
				<box paddingX={1} paddingY={0} backgroundColor="#1a344c">
					<text>
						<strong>{snapshot().menuLine}</strong>
					</text>
				</box>
				<box paddingX={1} paddingY={0} backgroundColor="#16222d">
					<text>{snapshot().metaLine}</text>
				</box>
				<box flexGrow={1} padding={1}>
					<scrollbox
						ref={(value) => {
							this.scrollBox = value;
						}}
						flexGrow={1}
						border
						borderStyle="rounded"
						title="Coding Chat"
						padding={1}
						scrollY
						stickyScroll={this.options.stateStore.getState().transcript.followMode}
						stickyStart="bottom"
					>
						<For each={snapshot().transcriptLines}>{(line) => <text>{line}</text>}</For>
					</scrollbox>
				</box>
				<box paddingX={1} paddingBottom={1}>
					<box border borderStyle="rounded" title={snapshot().composerTitle} padding={1} flexDirection="column">
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
								const isControllerShortcut =
									(event.ctrl && (event.name === "p" || event.name === "l" || event.name === "o" || event.name === "t" || event.name === "d"))
									|| (event.shift && event.name === "tab")
									|| ((event.name === "escape" || event.name === "esc") && !((this.options.editorController?.getText() ?? "").trim()))
									|| ((event.name === "escape" || event.name === "esc") && (this.options.getHostState()?.isStreaming ?? false));

								if ((event.name === "enter" || event.name === "return") && !event.shift && !event.ctrl && !event.meta && !event.option) {
									event.preventDefault();
									if ((this.options.editorController?.getText() ?? "").trim()) {
										void this.options.editorController?.submit("steer");
									}
									return;
								}
								if ((event.ctrl || event.meta) && (event.name === "enter" || event.name === "return")) {
									event.preventDefault();
									if ((this.options.editorController?.getText() ?? "").trim()) {
										void this.options.editorController?.submit("followUp");
									}
									return;
								}
								if (isControllerShortcut) {
									event.preventDefault();
								}
								void this.options.editorController?.handleKeyEvent(event);
							}}
						/>
						<text>{snapshot().composerHelp}</text>
					</box>
				</box>
				<box paddingX={1} backgroundColor={toneColor(snapshot().statusTone)}>
					<text>{snapshot().statusLine}</text>
				</box>
				<box paddingX={1} backgroundColor="#131313">
					<text>{snapshot().footerLine}</text>
				</box>

				<Show when={snapshot().overlays.length > 0}>
					<Portal mount={this.renderer?.root}>
						<For each={snapshot().overlays}>
							{(overlay) => (
								<box
									position="absolute"
									left={overlayLeft()}
									top={overlayTop()}
									width={overlayWidth()}
									height={overlayHeight()}
									border
									borderStyle="rounded"
									title={overlay.title}
									padding={1}
									flexDirection="column"
									backgroundColor="#0f1318"
								>
									<Show when={overlay.description}>
										<text>{overlay.description}</text>
									</Show>
									<Show when={overlay.kind === "select"}>
										<select
											focused
											height={Math.max(6, overlayHeight() - 6)}
											options={overlay.kind === "select" ? overlay.items.map((item) => ({
												name: item.label,
												value: item.label,
												description: item.description ?? "",
											})) : []}
											selectedIndex={overlay.kind === "select" ? overlay.selectedIndex : 0}
											onChange={(index) => {
												if (overlay.kind === "select") {
													overlay.selectedIndex = index;
													this.notify();
												}
											}}
											onSelect={(index) => {
												if (overlay.kind !== "select") {
													return;
												}
												const item = overlay.items[index];
												if (!item) {
													return;
												}
												overlay.onSelect(item.value);
												overlay.onCancel = undefined;
												this.closeOverlay(overlay.id);
											}}
										/>
									</Show>
									<Show when={overlay.kind === "menu"}>
										<select
											focused
											height={Math.max(6, overlayHeight() - 6)}
											options={overlay.kind === "menu" ? overlay.items.map(menuItemToOption) : []}
											selectedIndex={overlay.kind === "menu" ? overlay.selectedIndex : 0}
											onChange={(index) => {
												if (overlay.kind === "menu") {
													overlay.selectedIndex = index;
													this.notify();
												}
											}}
											onSelect={(index) => {
												if (overlay.kind !== "menu") {
													return;
												}
												const item = overlay.items[index];
												if (!item) {
													return;
												}
												if (item.kind === "submenu") {
													const childId = `${overlay.id}:${item.id}`;
													this.closeOverlay(childId);
													this.overlays.push({
														id: childId,
														kind: "menu",
														title: item.label,
														description: item.description,
														items: item.items,
														selectedIndex: 0,
														parentId: overlay.id,
													});
													this.notify();
													return;
												}
												void Promise.resolve(item.onSelect()).finally(() => this.closeAllOverlays());
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
											onSubmit={() => {
												if (overlay.kind !== "text-prompt") {
													return;
												}
												overlay.onSubmit(overlay.value.trim());
												overlay.onCancel = undefined;
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
											height={Math.max(8, overlayHeight() - 8)}
											onContentChange={() => {
												if (overlay.kind === "editor-prompt") {
													overlay.value = editorPromptRef?.plainText ?? overlay.value;
												}
											}}
											onKeyDown={(event) => {
												if (overlay.kind !== "editor-prompt") {
													return;
												}
												if (event.ctrl && (event.name === "enter" || event.name === "return")) {
													event.preventDefault();
													overlay.onSubmit(editorPromptRef?.plainText ?? overlay.value);
													overlay.onCancel = undefined;
													this.closeOverlay(overlay.id);
												}
											}}
										/>
									</Show>
									<Show when={overlay.kind === "text"}>
										<scrollbox flexGrow={1} scrollY border padding={1}>
											<For each={overlay.kind === "text" ? overlay.lines : []}>{(line) => <text>{line}</text>}</For>
										</scrollbox>
									</Show>
									<Show when={overlay.kind === "document"}>
										<Show
											when={overlay.kind === "document" && overlay.items.length > 0}
											fallback={<text>{overlay.kind === "document" ? (overlay.emptyMessage ?? "Nothing to show.") : ""}</text>}
										>
											<box flexDirection="row" flexGrow={1} gap={1}>
												<select
													width={Math.max(24, Math.floor(overlayWidth() * 0.28))}
													height={Math.max(8, overlayHeight() - 7)}
													focused
													options={overlay.kind === "document" ? overlay.items.map((item) => ({
														name: item.label,
														value: item.id,
														description: item.description ?? "",
													})) : []}
													selectedIndex={overlay.kind === "document" ? overlay.selectedIndex : 0}
													onChange={(index) => {
														if (overlay.kind === "document") {
															overlay.selectedIndex = index;
															this.notify();
														}
													}}
												/>
												<scrollbox flexGrow={1} height={Math.max(8, overlayHeight() - 7)} scrollY border padding={1}>
													<For each={overlay.kind === "document"
														? wrapText(overlay.items[overlay.selectedIndex]?.content ?? "", Math.max(20, overlayWidth() - 36))
														: []}
													>
														{(line) => <text>{line}</text>}
													</For>
												</scrollbox>
											</box>
											<Show when={overlay.kind === "document" && overlay.items[overlay.selectedIndex]?.footer?.length}>
												<text>{overlay.kind === "document" ? overlay.items[overlay.selectedIndex]?.footer?.join("  |  ") ?? "" : ""}</text>
											</Show>
										</Show>
									</Show>
									<text>Esc closes</text>
								</box>
							)}
						</For>
					</Portal>
				</Show>
			</box>
		);
	}
}
