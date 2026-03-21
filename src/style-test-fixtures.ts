import type { Component } from "@mariozechner/pi-tui";
import type { AgentHostState } from "./agent-host.js";
import type { ShellMenuDefinition } from "./components/shell-menu-overlay.js";
import type { SessionInfo, SessionStats } from "./local-coding-agent.js";
import { agentTheme } from "./theme.js";
import type { Artifact } from "./types.js";
import type { StyleTestRuntime } from "./style-test-contract.js";

export class StaticTextComponent implements Component {
	constructor(private readonly lines: string[]) {}

	invalidate(): void {}

	render(): string[] {
		return this.lines;
	}
}

export function createTextRuntime(lines: string[]): StyleTestRuntime {
	return {
		render() {
			return lines;
		},
	};
}

export function createComponentRuntime(component: Component): StyleTestRuntime {
	return {
		component,
		render(width: number) {
			return component.render(width);
		},
		handleInput(data: string) {
			(component as { handleInput?: (input: string) => void }).handleInput?.(data);
		},
	};
}

export function createOverlayPreviewRuntime(
	description: string,
	sourceFile: string,
	openOverlay: () => void,
): StyleTestRuntime {
	return {
		render(_width: number, height: number) {
			return [
				agentTheme.accentStrong("Overlay Preview"),
				"",
				agentTheme.text(description),
				"",
				agentTheme.dim("Use the inspector action row to open the live overlay."),
				agentTheme.dim("Press Esc to close overlays once opened."),
				"",
				agentTheme.dim(`Source: ${sourceFile}`),
				...Array.from({ length: Math.max(0, height - 8) }, () => ""),
			];
		},
		openOverlay,
	};
}

export function createPlaceholderRuntime(title: string, description: string, sourceFile: string): StyleTestRuntime {
	return {
		render(_width: number, height: number) {
			return [
				agentTheme.warning(title),
				"",
				agentTheme.text(description),
				"",
				agentTheme.dim(`Source: ${sourceFile}`),
				...Array.from({ length: Math.max(0, height - 5) }, () => ""),
			];
		},
	};
}

export function sampleArtifacts(): Artifact[] {
	return [
		{
			id: "artifact-code",
			type: "code",
			title: "shell-view.ts",
			filePath: "src/shell-view.ts",
			language: "typescript",
			content: [
				"export class DefaultShellView {",
				"\trefresh(): void {",
				"\t\tthis.refreshChrome();",
				"\t\tthis.tui.requestRender();",
				"\t}",
				"}",
			].join("\n"),
		},
		{
			id: "artifact-diff",
			type: "diff",
			title: "styleguide.md",
			filePath: "styleguide.md",
			content: [
				"@@ -1,3 +1,7 @@",
				"+ ## Animation Presets",
				"+ - Plasma",
				"+ - Matrix Rain",
				"  ## Design Principles",
			].join("\n"),
		},
	];
}

export function sampleHostState(): AgentHostState {
	return {
		model: {
			provider: "openai",
			id: "gpt-5.4-mini",
			name: "GPT-5.4 Mini",
			api: "openai-responses",
			baseUrl: "https://api.openai.com/v1",
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			maxTokens: 16384,
			contextWindow: 200000,
			reasoning: true,
		} as unknown as AgentHostState["model"],
		thinkingLevel: "high",
		isStreaming: false,
		isCompacting: false,
		steeringMode: "all",
		followUpMode: "all",
		sessionId: "style-lab-session",
		sessionName: "style-lab",
		autoCompactionEnabled: true,
		pendingMessageCount: 0,
		messageCount: 42,
	};
}

export function sampleStats(): SessionStats {
	return {
		sessionFile: "sessions/style-lab.json",
		sessionId: "style-lab-session",
		userMessages: 12,
		assistantMessages: 19,
		toolCalls: 8,
		toolResults: 8,
		totalMessages: 39,
		tokens: {
			input: 18500,
			output: 7800,
			cacheRead: 1200,
			cacheWrite: 700,
			total: 28200,
		},
		cost: 0.0274,
	};
}

export function sampleSessions(): SessionInfo[] {
	const now = Date.now();
	return [
		{ path: "sessions/current.json", name: "Current Session", created: new Date(now - 20 * 60 * 1000) } as SessionInfo,
		{ path: "sessions/theme-lab.json", name: "Theme Tweaks", created: new Date(now - 2 * 60 * 60 * 1000) } as SessionInfo,
		{ path: "sessions/overlay-pass.json", name: "Overlay Pass", created: new Date(now - 28 * 60 * 60 * 1000) } as SessionInfo,
		{ path: "sessions/animation-fire.json", name: "Doom Fire Notes", created: new Date(now - 4 * 24 * 60 * 60 * 1000) } as SessionInfo,
	] as SessionInfo[];
}

export function sampleShellMenuDefinition(): ShellMenuDefinition {
	return {
		title: "Style Lab Menu",
		subtitle: "Curated demo actions",
		anchor: { row: 2, col: 4 },
		width: 34,
		childWidth: 30,
		items: [
			{
				kind: "action",
				id: "cycle-theme",
				label: "Cycle Theme",
				description: "Swap the active demo palette",
				onSelect: () => undefined,
			},
			{
				kind: "submenu",
				id: "animations",
				label: "Animation Presets",
				description: "Jump to animated demos",
				items: [
					{
						kind: "action",
						id: "plasma",
						label: "Plasma",
						onSelect: () => undefined,
					},
					{
						kind: "action",
						id: "matrix-rain",
						label: "Matrix Rain",
						onSelect: () => undefined,
					},
				],
			},
		],
	};
}
