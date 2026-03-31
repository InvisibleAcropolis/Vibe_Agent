import { Container, Text, TUI, type Component, type Terminal } from "@mariozechner/pi-tui";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentHost, AgentHostState } from "./agent-host.js";
import type { AppStateStore } from "./app-state-store.js";
import type { AnimationEngine } from "./animation-engine.js";
import { FooterDataProvider } from "./footer-data-provider.js";
import type { MouseEvent, Rect } from "./mouse.js";
import { SideBySideContainer } from "./components/side-by-side-container.js";
import { TranscriptViewport } from "./components/transcript-viewport.js";
import { ThinkingTray } from "./components/thinking-tray.js";
import { renderShellChrome } from "./shell/shell-chrome-renderer.js";
import { ShellExtensionChrome } from "./shell/shell-extension-chrome.js";
import { measureShellLayout, measureShellMenuAnchor } from "./shell/shell-layout.js";
import { ShellSessionsController } from "./shell/shell-sessions-controller.js";
import { ShellThinkingSync } from "./shell/shell-thinking-sync.js";
import { ShellTranscriptController } from "./shell/shell-transcript-controller.js";
import type { FooterFactory, HeaderFactory, WidgetFactory } from "./shell/shell-types.js";
import type { NormalizedTranscriptPublication } from "./shell/transcript-publication.js";

export interface ShellView {
	readonly tui: TUI;
	readonly footerData: FooterDataProvider;
	start(): void;
	stop(): void;
	setEditor(component: Component): void;
	setFocus(component: Component | null): void;
	setMessages(components: Component[]): void;
	publishNormalizedTranscript?(publication: NormalizedTranscriptPublication): void;
	clearMessages(): void;
	setWidget(key: string, content: WidgetFactory | string[] | undefined, placement?: "aboveEditor" | "belowEditor"): void;
	setHeaderFactory(factory: HeaderFactory | undefined): void;
	setFooterFactory(factory: FooterFactory | undefined): void;
	setTitle(title: string): void;
	refresh(): void;
	toggleSessionsPanel(): void;
	scrollTranscript(lines: number): void;
	scrollTranscriptToTop(): void;
	scrollTranscriptToBottom(): void;
	dispatchMouse(event: MouseEvent): boolean;
	getMenuAnchor(key: string): { row: number; col: number };
}

export class DefaultShellView implements ShellView {
	readonly tui: TUI;
	readonly footerData = new FooterDataProvider(process.cwd());
	private readonly transcriptViewport = new TranscriptViewport();
	private readonly thinkingTray = new ThinkingTray();
	private readonly customHeaderContainer = new Container();
	private readonly widgetContainerAbove = new Container();
	private readonly widgetContainerBelow = new Container();
	private readonly footerContentContainer = new Container();
	private readonly editorContainer = new Container();
	private readonly chromeHeaderInfo = new Text("", 0, 0);
	private readonly chromeMenuBar = new Text("", 0, 0);
	private readonly chromeSeparatorTop = new Text("", 0, 0);
	private readonly chromeSeparatorMid = new Text("", 0, 0);
	private readonly chromeStatus = new Text("", 0, 0);
	private readonly chromeSummary = new Text("", 0, 0);
	private readonly contentArea: SideBySideContainer;
	private readonly extensionChrome: ShellExtensionChrome;
	private readonly transcriptController: ShellTranscriptController;
	private readonly thinkingSync: ShellThinkingSync;
	private readonly sessionsController: ShellSessionsController;
	private transcriptRect: Rect = { row: 1, col: 1, width: 1, height: 1 };
	private animationUnsubscribe?: () => void;

