import * as path from "node:path";
import { Container, Text, TUI, type Component, type Terminal } from "@mariozechner/pi-tui";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentHost, AgentHostState } from "./agent-host.js";
import type { AppStateStore } from "./app-state-store.js";
import { paintBoxLineTwoParts } from "./ansi.js";
import type { AnimationEngine } from "./animation-engine.js";
import { FooterDataProvider } from "./footer-data-provider.js";
import { estimateContextTokens, theme as codingAgentTheme, type Theme } from "./local-coding-agent.js";
import { agentTheme, createDynamicTheme } from "./theme.js";

const BRAILLE_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"] as const;

// 6-line ANSI Shadow ASCII art for "VIBE AGENT"
// Both words are 6 rows tall (E in VIBE + all AGENT letters have 6 rows).
// Lines 1-5: VIBE letters close, AGENT letters still have content.
// Line 6: Only E (from VIBE) and all AGENT letters show bottom connectors.
const VIBE_AGENT_LOGO = [
	"██╗   ██╗██╗██████╗ ███████╗  █████╗  ██████╗ ███████╗███╗   ██╗████████╗",
	"██║   ██║██║██╔══██╗██╔════╝ ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝",
	"╚██╗ ██╔╝██║██████╔╝█████╗   ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ",
	" ╚████╔╝ ██║██╔══██╗██╔══╝   ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ",
	"  ╚═══╝  ╚═╝╚═════╝ ███████╗ ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ",
	"                    ╚══════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ",
] as const;

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
	setEditor(component: Component): void;
	setFocus(component: Component | null): void;
	setMessages(components: Component[]): void;
	clearMessages(): void;
	setWidget(key: string, content: WidgetFactory | string[] | undefined, placement?: "aboveEditor" | "belowEditor"): void;
	setHeaderFactory(factory: HeaderFactory | undefined): void;
	setFooterFactory(factory: FooterFactory | undefined): void;
	setTitle(title: string): void;
	refresh(): void;
}

export class DefaultShellView implements ShellView {
	readonly tui: TUI;
	readonly footerData = new FooterDataProvider(process.cwd());
	private readonly chatContainer = new Container();
	// customHeaderContainer: holds custom header components injected via setHeaderFactory
	private readonly customHeaderContainer = new Container();
	private readonly widgetContainerAbove = new Container();
	private readonly widgetContainerBelow = new Container();
	private readonly footerContentContainer = new Container();
	private readonly editorContainer = new Container();
	private readonly chromeLogo = new Text("", 0, 0);
	private readonly chromeStatus = new Text("", 0, 0);
	private readonly chromeSummary = new Text("", 0, 0);
	private readonly extensionWidgetsAbove = new Map<string, WidgetFactory>();
	private readonly extensionWidgetsBelow = new Map<string, WidgetFactory>();
	private customHeaderFactory?: HeaderFactory;
	private customFooterFactory?: FooterFactory;
	private customHeaderComponent?: Component & { dispose?(): void };
	private customFooterComponent?: Component & { dispose?(): void };
	private currentHostState?: AgentHostState;

	constructor(
		terminal: Terminal,
		private readonly stateStore: AppStateStore,
		private readonly getHostState: () => AgentHostState | undefined,
		private readonly getMessages: () => AgentMessage[],
		private readonly getAgentHost?: () => AgentHost | undefined,
		private readonly animationEngine?: AnimationEngine,
	) {
		this.tui = new TUI(terminal, true);
		this.tui.addChild(this.customHeaderContainer);
		this.tui.addChild(this.chromeLogo);
		this.tui.addChild(this.chatContainer);
		this.tui.addChild(this.widgetContainerAbove);
		this.tui.addChild(this.editorContainer);
		this.tui.addChild(this.widgetContainerBelow);
		this.tui.addChild(this.footerContentContainer);
		this.tui.addChild(this.chromeStatus);
		this.tui.addChild(this.chromeSummary);

		this.stateStore.subscribe(() => this.refresh());
		this.footerData.onBranchChange(() => this.refresh());

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
		this.refresh();
		this.tui.requestRender();
	}

