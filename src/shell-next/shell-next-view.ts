import {
	Container,
	Text,
	TUI,
	truncateToWidth,
	type Component,
	type Terminal,
} from "@mariozechner/pi-tui";
import type { AgentHostState } from "../agent-host.js";
import type { AppShellState, AppStateStore } from "../app-state-store.js";
import { TranscriptViewport } from "../components/transcript-viewport.js";
import { FooterDataProvider } from "../footer-data-provider.js";
import type { MouseEvent, Rect } from "../mouse.js";
import { getCodingAgentTheme } from "../shell/shell-coding-agent-interop.js";
import type { FooterFactory, HeaderFactory, WidgetFactory } from "../shell/shell-types.js";
import type { ShellView } from "../shell-view.js";
import type { NormalizedTranscriptPublication } from "../shell/transcript-publication.js";
import { createShellNextRenderer } from "./renderer.js";
import type { TranscriptItem } from "./shared-models.js";
import type { ShellNextState } from "./state.js";
import { type TranscriptTimelineRow, TranscriptTimelineController } from "./transcript-timeline.js";

interface ShellNextViewOptions {
	terminal: Terminal;
	stateStore: AppStateStore;
	getHostState: () => AgentHostState | undefined;
}

interface DisposableComponent extends Component {
	dispose?(): void;
}

interface WidgetEntry {
	component: DisposableComponent;
}

class SingleLineText implements Component {
	private text = "";

	setText(text: string): void {
		this.text = text;
	}

	invalidate(): void {}

	render(width: number): string[] {
		return [truncateToWidth(this.text, Math.max(1, width), "")];
	}
}

class ShellNextTranscriptSurface implements Component {
	private readonly legacyViewport = new TranscriptViewport();
	private readonly timeline = new TranscriptTimelineController();
	private viewportHeight = 1;
	private selectedItemId?: string;
	private normalizedItems: readonly TranscriptItem[] = [];
	private useNormalized = false;
	private latestVisibleRows: readonly TranscriptTimelineRow[] = [];

	clear(): void {
		this.useNormalized = false;
		this.normalizedItems = [];
		this.selectedItemId = undefined;
		this.latestVisibleRows = [];
		this.legacyViewport.setComponents([]);
		this.timeline.replaceItems([]);
	}

	setLegacyComponents(components: Component[]): void {
		this.useNormalized = false;
		this.legacyViewport.setComponents(components);
	}

	setSelectedItemId(itemId: string | undefined): void {
		this.selectedItemId = itemId;
	}

	setViewportHeight(height: number): void {
		this.viewportHeight = Math.max(1, height);
		this.legacyViewport.setViewportHeight(this.viewportHeight);
		this.timeline.setViewportSize(this.viewportHeight);
	}

	syncNormalizedTranscript(input: {
		items: readonly TranscriptItem[];
		showThinking: boolean;
		expansionState: Readonly<Record<string, boolean>>;
		followMode: boolean;
		isStreaming: boolean;
		selectedItemId?: string;
	}): void {
		this.useNormalized = true;
		this.normalizedItems = [...input.items];
		this.selectedItemId = input.selectedItemId;
		this.timeline.setPartExpansion(input.expansionState);
		this.timeline.setStreaming(input.isStreaming);
		this.timeline.setFollowMode(input.followMode);
		this.timeline.replaceItems(
			input.showThinking
				? this.normalizedItems
				: this.normalizedItems.filter((item) => item.kind !== "assistant-thinking"),
		);
	}

	scrollBy(lines: number): void {
		if (this.useNormalized) {
			this.timeline.scrollBy(lines, "keyboard");
			return;
		}
		this.legacyViewport.scrollBy(lines);
	}

	scrollToTop(): void {
		if (this.useNormalized) {
			this.timeline.scrollToTop();
			return;
		}
		this.legacyViewport.scrollToTop();
	}

	scrollToBottom(): void {
		if (this.useNormalized) {
			this.timeline.scrollToBottom();
			return;
		}
		this.legacyViewport.scrollToBottom();
	}

	scrollWheel(direction: "up" | "down", stride = 3): void {
		if (this.useNormalized) {
			this.timeline.scrollWheel(direction, stride);
			return;
		}
		this.legacyViewport.scrollBy(direction === "up" ? -stride : stride);
	}

	getFollowMode(): boolean {
		if (this.useNormalized) {
			return this.timeline.getVisibleView().followMode;
		}
		return this.legacyViewport.getState().followTail;
	}

	getExpansionState(): Readonly<Record<string, boolean>> {
		return this.timeline.getState().partExpansion;
	}

