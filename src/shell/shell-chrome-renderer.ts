import type { AppShellState } from "../app-state-store.js";
import { paintBoxLineTwoParts, separatorLine } from "../ansi.js";
import { agentTheme, createDynamicTheme } from "../theme.js";
import { renderMenuBar } from "../components/menu-bar.js";
import type { ShellChromeRenderInput, ShellChromeRenderResult } from "./shell-types.js";
import { BRAILLE_FRAMES, createFallbackAnimationState, ctxBar, cwdLabel, SHELL_MENU_ITEMS } from "./shell-constants.js";
import { estimateContextUsagePercent } from "./shell-coding-agent-interop.js";

const WIPE_CHARS = ["░", "▒", "▓", "█"] as const;

export function renderShellChrome(input: ShellChromeRenderInput): ShellChromeRenderResult {
	const pendingCount = input.hostState?.pendingMessageCount ?? 0;
	const isStreaming = input.hostState?.isStreaming ?? false;
	const isCompacting = input.hostState?.isCompacting ?? false;
	const providerCount = input.footerData.getAvailableProviderCount();
	const provider = input.hostState?.model?.provider;
	const modelId = input.hostState?.model?.id;
	const animationState = input.animationState ?? createFallbackAnimationState();
	const dynamicTheme = createDynamicTheme(animationState);
	const spinnerChar = BRAILLE_FRAMES[animationState.spinnerFrame] ?? "⣾";
	const borderStyler = dynamicTheme.borderAnimated;

	return {
		headerInfoText: input.customHeaderActive ? "" : renderHeaderInfo(input, borderStyler),
		menuBarText: renderMenuBar(
			SHELL_MENU_ITEMS,
			input.cols,
			borderStyler,
			agentTheme.dim,
			agentTheme.muted,
			agentTheme.headerLine,
		),
		separatorTopText: separatorLine(input.cols, animationState.separatorOffset, agentTheme.border),
		separatorMidText: separatorLine(input.cols, (animationState.separatorOffset + 20) % 100, agentTheme.border),
		statusText: renderStatusLine(input, borderStyler, pendingCount, isStreaming),
		summaryText: renderSummaryLine(input, borderStyler, providerCount, provider, modelId, isCompacting, isStreaming, spinnerChar),
		wipeChar: animationState.wipeTransition.active
			? (WIPE_CHARS[Math.min(animationState.wipeTransition.frame - 1, 3)] ?? null)
			: null,
		sessionBorderColor: animationState.focusFlashTicks > 0 && animationState.focusedComponent === "sessions"
			? (animationState.focusFlashTicks > 1 ? agentTheme.borderActive : agentTheme.border)
			: agentTheme.border,
	};
}

function renderHeaderInfo(input: ShellChromeRenderInput, borderStyler: (text: string) => string): string {
	const lines: string[] = [];
	lines.push(paintBoxLineTwoParts(`${borderStyler("╔")}`, borderStyler("╗"), input.cols, "═", borderStyler, agentTheme.headerLine));

	const sessionName = input.hostState?.sessionName ?? cwdLabel();
	const threadName = input.footerData.getGitBranch() ?? "main";
	const runtimeName = input.state.activeRuntimeName;
	const contextWindow = input.hostState?.model?.contextWindow ?? 200000;
	const contextPercent = estimateContextUsagePercent(input.messages, contextWindow);
	const contextColor = contextPercent >= 70 ? agentTheme.warning : agentTheme.success;
	const infoBar = [
		`${agentTheme.info("Session:")} ${agentTheme.success(sessionName)}`,
		`${agentTheme.info("Mode:")} ${input.state.activeRuntimeId === "orc" ? agentTheme.warning(runtimeName) : agentTheme.success(runtimeName)}`,
		`${agentTheme.info("Chat:")} ${input.state.activeRuntimeId === "orc" ? agentTheme.warning(input.state.activeConversationLabel) : agentTheme.accent(input.state.activeConversationLabel)}`,
		`${agentTheme.info("Thread:")} ${agentTheme.accent(threadName)}`,
		`${agentTheme.info("CTX:")} ${contextColor(`${contextPercent}%`)} ${contextColor(ctxBar(contextPercent))}`,
	].join(agentTheme.segmentSep());
	lines.push(
		paintBoxLineTwoParts(
			`${borderStyler("║")}  ${infoBar}`,
			`  ${borderStyler("║")}`,
			input.cols,
			" ",
			undefined,
			agentTheme.headerLine,
		),
	);

	if (input.state.helpMessage) {
		lines.push(
			paintBoxLineTwoParts(
				`${borderStyler("║")}  ${agentTheme.warning(`⚠  ${input.state.helpMessage}`)}`,
				`  ${borderStyler("║")}`,
				input.cols,
				" ",
				undefined,
				agentTheme.headerLine,
			),
		);
	}

	if (input.state.contextTitle) {
		const toneStylers: Record<NonNullable<AppShellState["contextTone"]>, (text: string) => string> = {
			accent: agentTheme.bannerAccent,
			info: agentTheme.bannerInfo,
			success: agentTheme.bannerSuccess,
			warning: agentTheme.bannerWarning,
			dim: agentTheme.bannerDim,
		};
		const toneStyler = toneStylers[input.state.contextTone ?? "info"] ?? agentTheme.bannerInfo;
		lines.push(
			paintBoxLineTwoParts(
				`${borderStyler("║")}  ${toneStyler(`  ${input.state.contextTitle}  `)}`,
				`  ${borderStyler("║")}`,
				input.cols,
				" ",
				undefined,
				agentTheme.headerLine,
			),
		);
	}

	lines.push(paintBoxLineTwoParts(`${borderStyler("╚")}`, borderStyler("╝"), input.cols, "═", borderStyler, agentTheme.headerLine));
	return lines.join("\n");
}