	clearMessages(): void {
		this.chatContainer.clear();
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
			// When a custom header is active, clear the logo block
			this.chromeLogo.setText("");
		} else {
			// Restore the logo block
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

	refresh(): void {
		this.currentHostState = this.getHostState();
		this.renderFooterContent();
		this.renderWidgets();
		this.refreshChrome();
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

	private refreshChrome(): void {
		const state = this.stateStore.getState();
		const hostState = this.currentHostState;
		const pendingCount = hostState?.pendingMessageCount ?? 0;
		const isStreaming = hostState?.isStreaming ?? false;
		const isCompacting = hostState?.isCompacting ?? false;
		const providerCount = this.footerData.getAvailableProviderCount();
		const provider = hostState?.model?.provider;
		const modelId = hostState?.model?.id;
		const cols = this.tui.terminal.columns;

		const animState = this.animationEngine?.getState() ?? {
			hueOffset: 190, spinnerFrame: 0, breathPhase: 0, glitchActive: false, tickCount: 0,
		};
		const dynTheme = createDynamicTheme(animState);
		const spinnerChar = BRAILLE_FRAMES[animState.spinnerFrame] ?? "⣾";
		// bc = animated border color styler — used for all ╔═╗╠═╣╚═╝ box chars
		const bc = dynTheme.borderAnimated;

		// Only render the logo block if no custom header factory is active
		if (!this.customHeaderFactory) {
			// Build the 10-line logo + info block
			const logoLines: string[] = [];

			// Top border
			logoLines.push(paintBoxLineTwoParts(`${bc("╔")}`, bc("╗"), cols, "═", bc, agentTheme.headerLine));

			// 6 logo lines — each padded to full width inside the box
			for (const logoRow of VIBE_AGENT_LOGO) {
				const inner = `${bc("║")}  ${agentTheme.accentStrong(logoRow)}`;
				logoLines.push(paintBoxLineTwoParts(inner, `  ${bc("║")}`, cols, " ", undefined, agentTheme.headerLine));
			}

			// Separator ╠═══╣
			logoLines.push(paintBoxLineTwoParts(`${bc("╠")}`, bc("╣"), cols, "═", bc, agentTheme.headerLine));

			// Info bar: Session / Thread / CTX
			const sessionName = hostState?.sessionName ?? cwdLabel();
			const threadName = this.footerData.getGitBranch() ?? "main";
			const msgs = this.getMessages();
			const contextWindow = hostState?.model?.contextWindow ?? 200000;
			const ctxPct = msgs.length > 0
				? Math.round(estimateContextTokens(msgs).tokens / contextWindow * 100)
				: 0;
			const ctxColor = ctxPct >= 70 ? agentTheme.warning : agentTheme.success;
			const infoBar = [
				`${agentTheme.info("Session:")} ${agentTheme.success(sessionName)}`,
				`${agentTheme.info("Thread:")} ${agentTheme.accent(threadName)}`,
				`${agentTheme.info("CTX:")} ${ctxColor(`${ctxPct}%`)} ${ctxColor(ctxBar(ctxPct))}`,
			].join(agentTheme.segmentSep());
			const infoLeft = `${bc("║")}  ${infoBar}`;
			logoLines.push(paintBoxLineTwoParts(infoLeft, `  ${bc("║")}`, cols, " ", undefined, agentTheme.headerLine));

			// Help/warning line (e.g. model fallback notice)
			const helpMessage = state.helpMessage;
			if (helpMessage) {
				const helpLeft = `${bc("║")}  ${agentTheme.warning(`⚠  ${helpMessage}`)}`;
				logoLines.push(paintBoxLineTwoParts(helpLeft, `  ${bc("║")}`, cols, " ", undefined, agentTheme.headerLine));
			}

			// Bottom border
			logoLines.push(paintBoxLineTwoParts(`${bc("╚")}`, bc("╝"), cols, "═", bc, agentTheme.headerLine));

			this.chromeLogo.setText(logoLines.join("\n"));
		}

		// ╠══ [status] ══════════════════════════════════════════════════════ [badges] ══╣
		const statusText = state.workingMessage ?? state.statusMessage;
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
		if (provider) {
			segments.push(agentTheme.providerSegment(`⬡ ${provider}`));
		}
		if (modelId) {
			segments.push(agentTheme.modelSegment(modelId));
		} else {
			segments.push(agentTheme.dim("model:setup required"));
		}
		const thinkingLevel = hostState?.thinkingLevel;
		if (thinkingLevel && thinkingLevel !== "off") {
			segments.push(agentTheme.thinkingSegment(`thinking:${thinkingLevel}`));
		}
		if (hostState?.sessionName) {
			segments.push(agentTheme.dim(`session:${hostState.sessionName}`));
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