	getTimelineView() {
		return this.useNormalized ? this.timeline.getVisibleView() : undefined;
	}

	getRowAtViewportIndex(index: number): TranscriptTimelineRow | undefined {
		return this.latestVisibleRows[index];
	}

	toggleVisibleRow(index: number): boolean {
		const row = this.latestVisibleRows[index];
		if (!row?.collapsible || !row.partId) {
			return false;
		}
		this.timeline.togglePartExpansion(row.itemId, row.partId);
		return true;
	}

	invalidate(): void {
		this.legacyViewport.invalidate();
	}

	render(width: number): string[] {
		if (!this.useNormalized) {
			return this.legacyViewport.render(width);
		}

		const view = this.timeline.getVisibleView();
		this.latestVisibleRows = view.rows;
		const lines = view.rows.map((row) => this.renderRow(row, width));
		while (lines.length < this.viewportHeight) {
			lines.push("");
		}
		return lines.slice(0, this.viewportHeight);
	}

	private renderRow(row: TranscriptTimelineRow, width: number): string {
		const marker = row.itemId === this.selectedItemId ? ">" : " ";
		const indent = "  ".repeat(Math.max(0, row.depth));
		return truncateToWidth(`${marker} ${indent}${row.text}`, Math.max(1, width), "");
	}
}

export class ShellNextView implements ShellView {
	readonly tui: TUI;
	readonly footerData = new FooterDataProvider(process.cwd());

	private readonly metaRow = new SingleLineText();
	private readonly headerContainer = new Container();
	private readonly transcriptSurface = new ShellNextTranscriptSurface();
	private readonly widgetAboveContainer = new Container();
	private readonly composerSeparator = new SingleLineText();
	private readonly editorContainer = new Container();
	private readonly widgetBelowContainer = new Container();
	private readonly footerContainer = new Container();
	private readonly statusRow = new SingleLineText();
	private readonly hintRow = new SingleLineText();
	private readonly renderer = createShellNextRenderer();
	private readonly widgetEntriesAbove = new Map<string, WidgetEntry>();
	private readonly widgetEntriesBelow = new Map<string, WidgetEntry>();
	private transcriptRect: Rect = { row: 1, col: 1, width: 1, height: 1 };
	private latestTranscriptPublication?: NormalizedTranscriptPublication;
	private headerFactory?: HeaderFactory;
	private footerFactory?: FooterFactory;
	private headerComponent?: DisposableComponent;
	private footerComponent?: DisposableComponent;
	private activeEditor: Component | null = null;
	private unsubscribeState?: () => void;
	private unsubscribeBranch?: () => void;
	private lastTranscriptSyncKey = "";
	private started = false;

	constructor(private readonly options: ShellNextViewOptions) {
		this.tui = new TUI(options.terminal, true);
		this.tui.addChild(this.metaRow);
		this.tui.addChild(this.headerContainer);
		this.tui.addChild(this.transcriptSurface);
		this.tui.addChild(this.widgetAboveContainer);
		this.tui.addChild(this.composerSeparator);
		this.tui.addChild(this.editorContainer);
		this.tui.addChild(this.widgetBelowContainer);
		this.tui.addChild(this.footerContainer);
		this.tui.addChild(this.statusRow);
		this.tui.addChild(this.hintRow);

		this.unsubscribeState = this.options.stateStore.subscribe(() => {
			this.syncTranscriptState();
			this.refresh();
			if (this.started) {
				this.tui.requestRender();
			}
		});
		this.unsubscribeBranch = this.footerData.onBranchChange(() => {
			this.refresh();
			if (this.started) {
				this.tui.requestRender();
			}
		});
		(this.options.terminal as { setResizeHandler?: (handler: () => void) => () => void }).setResizeHandler?.(() => {
			this.refresh();
			if (this.started) {
				this.tui.requestRender();
			}
		});
	}

	start(): void {
		this.started = true;
		this.refresh();
		this.tui.start();
	}

	stop(): void {
		this.started = false;
		this.unsubscribeState?.();
		this.unsubscribeBranch?.();
		this.disposeWidgets(this.widgetEntriesAbove);
		this.disposeWidgets(this.widgetEntriesBelow);
		this.headerComponent?.dispose?.();
		this.footerComponent?.dispose?.();
		this.footerData.dispose();
		this.tui.stop();
	}

	setEditor(component: Component): void {
		this.activeEditor = component;
		this.editorContainer.clear();
		this.editorContainer.addChild(component);
		this.refresh();
		this.tui.requestRender();
	}

	setFocus(component: Component | null): void {
		this.tui.setFocus(component);
	}