	constructor(
		terminal: Terminal,
		private readonly stateStore: AppStateStore,
		private readonly getHostState: () => AgentHostState | undefined,
		private readonly getMessages: () => AgentMessage[],
		private readonly getAgentHost: () => AgentHost | undefined,
		private readonly animationEngine?: AnimationEngine,
	) {
		this.tui = new TUI(terminal, true);
		this.contentArea = new SideBySideContainer(this.transcriptViewport, null, 30);
		this.transcriptController = new ShellTranscriptController(this.transcriptViewport);
		this.extensionChrome = new ShellExtensionChrome({
			tui: this.tui,
			customHeaderContainer: this.customHeaderContainer,
			widgetContainerAbove: this.widgetContainerAbove,
			widgetContainerBelow: this.widgetContainerBelow,
			footerContentContainer: this.footerContentContainer,
			chromeHeaderInfo: this.chromeHeaderInfo,
			footerData: this.footerData,
			onDefaultHeaderRequested: () => this.refreshChromeOnly(),
		});
		this.thinkingSync = new ShellThinkingSync({
			stateStore: this.stateStore,
			thinkingTray: this.thinkingTray,
			getMessages: () => this.getMessages(),
		});
		this.sessionsController = new ShellSessionsController({
			contentArea: this.contentArea,
			getAgentHost: () => this.getAgentHost(),
			getHostState: () => this.getHostState(),
			setFocus: (component) => this.setFocus(component),
			requestRender: () => this.tui.requestRender(),
			animationEngine: this.animationEngine,
		});

		this.tui.addChild(this.customHeaderContainer);
		this.tui.addChild(this.chromeHeaderInfo);
		this.tui.addChild(this.chromeMenuBar);
		this.tui.addChild(this.chromeSeparatorTop);
		this.tui.addChild(this.contentArea);
		this.tui.addChild(this.chromeSeparatorMid);
		this.tui.addChild(this.widgetContainerAbove);
		this.tui.addChild(this.editorContainer);
		this.tui.addChild(this.widgetContainerBelow);
		this.tui.addChild(this.footerContentContainer);
		this.tui.addChild(this.chromeStatus);
		this.tui.addChild(this.chromeSummary);
		this.tui.addChild(this.thinkingTray);

		this.stateStore.subscribe(() => this.refresh());
		this.footerData.onBranchChange(() => this.refresh());
		(terminal as { setResizeHandler?: (handler: () => void) => () => void }).setResizeHandler?.(() => {
			this.refresh();
			this.tui.requestRender();
		});

		if (this.animationEngine) {
			this.animationUnsubscribe = this.animationEngine.subscribe(() => {
				this.animationEngine!.setStreaming(this.getHostState()?.isStreaming ?? false);
				this.refreshChromeOnly();
				this.tui.requestRender();
			});
		}
	}

	start(): void {
		this.refresh();
		this.tui.start();
	}

	stop(): void {
		this.animationUnsubscribe?.();
		this.animationUnsubscribe = undefined;
		this.extensionChrome.dispose();
		this.footerData.dispose();
		this.tui.stop();
	}

	setEditor(component: Component): void {
		this.editorContainer.clear();
		this.editorContainer.addChild(component);
		this.refresh();
		this.tui.requestRender();
	}

	setFocus(component: Component | null): void {
		this.tui.setFocus(component);
	}

	setMessages(components: Component[]): void {
		this.transcriptController.setMessages(components);
		this.refresh();
		this.tui.requestRender();
	}

	clearMessages(): void {
		this.transcriptController.clearMessages();
		this.refresh();
		this.tui.requestRender();
	}

	setWidget(key: string, content: WidgetFactory | string[] | undefined, placement: "aboveEditor" | "belowEditor" = "aboveEditor"): void {
		this.extensionChrome.setWidget(key, content, placement);
		this.extensionChrome.renderWidgets();
		this.tui.requestRender();
	}

	setHeaderFactory(factory: HeaderFactory | undefined): void {
		this.extensionChrome.setHeaderFactory(factory);
		this.tui.requestRender();
	}

	setFooterFactory(factory: FooterFactory | undefined): void {
		this.extensionChrome.setFooterFactory(factory);
		this.extensionChrome.renderFooterContent();
		this.tui.requestRender();
	}

	setTitle(title: string): void {
		this.tui.terminal.setTitle(title);
	}

	toggleSessionsPanel(): void {
		this.sessionsController.toggle();
		this.refresh();
		this.tui.requestRender();
	}

