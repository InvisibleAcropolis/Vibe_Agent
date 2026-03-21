import { matchesKey, type Focusable } from "@mariozechner/pi-tui";
import { basename } from "path";
import { paintLine, style } from "../ansi.js";
import { createComponentRuntime, sampleSessions } from "../style-test-fixtures.js";
import { defineStyleTestDemos } from "../style-test-contract.js";
import { agentTheme } from "../theme.js";
import type { SessionInfo } from "../local-coding-agent.js";

type Tab = "sessions" | "extensions";

interface SessionNode {
	session: SessionInfo;
	expanded: boolean;
	threads?: string[];
}

interface DateGroup {
	label: string;
	nodes: SessionNode[];
	collapsed: boolean;
}

export interface SessionsPanelOptions {
	getSessions: () => Promise<SessionInfo[]>;
	getCurrentSessionFile: () => string | undefined;
	onSwitch: (sessionPath: string) => Promise<void>;
	onClose: () => void;
}

/** Get the path for a session, supporting both real SessionInfo (.path) and mock shapes (.sessionFile) */
function getSessionPath(s: SessionInfo): string {
	return (s as any).path ?? (s as any).sessionFile ?? "";
}

/** Get the display name for a session, supporting both real SessionInfo (.name) and mock shapes (.sessionName) */
function getSessionName(s: SessionInfo): string | undefined {
	return (s as any).name ?? (s as any).sessionName ?? undefined;
}

/** Get the creation timestamp in ms, supporting both real SessionInfo (.created Date) and mock shapes (.timestamp number) */
function getSessionTimestamp(s: SessionInfo): number {
	const created = (s as any).created;
	if (created instanceof Date) return created.getTime();
	if (typeof created === "number") return created;
	return (s as any).timestamp ?? 0;
}

function groupByDate(sessions: SessionInfo[]): DateGroup[] {
	const now = Date.now();
	const DAY = 86400000;
	const WEEK = 7 * DAY;
	const groups: Record<string, SessionInfo[]> = {
		Today: [],
		Yesterday: [],
		"Last Week": [],
		Older: [],
	};
	for (const s of sessions) {
		const age = now - getSessionTimestamp(s);
		if (age < DAY) groups["Today"]!.push(s);
		else if (age < 2 * DAY) groups["Yesterday"]!.push(s);
		else if (age < WEEK) groups["Last Week"]!.push(s);
		else groups["Older"]!.push(s);
	}
	return Object.entries(groups)
		.filter(([, items]) => items.length > 0)
		.map(([label, items]) => ({
			label,
			nodes: items.map((s) => ({ session: s, expanded: false })),
			collapsed: false,
		}));
}

export class SessionsPanel implements Focusable {
	private _focused = false;
	private tab: Tab = "sessions";
	private groups: DateGroup[] = [];
	private cursor = 0;
	private flatItems: Array<
		{ type: "group"; groupIdx: number } | { type: "session"; groupIdx: number; nodeIdx: number }
	> = [];
	public borderColor: string = agentTheme.border;