	setMessages(components: Component[]): void {
		if (!this.latestTranscriptPublication) {
			this.transcriptSurface.setLegacyComponents(components);
		}
		this.refresh();
		this.tui.requestRender();
	}

	publishNormalizedTranscript(publication: NormalizedTranscriptPublication): void {
		this.latestTranscriptPublication = publication;
		this.syncTranscriptState(true);
		this.refresh();
		this.tui.requestRender();
	}

	clearMessages(): void {
		this.latestTranscriptPublication = undefined;
		this.transcriptSurface.clear();
		this.refresh();
		this.tui.requestRender();
	}

	setWidget(key: string, content: WidgetFactory | string[] | undefined, placement: "aboveEditor" | "belowEditor" = "aboveEditor"): void {
		const target = placement === "belowEditor" ? this.widgetEntriesBelow : this.widgetEntriesAbove;
		const container = placement === "belowEditor" ? this.widgetBelowContainer : this.widgetAboveContainer;
		const existing = target.get(key);
		existing?.component.dispose?.();
		if (!content) {
			target.delete(key);
		} else {
			const component = Array.isArray(content)
				? new Text(content.join("\n"), 0, 0)
				: content(this.tui, getCodingAgentTheme());
			target.set(key, { component });
		}
		this.renderWidgetContainer(container, target);
		this.refresh();
		this.tui.requestRender();
	}

	setHeaderFactory(factory: HeaderFactory | undefined): void {
		this.headerFactory = factory;
		this.headerContainer.clear();
		this.headerComponent?.dispose?.();
		this.headerComponent = factory ? factory(this.tui, getCodingAgentTheme()) : undefined;
		if (this.headerComponent) {
			this.headerContainer.addChild(this.headerComponent);
		}
		this.refresh();
		this.tui.requestRender();
	}

	setFooterFactory(factory: FooterFactory | undefined): void {
		this.footerFactory = factory;
		this.footerContainer.clear();
		this.footerComponent?.dispose?.();
		this.footerComponent = factory ? factory(this.tui, getCodingAgentTheme(), this.footerData) : undefined;
		if (this.footerComponent) {
			this.footerContainer.addChild(this.footerComponent);
		}
		this.refresh();
		this.tui.requestRender();
	}

	setTitle(title: string): void {
		this.tui.terminal.setTitle(title);
	}

	refresh(): void {
		const width = Math.max(1, this.tui.terminal.columns);
		const height = Math.max(1, this.tui.terminal.rows);
		this.syncTranscriptState();

		const shellState = this.options.stateStore.getState();
		const hostState = this.options.getHostState();
		const renderModel = this.renderer.render(this.createRenderState(shellState, hostState), this.transcriptSurface.getTimelineView());
		this.metaRow.setText(renderModel.header);
		this.statusRow.setText(this.composeStatusLine(renderModel.status, shellState));
		this.hintRow.setText(this.composeHintLine(shellState));
		this.composerSeparator.setText("─".repeat(width));

		const metaHeight = this.metaRow.render(width).length;
		const headerHeight = this.headerContainer.render(width).length;
		const widgetAboveHeight = this.widgetAboveContainer.render(width).length;
		const separatorHeight = this.composerSeparator.render(width).length;
		const editorHeight = this.editorContainer.render(width).length;
		const widgetBelowHeight = this.widgetBelowContainer.render(width).length;
		const footerHeight = this.footerContainer.render(width).length;
		const statusHeight = this.statusRow.render(width).length;
		const hintHeight = this.hintRow.render(width).length;
		const transcriptHeight = Math.max(
			1,
			height - (metaHeight + headerHeight + widgetAboveHeight + separatorHeight + editorHeight + widgetBelowHeight + footerHeight + statusHeight + hintHeight),
		);

		this.transcriptSurface.setViewportHeight(transcriptHeight);
		this.transcriptRect = {
			row: metaHeight + headerHeight + 1,
			col: 1,
			width,
			height: transcriptHeight,
		};
	}

	toggleSessionsPanel(): void {}

	scrollTranscript(lines: number): void {
		this.transcriptSurface.scrollBy(lines);
		this.options.stateStore.setFollowMode(this.transcriptSurface.getFollowMode());
		this.refresh();
		this.tui.requestRender();
	}

	scrollTranscriptToTop(): void {
		this.transcriptSurface.scrollToTop();
		this.options.stateStore.setFollowMode(this.transcriptSurface.getFollowMode());
		this.refresh();
		this.tui.requestRender();
	}

	scrollTranscriptToBottom(): void {
		this.transcriptSurface.scrollToBottom();
		this.options.stateStore.setFollowMode(this.transcriptSurface.getFollowMode());
		this.refresh();
		this.tui.requestRender();
	}