	refresh(): void {
		this.thinkingSync.sync();
		this.extensionChrome.renderFooterContent();
		this.extensionChrome.renderWidgets();
		this.refreshChromeOnly();

		const layout = measureShellLayout({
			cols: this.tui.terminal.columns,
			rows: this.tui.terminal.rows,
			customHeaderHeight: this.customHeaderContainer.render(this.tui.terminal.columns).length,
			headerHeight: this.chromeHeaderInfo.render(this.tui.terminal.columns).length,
			menuHeight: this.chromeMenuBar.render(this.tui.terminal.columns).length,
			separatorTopHeight: this.chromeSeparatorTop.render(this.tui.terminal.columns).length,
			separatorMidHeight: this.chromeSeparatorMid.render(this.tui.terminal.columns).length,
			widgetAboveHeight: this.widgetContainerAbove.render(this.tui.terminal.columns).length,
			editorHeight: this.editorContainer.render(this.tui.terminal.columns).length,
			widgetBelowHeight: this.widgetContainerBelow.render(this.tui.terminal.columns).length,
			footerContentHeight: this.footerContentContainer.render(this.tui.terminal.columns).length,
			statusHeight: this.chromeStatus.render(this.tui.terminal.columns).length,
			summaryHeight: this.chromeSummary.render(this.tui.terminal.columns).length,
			thinkingTrayHeight: this.thinkingTray.render(this.tui.terminal.columns).length,
			sessionsPanelVisible: this.sessionsController.isVisible(),
			rightWidth: this.contentArea.rightWidth,
		});

		this.transcriptRect = layout.transcriptRect;
		this.transcriptController.setViewportHeight(layout.contentHeight);
		this.contentArea.maxHeight = layout.contentHeight;
		this.transcriptController.measure(Math.max(1, this.transcriptRect.width));
		this.refreshChromeOnly();
	}

	scrollTranscript(lines: number): void {
		this.transcriptController.scrollBy(lines);
		this.transcriptController.measure(Math.max(1, this.transcriptRect.width));
		this.refreshChromeOnly();
		this.tui.requestRender();
	}

	scrollTranscriptToTop(): void {
		this.transcriptController.scrollToTop();
		this.transcriptController.measure(Math.max(1, this.transcriptRect.width));
		this.refreshChromeOnly();
		this.tui.requestRender();
	}

	scrollTranscriptToBottom(): void {
		this.transcriptController.scrollToBottom();
		this.transcriptController.measure(Math.max(1, this.transcriptRect.width));
		this.refreshChromeOnly();
		this.tui.requestRender();
	}

	dispatchMouse(event: MouseEvent): boolean {
		if (!this.transcriptController.dispatchMouse({ event, rect: this.transcriptRect })) {
			return false;
		}
		this.refreshChromeOnly();
		this.tui.requestRender();
		return true;
	}

	getMenuAnchor(key: string): { row: number; col: number } {
		const cols = this.tui.terminal.columns;
		return measureShellMenuAnchor({
			key,
			cols,
			customHeaderHeight: this.customHeaderContainer.render(cols).length,
			headerHeight: this.chromeHeaderInfo.render(cols).length,
		});
	}

	private refreshChromeOnly(): void {
		const chrome = renderShellChrome({
			cols: this.tui.terminal.columns,
			state: this.stateStore.getState(),
			hostState: this.getHostState(),
			footerData: this.footerData,
			transcriptState: this.transcriptController.getState(),
			messages: this.getMessages(),
			animationState: this.animationEngine?.getState(),
			customHeaderActive: this.extensionChrome.hasCustomHeaderFactory(),
		});

		this.chromeHeaderInfo.setText(chrome.headerInfoText);
		this.chromeMenuBar.setText(chrome.menuBarText);
		this.chromeSeparatorTop.setText(chrome.separatorTopText);
		this.chromeSeparatorMid.setText(chrome.separatorMidText);
		this.chromeStatus.setText(chrome.statusText);
		this.chromeSummary.setText(chrome.summaryText);
		this.contentArea.wipeChar = chrome.wipeChar;
		this.sessionsController.setBorderColor(chrome.sessionBorderColor);
	}
}
