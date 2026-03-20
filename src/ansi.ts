import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export type Styler = (text: string) => string;

type StyleOptions = {
	fg?: string;
	bg?: string;
	bold?: boolean;
	dim?: boolean;
	underline?: boolean;
	italic?: boolean;
	strikethrough?: boolean;
};

function hexToRgb(color: string): [number, number, number] {
	const normalized = color.replace("#", "");
	if (normalized.length !== 6) {
		throw new Error(`Invalid hex color: ${color}`);
	}
	const r = Number.parseInt(normalized.slice(0, 2), 16);
	const g = Number.parseInt(normalized.slice(2, 4), 16);
	const b = Number.parseInt(normalized.slice(4, 6), 16);
	if ([r, g, b].some((value) => Number.isNaN(value))) {
		throw new Error(`Invalid hex color: ${color}`);
	}
	return [r, g, b];
}

export function style(options: StyleOptions): Styler {
	const open: string[] = [];

	if (options.bold) open.push("\x1b[1m");
	if (options.dim) open.push("\x1b[2m");
	if (options.italic) open.push("\x1b[3m");
	if (options.underline) open.push("\x1b[4m");
	if (options.strikethrough) open.push("\x1b[9m");
	if (options.fg) {
		const [r, g, b] = hexToRgb(options.fg);
		open.push(`\x1b[38;2;${r};${g};${b}m`);
	}
	if (options.bg) {
		const [r, g, b] = hexToRgb(options.bg);
		open.push(`\x1b[48;2;${r};${g};${b}m`);
	}

	if (open.length === 0) {
		return (text) => text;
	}

	return (text) => `${open.join("")}${text}\x1b[0m`;
}

export function composeStylers(...stylers: Styler[]): Styler {
	return (text) => stylers.reduce((acc, styler) => styler(acc), text);
}

