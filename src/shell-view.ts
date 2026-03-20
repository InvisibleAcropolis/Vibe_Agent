import * as path from "node:path";
import { Container, Spacer, Text, TUI, type Component, type Terminal } from "@mariozechner/pi-tui";
import type { AgentHostState } from "./agent-host.js";
import type { AppStateStore } from "./app-state-store.js";
import { glitchLine, innerBoxBottom, innerBoxLine, innerBoxSep, innerBoxTop, paintBoxLineTwoParts, paintLine, paintLineTwoParts } from "./ansi.js";
import type { AnimationEngine } from "./animation-engine.js";
import { FooterDataProvider } from "./footer-data-provider.js";
import { theme as codingAgentTheme, type Theme } from "./local-coding-agent.js";
import { agentTheme, createDynamicTheme } from "./theme.js";

const BRAILLE_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"] as const;

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
	private readonly headerContentContainer = new Container();
	private readonly widgetContainerAbove = new Container();
	private readonly widgetContainerBelow = new Container();
	private readonly footerContentContainer = new Container();
	private readonly editorContainer = new Container();
	private readonly chromeHeader = new Text("", 0, 0);
	private readonly chromeLogo = new Text("", 0, 0);
	private readonly chromeHelp = new Text("", 0, 0);
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
		private readonly animationEngine?: AnimationEngine,
	) {
		this.tui = new TUI(terminal, true);
		this.tui.addChild(this.chromeHeader);
		this.tui.addChild(this.chromeLogo);
		this.tui.addChild(this.chromeHelp);
		this.tui.addChild(this.headerContentContainer);
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
		this.renderHeaderContent();
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
		this.renderHeaderContent();
		this.renderFooterContent();
		this.renderWidgets();
		this.refreshChrome();
	}

	private renderHeaderContent(): void {
		this.headerContentContainer.clear();
		this.customHeaderComponent?.dispose?.();
		this.customHeaderComponent = undefined;
		if (this.customHeaderFactory) {
			this.customHeaderComponent = this.customHeaderFactory(this.tui, codingAgentTheme);
			this.headerContentContainer.addChild(this.customHeaderComponent);
			return;
		}

		const state = this.stateStore.getState();
		const hostState = this.currentHostState;
		const providerCount = this.footerData.getAvailableProviderCount();
		const provider = hostState?.model?.provider;
		const modelId = hostState?.model?.id;
		const width = this.tui.terminal.columns;
		// bs = dim border styler for inner boxes (subtle, not competing with outer chrome)
		const bs = agentTheme.dim;

		this.headerContentContainer.addChild(new Spacer(1));

		if (state.contextTitle || state.contextMessage) {
			// Custom context: one bordered box with the context title + message
			const titleStyler = this.getBannerTitleStyle(state.contextTone);
			const title = state.contextTitle ?? "STATUS";
			this.headerContentContainer.addChild(new Text(innerBoxTop(title, width, bs, titleStyler), 0, 0));
			if (state.contextMessage) {
				this.headerContentContainer.addChild(new Text(innerBoxLine(state.contextMessage, width, bs), 0, 0));
			}
			this.headerContentContainer.addChild(new Text(innerBoxBottom(width, bs), 0, 0));
		} else {
			// Default banner: STATUS box (ready message + body) + CONNECTION section
			this.headerContentContainer.addChild(
				new Text(innerBoxTop("STATUS", width, bs, agentTheme.dim), 0, 0),
			);
			this.headerContentContainer.addChild(
				new Text(innerBoxLine(agentTheme.accentStrong("Ready for your next task"), width, bs), 0, 0),
			);
			this.headerContentContainer.addChild(
				new Text(innerBoxLine(agentTheme.muted("Type a prompt, press F1 for grouped commands, or use /setup to change provider defaults."), width, bs), 0, 0),
			);

			// CONNECTION section separator inside the same box
			this.headerContentContainer.addChild(
				new Text(innerBoxSep("CONNECTION", width, bs, agentTheme.dim), 0, 0),
			);

			const connectionLine = [
				agentTheme.dim(`providers:${providerCount}`),
				agentTheme.providerSegment(provider ? `⬡ ${provider}` : "none"),
				agentTheme.modelSegment(modelId ?? "not selected"),
			].join(agentTheme.segmentSep());
			this.headerContentContainer.addChild(
				new Text(innerBoxLine(connectionLine, width, bs), 0, 0),
			);

			this.headerContentContainer.addChild(new Text(innerBoxBottom(width, bs), 0, 0));
		}

		const helpMessage = state.helpMessage;
		if (helpMessage) {
			this.headerContentContainer.addChild(new Spacer(1));
			this.headerContentContainer.addChild(
				new Text(agentTheme.warning(`  ⚠  ${helpMessage}`), 0, 0),
			);
		}

		this.headerContentContainer.addChild(new Spacer(1));
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
		const sessionLabel = hostState?.sessionName ?? cwdLabel();
		const gitBranch = this.footerData.getGitBranch();
		const branchLabel = gitBranch ? agentTheme.dim(` [${gitBranch}]`) : "";
		const providerCount = this.footerData.getAvailableProviderCount();
		const provider = hostState?.model?.provider;
		const modelId = hostState?.model?.id;
		const pendingCount = hostState?.pendingMessageCount ?? 0;
		const isStreaming = hostState?.isStreaming ?? false;
		const isCompacting = hostState?.isCompacting ?? false;
		const cols = this.tui.terminal.columns;

		const animState = this.animationEngine?.getState() ?? {
			hueOffset: 190, spinnerFrame: 0, breathPhase: 0, glitchActive: false, tickCount: 0,
		};
		const dynTheme = createDynamicTheme(animState);
		const spinnerChar = BRAILLE_FRAMES[animState.spinnerFrame] ?? "⣾";
		// bc = animated border color styler — used for all ╔═╗╠═╣╚═╝ box chars
		const bc = dynTheme.borderAnimated;

		// ╔══ ⬡ FutureIDE Agent · session [branch] ════════════════════ ● CONNECTED provider ══╗
		const leftHeader = `${bc("╔══")} ${agentTheme.accentStrong("⬡ FutureIDE Agent")}${agentTheme.dim("  ·  ")}${agentTheme.chromeMeta(sessionLabel)}${branchLabel}`;
		const rightHeader = provider
			? `${agentTheme.connectedIndicator("●")} ${agentTheme.chromeBadge(" CONNECTED ")} ${agentTheme.providerSegment(provider)} ${bc("══╗")}`
			: `${agentTheme.warning("○")} ${agentTheme.dim("NO PROVIDER")} ${bc("══╗")}`;
		let headerLine = paintBoxLineTwoParts(leftHeader, rightHeader, cols, "═", bc, agentTheme.headerLine);
		if (animState.glitchActive) {
			headerLine = glitchLine(headerLine, 4);
		}
		this.chromeHeader.setText(headerLine);

		// ╠══ ▀▀ FUTURE·IDE  ⬡  CONNECTED ● provider  model ══════════════════════════════════╣
		const logoLeft = `${bc("╠══")} ${agentTheme.accentStrong("▀▀ FUTURE·IDE")}  ${agentTheme.dim("⬡")}  `;
		const logoRight = provider
			? `${agentTheme.success("CONNECTED")} ${agentTheme.dim("●")} ${agentTheme.providerSegment(provider)}  ${agentTheme.modelSegment(modelId ?? "none")}  ${bc("══╣")}`
			: `${agentTheme.warning("SETUP REQUIRED")}  ${bc("══╣")}`;
		this.chromeLogo.setText(
			paintBoxLineTwoParts(logoLeft, logoRight, cols, "═", bc, agentTheme.headerLine),
		);

		// ╠══ F1 palette · /setup /provider /model · /theme · Ctrl+Q ═════════════════════════╣
		const helpLeft = `${bc("╠══")} ${agentTheme.chromeMeta("F1 palette · /setup /provider /model · /theme · Ctrl+Q quit")}`;
		const helpRight = bc("══╣");
		this.chromeHelp.setText(
			paintBoxLineTwoParts(helpLeft, helpRight, cols, "═", bc, agentTheme.headerLine),
		);

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

	private getBannerTitleStyle(tone: "accent" | "info" | "success" | "warning" | "dim" | undefined) {
		switch (tone) {
			case "success":
				return agentTheme.bannerSuccess;
			case "warning":
				return agentTheme.bannerWarning;
			case "dim":
				return agentTheme.bannerDim;
			case "info":
				return agentTheme.bannerInfo;
			case "accent":
			default:
				return agentTheme.bannerAccent;
		}
	}

	private disposeCustomChrome(): void {
		this.customHeaderComponent?.dispose?.();
		this.customFooterComponent?.dispose?.();
	}
}
