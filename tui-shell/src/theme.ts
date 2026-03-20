import type { DefaultTextStyle, ImageTheme, MarkdownTheme, SelectListTheme, SettingsListTheme } from "@mariozechner/pi-tui";
import { composeStylers, style, type Styler } from "./ansi.js";

const colors = {
	canvas: "#08131f",
	header: "#0d1d2e",
	footer: "#0a1826",
	surface: "#0f1f30",
	surfaceMuted: "#10263a",
	surfaceActive: "#15314a",
	text: "#e6f0f7",
	muted: "#9bb2c4",
	dim: "#6d879d",
	accent: "#45d7ff",
	accentStrong: "#12b4e0",
	success: "#53d86a",
	warning: "#f8c15c",
	error: "#ff7a6e",
	code: "#9ee1ff",
	quote: "#90d7c8",
	link: "#76d1ff",
};

const bold = style({ bold: true });
const text = style({ fg: colors.text });
const muted = style({ fg: colors.muted });
const dim = style({ fg: colors.dim });
const accent = style({ fg: colors.accent });
const accentStrong = style({ fg: colors.accentStrong, bold: true });
const warning = style({ fg: colors.warning, bold: true });
const headerBg = style({ bg: colors.header, fg: colors.text });
const footerBg = style({ bg: colors.footer, fg: colors.muted });
const panelBg = style({ bg: colors.surface });
const panelBgActive = style({ bg: colors.surfaceActive });
const sectionBg = style({ bg: colors.surfaceMuted });
const selectedBg = style({ bg: colors.accentStrong, fg: colors.canvas, bold: true });
const selectedValue = style({ fg: colors.accent, bold: true });
const link = composeStylers(style({ fg: colors.link, underline: true }));
const code = style({ fg: colors.code });
const quote = style({ fg: colors.quote, italic: true });

export const masterTuiTheme = {
	colors,
	headerLine: headerBg,
	footerLine: footerBg,
	panelBg,
	panelBgActive,
	sectionBg,
	text,
	muted,
	dim,
	accent,
	accentStrong,
	warning,
	sectionTitle(title: string, focused: boolean): string {
		const label = focused ? "●" : "○";
		return `${focused ? accentStrong(label) : dim(label)} ${focused ? bold(title) : text(title)}`;
	},
	selectListTheme: {
		selectedPrefix: selectedBg,
		selectedText: selectedBg,
		description: muted,
		scrollInfo: dim,
		noMatch: warning,
	} satisfies SelectListTheme,
	settingsListTheme: {
		label: (value, selected) => (selected ? accentStrong(value) : text(value)),
		value: (value, selected) => (selected ? selectedValue(value) : muted(value)),
		description: muted,
		cursor: accentStrong("→ "),
		hint: dim,
	} satisfies SettingsListTheme,
	markdownTheme: {
		heading: accentStrong,
		link,
		linkUrl: dim,
		code,
		codeBlock: text,
		codeBlockBorder: dim,
		quote,
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
	imageTheme: {
		fallbackColor: warning,
	} satisfies ImageTheme,
	line(styleFn: Styler, textValue: string): string {
		return styleFn(textValue);
	},
};
