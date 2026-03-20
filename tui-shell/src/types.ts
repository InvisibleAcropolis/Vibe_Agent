import type { Component, OverlayOptions, TUI } from "@mariozechner/pi-tui";
import type { Rect, MouseEvent } from "./mouse.js";
import type { masterTuiTheme } from "./theme.js";

export interface ShellCommand {
	id: string;
	label: string;
	description: string;
	run: () => void;
}

export interface PanelContext {
	tui: TUI;
	theme: typeof masterTuiTheme;
	getBodyHeight: () => number;
	getCommands: () => ShellCommand[];
	openHelp: () => void;
	openCommandPalette: () => void;
	openLauncher: () => void;
	requestRender: () => void;
	setStatus: (text: string) => void;
}

export interface PanelInstance {
	id: string;
	title: string;
	description: string;
	component: Component;
	getCommands?: () => ShellCommand[];
	handleMouse?: (event: MouseEvent, rect: Rect) => boolean;
	dispose?: () => void;
}

export interface PanelDefinition {
	id: string;
	title: string;
	description: string;
	create: (context: PanelContext) => PanelInstance;
}

export interface MouseAwareOverlay extends Component {
	handleMouse?: (event: MouseEvent, rect: Rect) => boolean;
}

export interface OverlayRecord {
	id: string;
	component: MouseAwareOverlay;
	options: OverlayOptions;
	hide: () => void;
}
