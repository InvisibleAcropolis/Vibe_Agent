import * as path from "node:path";
import { Container, Text, TUI, type Component, type Terminal } from "@mariozechner/pi-tui";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentHost, AgentHostState } from "./agent-host.js";
import type { AppShellState, AppStateStore } from "./app-state-store.js";
import { paintBoxLineTwoParts, separatorLine } from "./ansi.js";
import type { AnimationEngine } from "./animation-engine.js";
import { FooterDataProvider } from "./footer-data-provider.js";
import { estimateContextTokens, theme as codingAgentTheme, type Theme } from "./local-coding-agent.js";
import type { MouseEvent, Rect } from "./mouse.js";
import { agentTheme, createDynamicTheme } from "./theme.js";
import { SessionsPanel } from "./components/sessions-panel.js";
import { SideBySideContainer } from "./components/side-by-side-container.js";
import { renderMenuBar, measureMenuBarItems, MenuBarItem } from "./components/menu-bar.js";
import { TranscriptViewport } from "./components/transcript-viewport.js";
import { ThinkingTray } from "./components/thinking-tray.js";
import { extractLatestThinkingText } from "./message-renderer.js";

const BRAILLE_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"] as const;

function ctxBar(pct: number, width = 8): string {
	const filled = Math.round((pct / 100) * width);
	return "█".repeat(filled) + "░".repeat(width - filled);
}

type WidgetFactory = (tui: TUI, theme: Theme) => Component & { dispose?(): void };
type FooterFactory = (tui: TUI, theme: Theme, footerData: FooterDataProvider) => Component & { dispose?(): void };
type HeaderFactory = (tui: TUI, theme: Theme) => Component & { dispose?(): void };

function cwdLabel(): string {
	return path.basename(process.cwd()) || process.cwd();
}

export interface ShellView {
	readonly tui: TUI;
	readonly footerData: FooterDataProvider;
	start(): void;
	stop(): void;
	setSplashFrame(lines: string[]): void;
	setEditor(component: Component): void;
	setFocus(component: Component | null): void;
	setMessages(components: Component[]): void;
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
	private readonly chatContainer = new Container();
	private readonly transcriptViewport = new TranscriptViewport();
	private readonly chromeSplashBand = new Text("", 0, 0);
	// customHeaderContainer: holds custom header components injected via setHeaderFactory
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
	private readonly thinkingTray = new ThinkingTray();
	private readonly extensionWidgetsAbove = new Map<string, WidgetFactory>();
	private readonly extensionWidgetsBelow = new Map<string, WidgetFactory>();
	private customHeaderFactory?: HeaderFactory;
	private customFooterFactory?: FooterFactory;
	private customHeaderComponent?: Component & { dispose?(): void };
	private customFooterComponent?: Component & { dispose?(): void };
	private currentHostState?: AgentHostState;
	private contentArea!: SideBySideContainer;
	private sessionsPanel: SessionsPanel | null = null;
	private sessionsPanelVisible = false;
	private transcriptRect: Rect = { row: 1, col: 1, width: 1, height: 1 };

