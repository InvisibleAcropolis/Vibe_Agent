import { matchesKey, type Focusable } from "@mariozechner/pi-tui";
import { paintLine } from "../ansi.js";
import { createOverlayPreviewRuntime } from "../style-test-fixtures.js";
import { defineStyleTestDemos } from "../style-test-contract.js";
import { agentTheme } from "../theme.js";
import type { MouseAwareOverlay } from "../types.js";

/**
 * Help overlay: shows keybindings, commands, and usage information.
 * Provides parity with the WebUI's help/keybindings documentation.
 */
export class HelpOverlay implements MouseAwareOverlay, Focusable {
	private _focused = false;
	private scrollOffset = 0;

	constructor(private readonly onClose: () => void) {}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const allLines = this.buildContent(width);
		return allLines.slice(this.scrollOffset);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "esc") || matchesKey(data, "enter")) {
			this.onClose();
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "pageUp")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 3);
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "pageDown")) {
			this.scrollOffset += 3;
			return;
		}
	}

	private buildContent(width: number): string[] {
		const lines: string[] = [];
		const bg = agentTheme.panelBgActive;

		const heading = (text: string) => paintLine(agentTheme.accentStrong(` ${text}`), width, bg);
		const row = (key: string, desc: string) => paintLine(`   ${agentTheme.accent(key.padEnd(24))} ${agentTheme.text(desc)}`, width, bg);
		const blank = () => paintLine("", width, bg);
		const note = (text: string) => paintLine(agentTheme.muted(`   ${text}`), width, bg);
		const top = agentTheme.dim("╭" + "─".repeat(Math.max(0, width - 2)) + "╮");
		const bottom = agentTheme.dim("╰" + "─".repeat(Math.max(0, width - 2)) + "╯");

		lines.push(paintLine(top, width, bg));

		lines.push(heading("Vibe Agent - Help"));
		lines.push(blank());

		lines.push(heading("Setup Hub"));
		lines.push(row("/setup", "Open the full provider, OAuth, and model setup flow"));
		lines.push(row("/provider", "Choose or reconnect a preferred OAuth provider"));
		lines.push(row("/login", "Alias for provider setup; starts OAuth-first onboarding"));
		lines.push(row("/model", "Pick the default model for the active provider"));
		lines.push(row("/logout", "Disconnect a provider and clear invalid saved defaults"));
		lines.push(note("Recommended defaults: Google Antigravity OAuth, then OpenAI Codex OAuth."));
		lines.push(note("Credentials persist in auth.json; app defaults persist in vibe-agent-config.json."));
		lines.push(blank());

		lines.push(heading("Global Keybindings"));
		lines.push(row("Ctrl+Q", "Quit the application"));
		lines.push(row("F1", "Open command palette"));
		lines.push(row("Esc", "Close overlay / abort streaming"));
		lines.push(row("Shift+Ctrl+D", "Write debug snapshot"));
		lines.push(blank());

		lines.push(heading("Editor Keybindings"));
		lines.push(row("Enter", "Submit prompt (send to agent)"));
		lines.push(row("Shift+Enter", "New line in editor"));
		lines.push(row("Ctrl+C / Esc", "Abort streaming / clear"));
		lines.push(row("Ctrl+D", "Quit (when editor empty)"));
		lines.push(row("Ctrl+L", "Open model selector"));
		lines.push(row("Shift+Tab", "Cycle thinking level"));
		lines.push(row("Ctrl+Shift+Up/Down", "Cycle models forward/back"));
		lines.push(row("Ctrl+E", "Toggle tool output expansion"));
		lines.push(row("Ctrl+T", "Toggle thinking visibility"));
		lines.push(row("Up/Down", "Navigate editor history"));
		lines.push(blank());

		lines.push(heading("Slash Commands"));
		lines.push(row("/settings", "Open session settings menu"));
		lines.push(row("/resume", "Resume or switch sessions"));
		lines.push(row("/fork", "Fork from a previous message"));
		lines.push(row("/tree", "Navigate session branch tree"));
		lines.push(row("/model", "Select model"));
		lines.push(row("/provider", "Reconnect or switch provider"));
		lines.push(row("/login", "Start OAuth provider login"));
		lines.push(row("/logout", "Log out from a configured provider"));
		lines.push(row("/thinking", "Select thinking level"));
		lines.push(row("/stats", "Show session statistics"));
		lines.push(row("/artifacts", "View session artifacts"));
		lines.push(row("/compact", "Compact context window"));
		lines.push(row("/clear", "Clear chat display"));
		lines.push(row("/name <name>", "Set session display name"));
		lines.push(row("/export [path]", "Export session as HTML"));
		lines.push(row("/help", "Show this help overlay"));
		lines.push(row("/debug-dump", "Write debug snapshot"));
		lines.push(blank());

		lines.push(heading("Mouse Support"));
		lines.push(note("Click to select items in overlays and lists"));
		lines.push(note("Scroll wheel to navigate lists and artifact previews"));
		lines.push(note("Mouse is supported in all overlay panels"));
		lines.push(blank());

		lines.push(heading("Agent Interaction"));
		lines.push(note("Type a prompt and press Enter to send it to the agent."));
		lines.push(note("The agent can read, write, and edit files, run bash commands,"));
		lines.push(note("search code with grep/find, and use extensions and skills."));
		lines.push(note("During streaming, use Esc to abort or type to steer/follow up."));
		lines.push(note("When setup or recovery is required, use the cockpit banner or /setup to return to onboarding."));
		lines.push(blank());

		lines.push(heading("Artifacts"));
		lines.push(note("Files created/modified by the agent appear as artifacts."));
		lines.push(note("Use /artifacts or the command palette to browse them."));
		lines.push(note("Artifacts show file contents, diffs, and code previews."));
		lines.push(blank());

		lines.push(paintLine(agentTheme.dim("   Esc/Enter close  |  Up/Down scroll"), width, bg));
		lines.push(paintLine(bottom, width, bg));

		return lines;
	}
}

export const styleTestDemos = defineStyleTestDemos({
	exports: {
		HelpOverlay: {
			title: "Help Overlay",
			category: "Overlays",
			kind: "overlay",
			description: "Scrollable keybinding help overlay.",
			createRuntime: (_moduleNamespace, _exportName, _exportValue, context) =>
				createOverlayPreviewRuntime(
					"Scrollable keybinding help overlay.",
					"src/components/help-overlay.ts",
					() =>
						context.showOverlay("styletest-help", new HelpOverlay(() => context.closeOverlay("styletest-help")), {
							width: "80%",
							maxHeight: "70%",
							anchor: "center",
							margin: 1,
						}),
				),
		},
	},
});
