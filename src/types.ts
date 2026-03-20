import type { Component, EditorComponent, OverlayOptions, TUI, Terminal } from "@mariozechner/pi-tui";
import type { PiMonoAppDebugger } from "./app-debugger.js";
import type { MouseEvent, Rect } from "./mouse.js";
import type { agentTheme } from "./theme.js";

export interface OverlayRecord {
	id: string;
	component: Component;
	options: OverlayOptions;
	hide: () => void;
}

export interface MouseAwareOverlay extends Component {
	handleMouse?: (event: MouseEvent, rect: Rect) => boolean;
}

export type AppEditorComponent = EditorComponent & Component;

export interface FutureIdeAgentAppOptions {
	terminal?: Terminal;
	host?: import("./agent-host.js").AgentHost;
	debugger?: PiMonoAppDebugger;
	configPath?: string;  // Optional override for config file path (used in tests)
	authStorage?: import("./local-coding-agent.js").AuthStorage;
	getEnvApiKey?: (providerId: string) => string | undefined;
}

export interface AppContext {
	tui: TUI;
	theme: typeof agentTheme;
}

export type ArtifactType = "file" | "code" | "diff" | "image" | "html" | "text";

export interface Artifact {
	id: string;
	type: ArtifactType;
	title: string;
	content: string;
	language?: string;
	filePath?: string;
}