	constructor(private readonly options: SessionsPanelOptions) {
		void this.refresh().catch(() => {});
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(v: boolean) {
		this._focused = v;
	}

	invalidate(): void {}

	async refresh(): Promise<void> {
		const sessions = await this.options.getSessions();
		this.groups = groupByDate(sessions);
		this.rebuildFlatItems();
	}

	private rebuildFlatItems(): void {
		this.flatItems = [];
		for (let gi = 0; gi < this.groups.length; gi++) {
			const g = this.groups[gi]!;
			this.flatItems.push({ type: "group", groupIdx: gi });
			if (!g.collapsed) {
				for (let ni = 0; ni < g.nodes.length; ni++) {
					this.flatItems.push({ type: "session", groupIdx: gi, nodeIdx: ni });
				}
			}
		}
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const bc = style({ fg: this.borderColor });

		// Tab bar / header
		const sTab =
			this.tab === "sessions" ? agentTheme.accentStrong("[S]") : agentTheme.dim("[S]");
		const eTab =
			this.tab === "extensions" ? agentTheme.accentStrong("[E]") : agentTheme.dim("[E]");
		lines.push(
			paintLine(
				bc("┌─ ") +
					agentTheme.accent("SESSIONS") +
					bc(" ─") +
					sTab +
					bc(" ") +
					eTab +
					bc(" ─┐"),
				width,
			),
		);

		if (this.tab === "extensions") {
			lines.push(paintLine(agentTheme.muted("  Extensions coming soon"), width));
			lines.push(
				paintLine(
					bc("└" + "─".repeat(Math.max(0, width - 2)) + "┘"),
					width,
				),
			);
			return lines;
		}

		// Sessions tree
		for (let i = 0; i < this.flatItems.length; i++) {
			const item = this.flatItems[i]!;
			const isCursor = i === this.cursor && this._focused;

			if (item.type === "group") {
				const g = this.groups[item.groupIdx]!;
				const arrow = g.collapsed ? "▶" : "▼";
				const text = `${agentTheme.dim(arrow)} ${agentTheme.muted(g.label)}`;
				const row = "│ " + text;
				lines.push(
					isCursor ? paintLine(agentTheme.accentStrong(row), width) : paintLine(row, width),
				);
			} else if (item.type === "session") {
				const g = this.groups[item.groupIdx]!;
				const node = g.nodes[item.nodeIdx]!;
				const sessionPath = getSessionPath(node.session);
				const isCurrent = sessionPath === this.options.getCurrentSessionFile();
				const rawName = getSessionName(node.session);
				const name = rawName ?? basename(sessionPath) ?? "session";
				const nameStyled = isCurrent ? agentTheme.accentStrong(name) : agentTheme.text(name);
				const expandArrow = node.threads !== undefined ? (node.expanded ? "▼" : "▶") : " ";
				const prefix = isCurrent ? agentTheme.accent("●") : agentTheme.dim("○");
				const row = `│   ${prefix} ${agentTheme.dim(expandArrow)} ${nameStyled}`;
				lines.push(
					isCursor ? paintLine(agentTheme.accentStrong(row), width) : paintLine(row, width),
				);
				// Show threads when expanded
				if (node.expanded && node.threads) {
					for (let ti = 0; ti < node.threads.length; ti++) {
						const thread = node.threads[ti]!;
						const connector = ti === node.threads.length - 1 ? "└─" : "├─";
						lines.push(
							paintLine(
								`│       ${agentTheme.dim(connector)} ${agentTheme.success(thread)}`,
								width,
							),
						);
					}
				}
			}
		}

		lines.push(
			paintLine(
				bc("└" + "─".repeat(Math.max(0, width - 2)) + "┘"),
				width,
			),
		);
		return lines;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.options.onClose();
			return;
		}
		if (matchesKey(data, "tab") || data === "\x05") {
			this.tab = this.tab === "sessions" ? "extensions" : "sessions";
			return;
		}
		if (matchesKey(data, "up")) {
			this.cursor = Math.max(0, this.cursor - 1);
			return;
		}
		if (matchesKey(data, "down")) {
			if (this.flatItems.length > 0) {
				this.cursor = Math.min(this.flatItems.length - 1, this.cursor + 1);
			}
			return;
		}
		if (matchesKey(data, "right") || matchesKey(data, "left")) {
			const item = this.flatItems[this.cursor];
			if (item?.type === "group") {
				this.groups[item.groupIdx]!.collapsed = matchesKey(data, "left");
				this.rebuildFlatItems();
			} else if (item?.type === "session") {
				const node = this.groups[item.groupIdx]!.nodes[item.nodeIdx]!;
				if (matchesKey(data, "right")) {
					node.expanded = true;
					if (!node.threads) {
						node.threads = ["main"];
					}
				} else {
					node.expanded = false;
				}
			}
			return;
		}
		if (matchesKey(data, "enter")) {
			const item = this.flatItems[this.cursor];
			if (item?.type === "session") {
				const sf = getSessionPath(this.groups[item.groupIdx]!.nodes[item.nodeIdx]!.session);
				this.options.onSwitch(sf).then(() => this.options.onClose()).catch((err: unknown) => {
					console.error("[SessionsPanel] session switch failed:", err);
				});
			}
			return;
		}
	}
}

export const styleTestDemos = defineStyleTestDemos({
	exports: {
		SessionsPanel: {
			title: "Sessions Panel",
			category: "Components",
			kind: "component",
			description: "Fixture-backed panel using the production sessions component.",
			createRuntime: () =>
				createComponentRuntime(
					new SessionsPanel({
						getSessions: async () => sampleSessions(),
						getCurrentSessionFile: () => "sessions/current.json",
						onSwitch: async () => undefined,
						onClose: () => undefined,
					}),
				),
		},
	},
});
