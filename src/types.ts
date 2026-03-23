import type { Component, EditorComponent, OverlayHandle, OverlayOptions, TUI, Terminal } from "@mariozechner/pi-tui";

export interface HostedViewportDimensions {
	width: number;
	height: number;
}

export interface HostedSizeRequirements {
	minWidth?: number;
	minHeight?: number;
	preferredWidth?: number;
	preferredHeight?: number;
	maxWidth?: number;
	maxHeight?: number;
}

export interface HostedLayoutCapable extends Component {
	getHostedSizeRequirements?(viewport: HostedViewportDimensions): HostedSizeRequirements;
	setHostedViewportSize?(viewport: HostedViewportDimensions): void;
}
import type { PiMonoAppDebugger } from "./app-debugger.js";
import type { FloatWindow, FloatWindowModel } from "./components/float_window.js";
import type { ArtifactCatalogService } from "./durable/artifacts/artifact-catalog-service.js";
import type { LogCatalogService } from "./durable/logs/log-catalog-service.js";
import type { MemoryStoreService } from "./durable/memory/memory-store-service.js";
import type { WorkbenchInventoryService } from "./durable/workbench-inventory-service.js";
import type { MouseEvent, Rect } from "./mouse.js";
import type { AgentRuntime } from "./runtime/agent-runtime.js";
import type { RuntimeCoordinator } from "./runtime/runtime-coordinator.js";
import type { RuntimeDescriptor } from "./runtime/agent-runtime.js";
import type { agentTheme } from "./theme.js";

export interface OverlayRecord {
	id: string;
	component: Component;
	options: OverlayOptions;
	handle: OverlayHandle;
	window?: FloatWindow;
	mousePolicy?: OverlayMousePolicy;
	onHide?: () => void;
	onFloatingWindowStateChange?: (model: FloatWindowModel) => void;
	hide: () => void;
}

export interface MouseAwareOverlay extends HostedLayoutCapable {
	handleMouse?: (event: MouseEvent, rect: Rect) => boolean;
}

export type OverlayOutsideClickPolicy = "noop" | "clear-focus" | "close";

export interface OverlayMousePolicy {
	clickThrough?: boolean;
	outsideClick?: OverlayOutsideClickPolicy;
	activateOnLeftClick?: boolean;
}

export type AppEditorComponent = EditorComponent & Component;

export interface VibeAgentAppOptions {
	terminal?: Terminal;
	host?: import("./agent-host.js").AgentHost;
	debugger?: PiMonoAppDebugger;
	configPath?: string;  // Optional override for config file path (used in tests)
	durableRootPath?: string;
	authStorage?: import("./local-coding-agent.js").AuthStorage;
	getEnvApiKey?: (providerId: string) => string | undefined;
	runtimes?: AgentRuntime[];
	runtimeCoordinator?: RuntimeCoordinator;
	artifactCatalog?: ArtifactCatalogService;
	memoryStoreService?: MemoryStoreService;
	logCatalogService?: LogCatalogService;
	inventoryService?: WorkbenchInventoryService;
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

export interface RuntimeDisplayState {
	activeRuntimeId: RuntimeDescriptor["id"];
	activeRuntimeName: RuntimeDescriptor["displayName"];
	activeConversationLabel: string;
}