	constructor(
		terminal: Terminal,
		private readonly stateStore: AppStateStore,
		private readonly getHostState: () => AgentHostState | undefined,
		private readonly getMessages: () => AgentMessage[],
		private readonly getAgentHost: () => AgentHost | undefined,
		private readonly animationEngine?: AnimationEngine,
	) {
		this.tui = new TUI(terminal, true);
		this.tui.addChild(this.chromeSplashBand);
		this.tui.addChild(this.customHeaderContainer);
		this.tui.addChild(this.chromeHeaderInfo);
		this.tui.addChild(this.chromeMenuBar);
		this.tui.addChild(this.chromeSeparatorTop);
		this.contentArea = new SideBySideContainer(this.transcriptViewport, null, 30);
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
			this.animationEngine.setOnTick(() => {
				const hostState = this.getHostState();
				this.animationEngine!.setStreaming(hostState?.isStreaming ?? false);
				this.refreshChrome();
				this.tui.requestRender();
			});
		}
	}

	start(): void {
		this.refresh();
		this.tui.start();
	}

	stop(): void {
		this.disposeCustomChrome();
		this.footerData.dispose();
		this.tui.stop();
	}

	setSplashFrame(lines: string[]): void {
		this.chromeSplashBand.setText(lines.join("\n"));
		this.refreshLayout();
		this.transcriptViewport.measure(Math.max(1, this.transcriptRect.width));
		this.refreshChrome();
		this.tui.requestRender();
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
		this.chatContainer.clear();
		for (const component of components) {
			this.chatContainer.addChild(component);
		}
		this.transcriptViewport.setComponents(components);
		this.refresh();
		this.tui.requestRender();
	}

	clearMessages(): void {
		this.chatContainer.clear();
		this.transcriptViewport.setComponents([]);
		this.refresh();
		this.tui.requestRender();
	}

	setWidget(key: string, content: WidgetFactory | string[] | undefined, placement: "aboveEditor" | "belowEditor" = "aboveEditor"): void {
		const target = placement === "belowEditor" ? this.extensionWidgetsBelow : this.extensionWidgetsAbove;
		if (!content) {
			target.delete(key);
		} else if (Array.isArray(content)) {
			target.set(key, () => new Text(content.join("\n"), 1, 0));
		} else {
			target.set(key, content);
		}
		this.renderWidgets();
		this.tui.requestRender();
	}

	setHeaderFactory(factory: HeaderFactory | undefined): void {
		this.customHeaderFactory = factory;
		this.customHeaderContainer.clear();
		this.customHeaderComponent?.dispose?.();
		this.customHeaderComponent = undefined;
		if (factory) {
			this.customHeaderComponent = factory(this.tui, codingAgentTheme);
			this.customHeaderContainer.addChild(this.customHeaderComponent);
			this.chromeHeaderInfo.setText("");
		} else {
			this.refreshChrome();
		}
		this.tui.requestRender();
	}

	setFooterFactory(factory: FooterFactory | undefined): void {
		this.customFooterFactory = factory;
		this.renderFooterContent();
		this.tui.requestRender();
	}

	setTitle(title: string): void {
		this.tui.terminal.setTitle(title);
	}

	toggleSessionsPanel(): void {
		this.sessionsPanelVisible = !this.sessionsPanelVisible;
		if (this.sessionsPanelVisible) {
			if (!this.sessionsPanel) {
				this.sessionsPanel = new SessionsPanel({
					getSessions: async () => {
						const h = this.getAgentHost();
						if (!h) return [];
						return h.listSessions("all");
					},
					getCurrentSessionFile: () => {
						const state = this.getHostState();
						return state?.sessionFile;
					},
					onSwitch: async (sessionPath) => {
						this.animationEngine?.triggerWipeTransition();
						await this.getAgentHost()?.switchSession(sessionPath);
					},
					onClose: () => {
						this.sessionsPanelVisible = false;
						this.contentArea.right = null;
						this.setFocus(null);
						this.tui.requestRender();
					},
				});
			}
			void this.sessionsPanel.refresh();
			this.contentArea.right = this.sessionsPanel;
			this.setFocus(this.sessionsPanel as any);
			this.animationEngine?.triggerFocusFlash("sessions");
		} else {
			this.contentArea.right = null;
			this.setFocus(null);
		}
		this.refresh();
		this.tui.requestRender();
	}

	refresh(): void {
		this.currentHostState = this.getHostState();
		this.syncThinkingTray();
		this.renderFooterContent();
		this.renderWidgets();
		this.refreshChrome();
		this.refreshLayout();
		this.transcriptViewport.measure(Math.max(1, this.transcriptRect.width));
		this.refreshChrome();
	}

	scrollTranscript(lines: number): void {
		this.transcriptViewport.scrollBy(lines);
		this.transcriptViewport.measure(Math.max(1, this.transcriptRect.width));
		this.refreshChrome();
		this.tui.requestRender();
	}

	scrollTranscriptToTop(): void {
		this.transcriptViewport.scrollToTop();
		this.transcriptViewport.measure(Math.max(1, this.transcriptRect.width));
		this.refreshChrome();
		this.tui.requestRender();
	}

	scrollTranscriptToBottom(): void {
		this.transcriptViewport.scrollToBottom();
		this.transcriptViewport.measure(Math.max(1, this.transcriptRect.width));
		this.refreshChrome();
		this.tui.requestRender();
	}

	dispatchMouse(event: MouseEvent): boolean {
		if (event.action !== "scroll") {
			return false;
		}
		const rect = this.transcriptRect;
		const inside =
			event.row >= rect.row &&
			event.row < rect.row + rect.height &&
			event.col >= rect.col &&
			event.col < rect.col + rect.width;
		if (!inside) {
			return false;
		}
		this.scrollTranscript(event.button === "wheelUp" ? -3 : 3);
		return true;
	}

	getMenuAnchor(key: string): { row: number; col: number } {
		const cols = this.tui.terminal.columns;
		const menuItems: MenuBarItem[] = [
			{ key: "F1", label: "Settings" },
			{ key: "F2", label: "Sessions" },
			{ key: "F3", label: "Orc" },
		];
		const layout = measureMenuBarItems(menuItems).find((item) => item.key === key);
		const splashHeight = this.chromeSplashBand.render(cols).length;
		const customHeaderHeight = this.customHeaderContainer.render(cols).length;
		const headerHeight = this.chromeHeaderInfo.render(cols).length;
		return {
			row: splashHeight + customHeaderHeight + headerHeight + 1,
			col: layout?.startCol ?? 2,
		};
	}

	private renderFooterContent(): void {
		this.footerContentContainer.clear();
		this.customFooterComponent?.dispose?.();
		this.customFooterComponent = undefined;
		if (this.customFooterFactory) {
			this.customFooterComponent = this.customFooterFactory(this.tui, codingAgentTheme, this.footerData);
			this.footerContentContainer.addChild(this.customFooterComponent);
		}
	}

	private renderWidgets(): void {
		this.widgetContainerAbove.clear();
		for (const factory of this.extensionWidgetsAbove.values()) {
			this.widgetContainerAbove.addChild(factory(this.tui, codingAgentTheme));
		}

		this.widgetContainerBelow.clear();
		for (const factory of this.extensionWidgetsBelow.values()) {
			this.widgetContainerBelow.addChild(factory(this.tui, codingAgentTheme));
		}
	}

	private syncThinkingTray(): void {
		const state = this.stateStore.getState();
		this.thinkingTray.setEnabled(state.showThinking);
		if (!state.showThinking) {
			this.thinkingTray.setThinkingText(undefined);
			return;
		}
		if (state.activeThinking.hasTurnState || state.activeThinking.hasThinkingEvents || state.activeThinking.text.length > 0) {
			this.thinkingTray.setThinkingText(state.activeThinking.text);
			return;
		}
		this.thinkingTray.setThinkingText(extractLatestThinkingText(this.getMessages()));
	}

	private refreshLayout(): void {
		const cols = this.tui.terminal.columns;
		const rows = this.tui.terminal.rows;
		const splashHeight = this.chromeSplashBand.render(cols).length;
		const customHeaderHeight = this.customHeaderContainer.render(cols).length;
		const headerHeight = this.chromeHeaderInfo.render(cols).length;
		const menuHeight = this.chromeMenuBar.render(cols).length;
		const separatorTopHeight = this.chromeSeparatorTop.render(cols).length;
		const separatorMidHeight = this.chromeSeparatorMid.render(cols).length;
		const widgetAboveHeight = this.widgetContainerAbove.render(cols).length;
		const editorHeight = this.editorContainer.render(cols).length;
		const widgetBelowHeight = this.widgetContainerBelow.render(cols).length;
		const footerContentHeight = this.footerContentContainer.render(cols).length;
		const statusHeight = this.chromeStatus.render(cols).length;
		const summaryHeight = this.chromeSummary.render(cols).length;
		const thinkingTrayHeight = this.thinkingTray.render(cols).length;

		const fixedHeight =
			splashHeight +
			customHeaderHeight +
			headerHeight +
			menuHeight +
			separatorTopHeight +
			separatorMidHeight +
			widgetAboveHeight +
			editorHeight +
			widgetBelowHeight +
			footerContentHeight +
			statusHeight +
			summaryHeight +
			thinkingTrayHeight;
		const contentHeight = Math.max(3, rows - fixedHeight);
		this.transcriptViewport.setViewportHeight(contentHeight);
		this.contentArea.maxHeight = contentHeight;

		const leftWidth = this.sessionsPanelVisible ? Math.max(0, cols - this.contentArea.rightWidth - 1) : cols;
		const contentRow = 1 + splashHeight + customHeaderHeight + headerHeight + menuHeight + separatorTopHeight;
		this.transcriptRect = {
			row: contentRow,
			col: 1,
			width: Math.max(1, leftWidth),
			height: contentHeight,
		};
	}

	private refreshChrome(): void {
		const state = this.stateStore.getState();
		const hostState = this.currentHostState;
		const pendingCount = hostState?.pendingMessageCount ?? 0;
		const isStreaming = hostState?.isStreaming ?? false;
		const isCompacting = hostState?.isCompacting ?? false;
		const providerCount = this.footerData.getAvailableProviderCount();
		const provider = hostState?.model?.provider;
		const modelId = hostState?.model?.id;
		const transcriptState = this.transcriptViewport.getState();
		const cols = this.tui.terminal.columns;

		const animState = this.animationEngine?.getState() ?? {
			hueOffset: 190, spinnerFrame: 0, breathPhase: 0, glitchActive: false, tickCount: 0,
			focusFlashTicks: 0, focusedComponent: "editor" as const,
			wipeTransition: { active: false, frame: 0 },
			separatorOffset: 0,
			typewriter: { target: "", displayed: "", ticksSinceChar: 0 },
		};
		const dynTheme = createDynamicTheme(animState);
		const spinnerChar = BRAILLE_FRAMES[animState.spinnerFrame] ?? "⣾";
		// bc = animated border color styler — used for all ╔═╗╠═╣╚═╝ box chars
		const bc = dynTheme.borderAnimated;

		// Render the persistent shell header only when extensions have not replaced it.
		if (!this.customHeaderFactory) {
			const headerLines: string[] = [];
			headerLines.push(paintBoxLineTwoParts(`${bc("╔")}`, bc("╗"), cols, "═", bc, agentTheme.headerLine));

			const sessionName = hostState?.sessionName ?? cwdLabel();
			const threadName = this.footerData.getGitBranch() ?? "main";
			const activeConversationLabel = state.activeConversationLabel;
			const runtimeName = state.activeRuntimeName;
			const msgs = this.getMessages();
			const contextWindow = hostState?.model?.contextWindow ?? 200000;
			const ctxPct = msgs.length > 0
				? Math.round(estimateContextTokens(msgs).tokens / contextWindow * 100)
				: 0;
			const ctxColor = ctxPct >= 70 ? agentTheme.warning : agentTheme.success;
			const infoBar = [
				`${agentTheme.info("Session:")} ${agentTheme.success(sessionName)}`,
				`${agentTheme.info("Mode:")} ${state.activeRuntimeId === "orc" ? agentTheme.warning(runtimeName) : agentTheme.success(runtimeName)}`,
				`${agentTheme.info("Chat:")} ${state.activeRuntimeId === "orc" ? agentTheme.warning(activeConversationLabel) : agentTheme.accent(activeConversationLabel)}`,
				`${agentTheme.info("Thread:")} ${agentTheme.accent(threadName)}`,
				`${agentTheme.info("CTX:")} ${ctxColor(`${ctxPct}%`)} ${ctxColor(ctxBar(ctxPct))}`,
			].join(agentTheme.segmentSep());
			const infoLeft = `${bc("║")}  ${infoBar}`;
			headerLines.push(paintBoxLineTwoParts(infoLeft, `  ${bc("║")}`, cols, " ", undefined, agentTheme.headerLine));

			const helpMessage = state.helpMessage;
			if (helpMessage) {
				const helpLeft = `${bc("║")}  ${agentTheme.warning(`⚠  ${helpMessage}`)}`;
				headerLines.push(paintBoxLineTwoParts(helpLeft, `  ${bc("║")}`, cols, " ", undefined, agentTheme.headerLine));
			}

			const contextTitle = state.contextTitle;
			if (contextTitle) {
				const toneStylers: Record<NonNullable<AppShellState["contextTone"]>, (s: string) => string> = {
					accent: agentTheme.bannerAccent,
					info: agentTheme.bannerInfo,
					success: agentTheme.bannerSuccess,
					warning: agentTheme.bannerWarning,
					dim: agentTheme.bannerDim,
				};
				const toneStyler = toneStylers[state.contextTone ?? "info"] ?? agentTheme.bannerInfo;
				const contextLeft = `${bc("║")}  ${toneStyler(`  ${contextTitle}  `)}`;
				headerLines.push(paintBoxLineTwoParts(contextLeft, `  ${bc("║")}`, cols, " ", undefined, agentTheme.headerLine));
			}

			headerLines.push(paintBoxLineTwoParts(`${bc("╚")}`, bc("╝"), cols, "═", bc, agentTheme.headerLine));
			this.chromeHeaderInfo.setText(headerLines.join("\n"));
		}

		// Menu bar: [F1] Settings  ◆  [F2] Sessions  ◆  [F3] Orc ═══════════════════
		// F3 now anchors the dedicated Orc dashboard/menu entry for summarized orchestration telemetry.
		const MENU_ITEMS: MenuBarItem[] = [
			{ key: "F1", label: "Settings" },
			{ key: "F2", label: "Sessions" },
			{ key: "F3", label: "Orc" },
		];
		this.chromeMenuBar.setText(renderMenuBar(
			MENU_ITEMS, cols, bc,
			agentTheme.dim,
			agentTheme.muted,
			agentTheme.headerLine,
		));

		// B: Block-fill wipe transition (░ ▒ ▓ █ over 4 ticks, then clear)
		const WIPE_CHARS = ["░", "▒", "▓", "█"] as const;
		this.contentArea.wipeChar = animState.wipeTransition.active
			? (WIPE_CHARS[Math.min(animState.wipeTransition.frame - 1, 3)] ?? null)
			: null;

		// C: Animated separator glyphs (crawl offset shifts by 1 every 8 ticks)
		this.chromeSeparatorTop.setText(separatorLine(cols, animState.separatorOffset, agentTheme.border));
		this.chromeSeparatorMid.setText(separatorLine(cols, (animState.separatorOffset + 20) % 100, agentTheme.border));

		// A: Focus flash — lerp sessions panel border color
		if (this.sessionsPanel && animState) {
			const flashTicks = animState.focusFlashTicks;
			if (flashTicks > 0 && animState.focusedComponent === "sessions") {
				this.sessionsPanel.borderColor = flashTicks > 1
					? agentTheme.borderActive
					: agentTheme.border;
			} else {
				this.sessionsPanel.borderColor = agentTheme.border;
			}
		}

		// ╠══ [status] ══════════════════════════════════════════════════════ [badges] ══╣
		const rawStatus = state.workingMessage ?? state.statusMessage;
		const typewriterMatch = animState.typewriter.target === rawStatus && rawStatus !== "";
		const statusText = (typewriterMatch && animState.typewriter.displayed.length > 0)
			? animState.typewriter.displayed
			: rawStatus;
		const styledStatus = isStreaming
			? agentTheme.statusStreaming(statusText ?? "")
			: agentTheme.statusIdle(statusText ?? "");
		const artifactCount = state.artifacts.length;
		const artifactBadgeParts: string[] = [];
		if (artifactCount > 0) {
			artifactBadgeParts.push(agentTheme.artifactLabel(`artifacts:${artifactCount}`));
		}
		if (pendingCount > 0) {
			artifactBadgeParts.push(agentTheme.warning(`pending:${pendingCount}`));
		}
		const artifactBadge = artifactBadgeParts.join(agentTheme.segmentSep());
		const statusLeft = `${bc("╠══")} ${styledStatus}`;
		const statusRight = artifactBadge
			? `${artifactBadge} ${bc("══╣")}`
			: bc("══╣");
		this.chromeStatus.setText(
			paintBoxLineTwoParts(statusLeft, statusRight, cols, "═", bc, agentTheme.footerLine),
		);

		// ╚══ providers:N │ ⬡ provider │ model │ thinking ════════════════════ ● idle ══╝
		const segments: string[] = [];
		segments.push(agentTheme.chromeMeta(`providers:${providerCount}`));
		segments.push(
			state.activeRuntimeId === "orc"
				? agentTheme.warning(`mode:${this.footerData.getSessionMode()}`)
				: agentTheme.chromeMeta(`mode:${this.footerData.getSessionMode()}`),
		);
		if (provider) {
			segments.push(agentTheme.providerSegment(`⬡ ${provider}`));
		}
		if (modelId) {
			segments.push(agentTheme.modelSegment(modelId));
		} else {
			segments.push(agentTheme.dim("model:setup required"));
		}
		const transcriptTop = transcriptState.totalLines === 0 ? 0 : transcriptState.scrollOffset + 1;
		const transcriptBottom = transcriptState.totalLines === 0
			? 0
			: Math.min(transcriptState.totalLines, transcriptState.scrollOffset + transcriptState.contentHeight);
		segments.push(
			agentTheme.chromeMeta(`transcript:${transcriptTop}-${transcriptBottom}/${transcriptState.totalLines}`),
		);
		segments.push(
			transcriptState.followTail
				? agentTheme.success("follow")
				: agentTheme.warning("paused"),
		);
		const thinkingLevel = hostState?.thinkingLevel;
		if (thinkingLevel && thinkingLevel !== "off") {
			segments.push(agentTheme.thinkingSegment(`thinking:${thinkingLevel}`));
		}
		const extensionStatuses = Array.from(this.footerData.getExtensionStatuses().values());
		const allSegments = [...segments, ...extensionStatuses];

		const statusDot = isCompacting
			? agentTheme.statusCompacting("● compacting")
			: isStreaming
				? agentTheme.statusStreaming(`${spinnerChar} streaming`)
				: agentTheme.statusIdle("● idle");
		const summaryLeft = `${bc("╚══")} ${allSegments.join(agentTheme.segmentSep())}`;
		const summaryRight = `${statusDot} ${bc("══╝")}`;
		this.chromeSummary.setText(
			paintBoxLineTwoParts(summaryLeft, summaryRight, cols, "═", bc, agentTheme.footerLine),
		);
	}

	private disposeCustomChrome(): void {
		this.customHeaderComponent?.dispose?.();
		this.customFooterComponent?.dispose?.();
	}
}
