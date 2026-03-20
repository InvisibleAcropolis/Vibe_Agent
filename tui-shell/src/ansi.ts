import { visibleWidth } from "@mariozechner/pi-tui";

export type Styler = (text: string) => string;

type StyleOptions = {
	fg?: string;
	bg?: string;
	bold?: boolean;
	dim?: boolean;
	underline?: boolean;
	italic?: boolean;
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

export function composeStylers(...stylers: Array<Styler | undefined>): Styler {
	const valid = stylers.filter((styler): styler is Styler => !!styler);
	if (valid.length === 0) {
		return (text) => text;
	}
	return (text) => valid.reduce((current, styler) => styler(current), text);
}

export function padLine(text: string, width: number): string {
	return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

export function paintLine(text: string, width: number, lineStyle?: Styler): string {
	const padded = padLine(text, width);
	return lineStyle ? lineStyle(padded) : padded;
}