	dispatchMouse(event: MouseEvent): boolean {
		const insideTranscript =
			event.row >= this.transcriptRect.row &&
			event.row < this.transcriptRect.row + this.transcriptRect.height &&
			event.col >= this.transcriptRect.col &&
			event.col < this.transcriptRect.col + this.transcriptRect.width;
		if (!insideTranscript) {
			return false;
		}

		if (event.action === "scroll") {
			this.transcriptSurface.scrollWheel(event.button === "wheelUp" ? "up" : "down");
			this.options.stateStore.setFollowMode(this.transcriptSurface.getFollowMode());
			this.refresh();
			this.tui.requestRender();
			return true;
		}

		if (event.action === "down" && event.button === "left") {
			const rowIndex = event.row - this.transcriptRect.row;
			const row = this.transcriptSurface.getRowAtViewportIndex(rowIndex);
			if (!row) {
				return false;
			}
			this.options.stateStore.setSelectedTranscriptItem(row.itemId);
			if (this.transcriptSurface.toggleVisibleRow(rowIndex)) {
				this.options.stateStore.setTranscriptExpansionState(this.transcriptSurface.getExpansionState());
			}
			this.refresh();
			this.tui.requestRender();
			return true;
		}

		return false;
	}

	getMenuAnchor(_key: string): { row: number; col: number } {
		return { row: 1, col: 1 };
	}

	private syncTranscriptState(force = false): void {
		if (!this.latestTranscriptPublication) {
			return;
		}
		const shellState = this.options.stateStore.getState();
		const nextKey = JSON.stringify({
			showThinking: shellState.showThinking,
			followMode: shellState.transcript.followMode,
			expansionState: shellState.transcript.expansionState,
			selectedTranscriptItemId: shellState.transcript.selectedTranscriptItemId,
			items: this.latestTranscriptPublication.normalizedTranscript.items.map((item) => item.id),
			streaming: this.latestTranscriptPublication.hostState.isStreaming,
		});
		if (!force && nextKey === this.lastTranscriptSyncKey) {
			return;
		}
		this.lastTranscriptSyncKey = nextKey;
		this.transcriptSurface.syncNormalizedTranscript({
			items: this.latestTranscriptPublication.normalizedTranscript.items,
			showThinking: shellState.showThinking,
			expansionState: shellState.transcript.expansionState,
			followMode: shellState.transcript.followMode,
			isStreaming: this.latestTranscriptPublication.hostState.isStreaming,
			selectedItemId: shellState.transcript.selectedTranscriptItemId,
		});
	}

	private createRenderState(shellState: AppShellState, hostState: AgentHostState | undefined): ShellNextState {
		return {
			showThinking: shellState.showThinking,
			toolOutputExpanded: shellState.toolOutputExpanded,
			meta: {
				sessionLabel: shellState.activeConversationLabel,
				runtimeLabel: shellState.activeRuntimeName,
				psmuxHostLabel: this.footerData.getPsmuxRuntimeLabel() ?? "local",
				providerId: hostState?.model?.provider,
				modelId: hostState?.model?.id,
				streamPhase: hostState?.isStreaming ? "streaming" : "idle",
			},
		};
	}

	private composeStatusLine(baseStatus: string, shellState: AppShellState): string {
		const message = shellState.workingMessage
			?? shellState.contextMessage
			?? shellState.helpMessage
			?? shellState.statusMessage;
		return message ? `${baseStatus} · ${message}` : baseStatus;
	}

	private composeHintLine(shellState: AppShellState): string {
		const branch = this.footerData.getGitBranch();
		const extensionStatuses = [...this.footerData.getExtensionStatuses()].map(([key, value]) => `${key}:${value}`);
		const surfaces = shellState.transcript.launchedSurfaceIds.length > 0
			? `surfaces:${shellState.transcript.launchedSurfaceIds.join(",")}`
			: undefined;
		return [
			branch ? `git:${branch}` : undefined,
			surfaces,
			...extensionStatuses,
			"F1 settings",
			"F2 sessions",
			"F3 orc",
			"Ctrl+B surface",
		]
			.filter((value): value is string => Boolean(value))
			.join(" · ");
	}

	private renderWidgetContainer(container: Container, entries: ReadonlyMap<string, WidgetEntry>): void {
		container.clear();
		for (const entry of entries.values()) {
			container.addChild(entry.component);
		}
	}

	private disposeWidgets(entries: ReadonlyMap<string, WidgetEntry>): void {
		for (const entry of entries.values()) {
			entry.component.dispose?.();
		}
	}
}