function renderStatusLine(
	input: ShellChromeRenderInput,
	borderStyler: (text: string) => string,
	pendingCount: number,
	isStreaming: boolean,
): string {
	const animationState = input.animationState ?? createFallbackAnimationState();
	const rawStatus = input.state.workingMessage ?? input.state.statusMessage;
	const typewriterMatch = animationState.typewriter.target === rawStatus && rawStatus !== "";
	const statusText = typewriterMatch && animationState.typewriter.displayed.length > 0
		? animationState.typewriter.displayed
		: rawStatus;
	const styledStatus = isStreaming ? agentTheme.statusStreaming(statusText ?? "") : agentTheme.statusIdle(statusText ?? "");
	const badgeParts: string[] = [];
	if (input.state.artifacts.length > 0) {
		badgeParts.push(agentTheme.artifactLabel(`artifacts:${input.state.artifacts.length}`));
	}
	if (pendingCount > 0) {
		badgeParts.push(agentTheme.warning(`pending:${pendingCount}`));
	}
	const badgeText = badgeParts.join(agentTheme.segmentSep());
	return paintBoxLineTwoParts(
		`${borderStyler("╠══")} ${styledStatus}`,
		badgeText ? `${badgeText} ${borderStyler("══╣")}` : borderStyler("══╣"),
		input.cols,
		"═",
		borderStyler,
		agentTheme.footerLine,
	);
}

function renderSummaryLine(
	input: ShellChromeRenderInput,
	borderStyler: (text: string) => string,
	providerCount: number,
	provider: string | undefined,
	modelId: string | undefined,
	isCompacting: boolean,
	isStreaming: boolean,
	spinnerChar: string,
): string {
	const segments: string[] = [];
	segments.push(agentTheme.chromeMeta(`providers:${providerCount}`));
	segments.push(
		input.state.activeRuntimeId === "orc"
			? agentTheme.warning(`mode:${input.footerData.getSessionMode()}`)
			: agentTheme.chromeMeta(`mode:${input.footerData.getSessionMode()}`),
	);
	if (provider) {
		segments.push(agentTheme.providerSegment(`⬡ ${provider}`));
	}
	if (modelId) {
		segments.push(agentTheme.modelSegment(modelId));
	} else {
		segments.push(agentTheme.dim("model:setup required"));
	}
	const transcriptTop = input.transcriptState.totalLines === 0 ? 0 : input.transcriptState.scrollOffset + 1;
	const transcriptBottom = input.transcriptState.totalLines === 0
		? 0
		: Math.min(input.transcriptState.totalLines, input.transcriptState.scrollOffset + input.transcriptState.contentHeight);
	segments.push(agentTheme.chromeMeta(`transcript:${transcriptTop}-${transcriptBottom}/${input.transcriptState.totalLines}`));
	segments.push(input.transcriptState.followTail ? agentTheme.success("follow") : agentTheme.warning("paused"));
	const thinkingLevel = input.hostState?.thinkingLevel;
	if (thinkingLevel && thinkingLevel !== "off") {
		segments.push(agentTheme.thinkingSegment(`thinking:${thinkingLevel}`));
	}
	const extensionStatuses = Array.from(input.footerData.getExtensionStatuses().values());
	const allSegments = [...segments, ...extensionStatuses];
	const statusDot = isCompacting
		? agentTheme.statusCompacting("● compacting")
		: isStreaming
			? agentTheme.statusStreaming(`${spinnerChar} streaming`)
			: agentTheme.statusIdle("● idle");

	return paintBoxLineTwoParts(
		`${borderStyler("╚══")} ${allSegments.join(agentTheme.segmentSep())}`,
		`${statusDot} ${borderStyler("══╝")}`,
		input.cols,
		"═",
		borderStyler,
		agentTheme.footerLine,
	);
}