export function padLine(text: string, width: number): string {
	return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

export function paintLine(text: string, width: number, lineStyle?: Styler): string {
	const padded = padLine(truncateToWidth(text, width, ""), width);
	return lineStyle ? lineStyle(padded) : padded;
}

/**
 * Paint a full-width line with left-aligned and right-aligned content.
 * Truncates left if needed to ensure right fits, then pads the middle.
 */
export function paintLineTwoParts(left: string, right: string, width: number, lineStyle?: Styler): string {
	const truncatedRight = truncateToWidth(right, width, "");
	const rightVisible = visibleWidth(truncatedRight);
	const leftMax = Math.max(0, width - rightVisible - 1);
	const truncatedLeft = truncateToWidth(left, leftMax, "");
	const leftVisible = visibleWidth(truncatedLeft);
	// gap minimum of 1 to keep left/right separated, clamped to 0 if right fills the width
	const gap = Math.max(leftMax > 0 ? 1 : 0, width - leftVisible - rightVisible);
	const line = truncatedLeft + " ".repeat(gap) + truncatedRight;
	return lineStyle ? lineStyle(line) : line;
}

/**
 * Same as paintLineTwoParts but fills the gap with fillChar instead of spaces.
 * Useful for box-drawing rows where the gap fill is '═'.
 * fillStyler is applied to the fill characters as a single styled block.
 */
export function paintBoxLineTwoParts(
	left: string,
	right: string,
	width: number,
	fillChar: string,
	fillStyler?: Styler,
	lineStyler?: Styler,
): string {
	const rightVisible = visibleWidth(right);
	const leftMax = Math.max(0, width - rightVisible);
	const truncatedLeft = truncateToWidth(left, leftMax, "");
	const leftVisible = visibleWidth(truncatedLeft);
	const fillCount = Math.max(0, width - leftVisible - rightVisible);
	const rawFill = fillChar.repeat(fillCount);
	const styledFill = fillStyler ? fillStyler(rawFill) : rawFill;
	const line = truncatedLeft + styledFill + right;
	return lineStyler ? lineStyler(line) : line;
}

/**
 * Inner box top border: [margin]┌─ TITLE ─────────────────────────────────┐
 * Visible width = width. borderStyler applied to the border chars only.
 */
export function innerBoxTop(
	title: string,
	width: number,
	borderStyler?: Styler,
	titleStyler?: Styler,
	margin = 2,
): string {
	const styledTitle = titleStyler ? titleStyler(title) : title;
	const titleW = visibleWidth(styledTitle);
	// " ".repeat(margin) + "┌─ " + title + " " + "─"*fill + "┐" = width
	// margin + 3 + titleW + 1 + fill + 1 = width  →  fill = width - margin - 5 - titleW
	const fillCount = Math.max(0, width - margin - 5 - titleW);
	const lb = borderStyler ? borderStyler("┌─ ") : "┌─ ";
	const rb = borderStyler ? borderStyler(" " + "─".repeat(fillCount) + "┐") : " " + "─".repeat(fillCount) + "┐";
	return " ".repeat(margin) + lb + styledTitle + rb;
}

/**
 * Inner box separator: [margin]├─ TITLE ─────────────────────────────────┤
 */
export function innerBoxSep(
	title: string,
	width: number,
	borderStyler?: Styler,
	titleStyler?: Styler,
	margin = 2,
): string {
	const styledTitle = titleStyler ? titleStyler(title) : title;
	const titleW = visibleWidth(styledTitle);
	const fillCount = Math.max(0, width - margin - 5 - titleW);
	const lb = borderStyler ? borderStyler("├─ ") : "├─ ";
	const rb = borderStyler ? borderStyler(" " + "─".repeat(fillCount) + "┤") : " " + "─".repeat(fillCount) + "┤";
	return " ".repeat(margin) + lb + styledTitle + rb;
}

/**
 * Inner box bottom: [margin]└────────────────────────────────────────────┘
 */
export function innerBoxBottom(width: number, borderStyler?: Styler, margin = 2): string {
	// margin + "└" + "─"*fill + "┘" = width  →  fill = width - margin - 2
	const fillCount = Math.max(0, width - margin - 2);
	const line = "└" + "─".repeat(fillCount) + "┘";
	return " ".repeat(margin) + (borderStyler ? borderStyler(line) : line);
}

/**
 * Inner box content line: [margin]│ [content padded to fill] │
 * Content is ANSI-safe — truncated by visible width.
 */
export function innerBoxLine(content: string, width: number, borderStyler?: Styler, margin = 2): string {
	// margin + "│ " + content + padding + " │" = width
	// innerW = width - margin - 4
	const innerW = Math.max(0, width - margin - 4);
	const truncated = truncateToWidth(content, innerW, "…");
	const contentW = visibleWidth(truncated);
	const padding = " ".repeat(Math.max(0, innerW - contentW));
	const lb = borderStyler ? borderStyler("│") : "│";
	const rb = borderStyler ? borderStyler("│") : "│";
	return " ".repeat(margin) + lb + " " + truncated + padding + " " + rb;
}

export function horizontalRule(width: number, char = "─", styler?: Styler): string {
	const line = char.repeat(width);
	return styler ? styler(line) : line;
}

export function boxLine(text: string, width: number, styler?: Styler): string {
	const inner = truncateToWidth(text, width - 4, "…");
	const padded = inner + " ".repeat(Math.max(0, width - 4 - visibleWidth(inner)));
	const line = `│ ${padded} │`;
	return styler ? styler(line) : line;
}

/** Convert HSL (h:0-360, s:0-1, l:0-1) to "#rrggbb" */
export function hslToHex(h: number, s: number, l: number): string {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	let r = 0;
	let g = 0;
	let b = 0;
	if (h < 60) { r = c; g = x; b = 0; }
	else if (h < 120) { r = x; g = c; b = 0; }
	else if (h < 180) { r = 0; g = c; b = x; }
	else if (h < 240) { r = 0; g = x; b = c; }
	else if (h < 300) { r = x; g = 0; b = c; }
	else { r = c; g = 0; b = x; }
	const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Convert "#rrggbb" to [h, s, l] */
export function hexToHsl(hex: string): [number, number, number] {
	const [rr, gg, bb] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
	const max = Math.max(rr, gg, bb);
	const min = Math.min(rr, gg, bb);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = d / (1 - Math.abs(2 * l - 1));
	let hh: number;
	if (max === rr) hh = (((gg - bb) / d) % 6 + 6) % 6;
	else if (max === gg) hh = (bb - rr) / d + 2;
	else hh = (rr - gg) / d + 4;
	return [hh * 60, s, l];
}

const GLITCH_CHARS = "▓▒░█▄▀◆■▪●◉";

/** Corrupt `count` visible characters (ANSI-safe) with block chars */
export function glitchLine(text: string, count: number): string {
	// Collect positions of visible characters (skip ANSI escape sequences)
	const positions: number[] = [];
	let inEscape = false;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\x1b") {
			inEscape = true;
		} else if (inEscape) {
			if (text[i] === "m") inEscape = false;
		} else {
			positions.push(i);
		}
	}
	const n = positions.length;
	const actualCount = Math.min(count, n);
	// Fisher-Yates partial shuffle to pick `actualCount` positions
	for (let i = 0; i < actualCount; i++) {
		const j = i + Math.floor(Math.random() * (n - i));
		const tmp = positions[i];
		positions[i] = positions[j]!;
		positions[j] = tmp!;
	}
	const chars = text.split("");
	for (let i = 0; i < actualCount; i++) {
		const pos = positions[i]!;
		chars[pos] = GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]!;
	}
	return chars.join("");
}
