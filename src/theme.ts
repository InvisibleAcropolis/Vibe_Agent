import type { DefaultTextStyle, MarkdownTheme, SelectListTheme } from "@mariozechner/pi-tui";
import { style, type Styler } from "./ansi.js";
import type { AnimationState } from "./animation-engine.js";
import { createDynamicTheme as createDynamicThemeFromConfig, getActiveTheme, type DynamicTheme } from "./themes/index.js";

export type { DynamicTheme };

export function createDynamicTheme(animState: AnimationState): DynamicTheme {
	return createDynamicThemeFromConfig(getActiveTheme(), animState);
}

const colors = {
	canvas: "#060e18",
	header: "#0a1a2c",
	footer: "#081620",
	surface: "#0e1c2a",
	surfaceActive: "#122e48",
	surfaceMuted: "#10263a",
	surfaceRaised: "#16344d",
	text: "#e4edf5",
	muted: "#98afc2",
	dim: "#6c8399",
	accent: "#5cd4ff",
	accentStrong: "#20b0ee",
	accentDim: "#2a7aa0",
	border: "#254560",
	borderActive: "#60d2ff",
	success: "#66dd96",
	warning: "#f0c058",
	error: "#ff8878",
	info: "#78c0e0",
	code: "#9ae0ff",
	artifact: "#b0a0ff",
	tool: "#70e0a0",
	thinking: "#f0c058",
};

const bold = style({ bold: true });
const text = style({ fg: colors.text });
const muted = style({ fg: colors.muted });
const dim = style({ fg: colors.dim });
const accent = style({ fg: colors.accent });
const accentStrong = style({ fg: colors.accentStrong, bold: true });
const warning = style({ fg: colors.warning, bold: true });
const error = style({ fg: colors.error, bold: true });
const success = style({ fg: colors.success, bold: true });
const info = style({ fg: colors.info });
const headerBg = style({ bg: colors.header, fg: colors.text });
const footerBg = style({ bg: colors.footer, fg: colors.muted });
const panelBg = style({ bg: colors.surface });
const panelBgActive = style({ bg: colors.surfaceActive });
const panelBgRaised = style({ bg: colors.surfaceRaised });
const toolLabel = style({ fg: colors.tool, bold: true });
const artifactLabel = style({ fg: colors.artifact, bold: true });
const thinkingLabel = style({ fg: colors.thinking, italic: true });

// Powerline segment stylers
const providerSegment = style({ fg: colors.accent, bold: true });
const modelSegment = style({ fg: colors.success });
const thinkingSegment = style({ fg: colors.warning });
const segmentSep = () => dim(" │ ");
const statusIdle = style({ fg: colors.success, bold: true });
const statusStreaming = style({ fg: colors.warning, bold: true });
const statusCompacting = style({ fg: colors.info, bold: true });
const connectedIndicator = style({ fg: colors.success, bold: true });
const disconnectedIndicator = dim("○ no provider");
const bannerAccent = style({ fg: colors.accentStrong, bg: colors.surfaceRaised, bold: true });
const bannerInfo = style({ fg: colors.info, bg: colors.surfaceRaised, bold: true });
const bannerSuccess = style({ fg: colors.success, bg: colors.surfaceRaised, bold: true });
const bannerWarning = style({ fg: colors.warning, bg: colors.surfaceRaised, bold: true });
const bannerBody = style({ fg: colors.text, bg: colors.surfaceRaised });
const bannerDim = style({ fg: colors.dim, bg: colors.surfaceRaised });
const chromeBadge = style({ fg: colors.canvas, bg: colors.accentStrong, bold: true });
const chromeMeta = style({ fg: colors.muted, bg: colors.header });

export const agentTheme = {
	colors,
	headerLine: headerBg,
	footerLine: footerBg,
	panelBg,
	panelBgActive,
	panelBgRaised,
	text,
	muted,
	dim,
	accent,
	accentStrong,
	warning,
	error,
	success,
	info,
	toolLabel,
	artifactLabel,
	thinkingLabel,
	providerSegment,
	modelSegment,
	thinkingSegment,
	segmentSep,
	statusIdle,
	statusStreaming,
	statusCompacting,
	connectedIndicator,
	disconnectedIndicator,
	bannerAccent,
	bannerInfo,
	bannerSuccess,
	bannerWarning,
	bannerBody,
	bannerDim,
	chromeBadge,
	chromeMeta,
	border: colors.border,
	borderActive: colors.borderActive,
	selectListTheme: {
		selectedPrefix: style({ fg: colors.canvas, bg: colors.accentStrong, bold: true }),
		selectedText: style({ fg: colors.canvas, bg: colors.accentStrong, bold: true }),
		description: muted,
		scrollInfo: dim,
		noMatch: warning,
	} satisfies SelectListTheme,
	markdownTheme: {
		heading: accentStrong,
		link: style({ fg: colors.accent, underline: true }),
		linkUrl: dim,
		code: style({ fg: colors.code }),
		codeBlock: text,
		codeBlockBorder: dim,
		quote: muted,
		quoteBorder: accent,
		hr: dim,
		listBullet: accent,
		bold,
		italic: style({ italic: true, fg: colors.text }),
		strikethrough: text,
		underline: style({ underline: true, fg: colors.text }),
	} satisfies MarkdownTheme,
	defaultMarkdownText: {
		color: text,
	} satisfies DefaultTextStyle,
	line(styleFn: Styler, textValue: string): string {
		return styleFn(textValue);
	},
	/** Format a labeled badge */
	badge(label: string, value: string, labelStyle: Styler = dim, valueStyle: Styler = accent): string {
		return `${labelStyle(label)}${valueStyle(value)}`;
	},
	/** Format a section separator */
	separator(char = "─", width = 40): string {
		return dim(char.repeat(width));
	},
};
