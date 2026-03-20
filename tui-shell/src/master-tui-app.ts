import { ProcessTerminal, TUI, matchesKey, type OverlayOptions, type Terminal } from "@mariozechner/pi-tui";
import { CommandPaletteOverlay } from "./components/command-palette-overlay.js";
import { HelpOverlay } from "./components/help-overlay.js";
import { LauncherOverlay } from "./components/launcher-overlay.js";
import { ShellFrame } from "./components/shell-frame.js";
import { MouseEnabledTerminal } from "./mouse-enabled-terminal.js";
import type { MouseEvent, Rect } from "./mouse.js";
import { parseMouseEvent, pointInRect } from "./mouse.js";
import { resolveOverlayRect } from "./overlay-layout.js";
import { PanelManager } from "./panel-manager.js";
import { createWorkspacePanel } from "./panels/workspace-panel.js";
import { masterTuiTheme } from "./theme.js";
import type { OverlayRecord, PanelContext, ShellCommand } from "./types.js";

const HEADER_HEIGHT = 2;
const FOOTER_HEIGHT = 2;

type MasterTuiAppOptions = {
	terminal?: Terminal;
};

export class MasterTuiApp {
	readonly tui: TUI;
	readonly panelManager: PanelManager;
	private readonly shellFrame: ShellFrame;
	private readonly overlays: OverlayRecord[] = [];
	private readonly context: PanelContext;
	private running = false;
	private status = "FutureIDE MasterTUI ready";

	constructor(options: MasterTuiAppOptions = {}) {
		const terminal = new MouseEnabledTerminal(options.terminal ?? new ProcessTerminal());
		this.tui = new TUI(terminal, true);
		this.context = {
			tui: this.tui,
			theme: masterTuiTheme,
			getBodyHeight: () => this.getBodyHeight(),
			getCommands: () => this.getCommands(),
			openHelp: () => this.openHelpOverlay(),
			openCommandPalette: () => this.openCommandPalette(),
			openLauncher: () => this.openLauncherOverlay(),
			requestRender: () => this.tui.requestRender(),
			setStatus: (text) => this.setStatus(text),
		};
		this.panelManager = new PanelManager(this.context);
		this.panelManager.register(createWorkspacePanel(this.context));
		this.panelManager.activate("workspace");
		this.shellFrame = new ShellFrame(() => this.panelManager.getActive(), () => this.getBodyHeight(), () => this.status);
		this.tui.addChild(this.shellFrame);
		this.tui.setFocus(this.panelManager.getActive().component);
		this.tui.addInputListener((data) => this.handleGlobalInput(data));
	}

	start(): void {
		if (this.running) {
			return;
		}
		this.running = true;
		this.tui.start();
		this.setStatus("FutureIDE MasterTUI booted");
	}

	stop(): void {
		if (!this.running) {
			return;
		}
		this.running = false;
		while (this.overlays.length > 0) {
			this.overlays.pop()?.hide();
		}
		this.panelManager.dispose();
		this.tui.stop();
	}

	isRunning(): boolean {
		return this.running;
	}

	getBodyHeight(): number {
		return Math.max(1, this.tui.terminal.rows - HEADER_HEIGHT - FOOTER_HEIGHT);
	}

	getStatus(): string {
		return this.status;
	}

	getActivePanelId(): string | null {
		return this.panelManager.getActiveId();
	}

	getOverlayIds(): string[] {
		return this.overlays.map((overlay) => overlay.id);
	}

	getOverlayRect(id: string): Rect | null {
		const overlay = this.overlays.find((entry) => entry.id === id);
		if (!overlay) {
			return null;
		}
		return resolveOverlayRect(overlay.component, overlay.options, this.tui.terminal.columns, this.tui.terminal.rows);
	}

	openCommandPalette(): void {
		this.showOverlay(
			"command-palette",
			new CommandPaletteOverlay(this.getCommands(), () => this.closeOverlay("command-palette")),
			{
				width: 74,
				maxHeight: 18,
				anchor: "top-center",
				margin: { top: 2, left: 4, right: 4 },
			},
		);
		this.setStatus("Command palette opened");
	}

	openHelpOverlay(): void {
		this.showOverlay("help", new HelpOverlay(() => this.closeOverlay("help")), {
			width: "70%",
			maxHeight: "70%",
			anchor: "center",
			margin: 1,
		});
		this.setStatus("Help overlay opened");
	}

	openLauncherOverlay(): void {
		const items = [
			{
				id: "workspace",
				label: "Workspace",
				description: "The only active panel in v1. Keeps the shared shell alive while future slots remain reserved.",
				run: () => {
					this.panelManager.activate("workspace");
					this.tui.setFocus(this.panelManager.getActive().component);
					this.setStatus("Workspace panel activated");
				},
			},
			{
				id: "slot-sub-agents",
				label: "Reserved: Sub-agent panels",
				description: "Placeholder slot. The panel manager is ready, but the runtime host lands later.",
				run: () => this.setStatus("Reserved slot: sub-agent panels are planned for a later phase"),
			},
			{
				id: "slot-files",
				label: "Reserved: File browser",
				description: "Placeholder slot for repo browsing and file preview surfaces.",
				run: () => this.setStatus("Reserved slot: file browser panel is planned for a later phase"),
			},
		];
		this.showOverlay("launcher", new LauncherOverlay(items, () => this.closeOverlay("launcher")), {
			width: 80,
			maxHeight: 14,
			anchor: "top-center",
			margin: { top: 3, left: 4, right: 4 },
		});
		this.setStatus("Launcher opened");
	}

	private handleGlobalInput(data: string): { consume?: boolean; data?: string } | undefined {
		const mouseEvent = parseMouseEvent(data);
		if (mouseEvent) {
			this.dispatchMouse(mouseEvent);
			this.tui.requestRender();
			return { consume: true };
		}

		if (matchesKey(data, "ctrl+q")) {
			this.stop();
			return { consume: true };
		}
		if (matchesKey(data, "ctrl+p")) {
			this.openCommandPalette();
			return { consume: true };
		}
		if (matchesKey(data, "f1")) {
			this.openHelpOverlay();
			return { consume: true };
		}
		if (matchesKey(data, "ctrl+l")) {
			this.openLauncherOverlay();
			return { consume: true };
		}
		if ((matchesKey(data, "escape") || matchesKey(data, "esc")) && this.overlays.length > 0) {
			this.closeTopOverlay();
			return { consume: true };
		}

		return undefined;
	}

	private dispatchMouse(event: MouseEvent): void {
		for (let i = this.overlays.length - 1; i >= 0; i--) {
			const overlay = this.overlays[i];
			const rect = resolveOverlayRect(overlay.component, overlay.options, this.tui.terminal.columns, this.tui.terminal.rows);
			if (!pointInRect(event, rect)) {
				return;
			}
			overlay.component.handleMouse?.(event, rect);
			return;
		}

		const panelRect: Rect = {
			row: HEADER_HEIGHT + 1,
			col: 1,
			width: this.tui.terminal.columns,
			height: this.getBodyHeight(),
		};
		if (this.panelManager.getActive().handleMouse?.(event, panelRect)) {
			this.tui.setFocus(this.panelManager.getActive().component);
		}
	}

	private getCommands(): ShellCommand[] {
		const panelCommands = this.panelManager.getActive().getCommands?.() ?? [];
		return [
			{
				id: "shell.help",
				label: "Open help",
				description: "Show shell controls, mouse scope, and the current phase boundaries.",
				run: () => this.openHelpOverlay(),
			},
			{
				id: "shell.launcher",
				label: "Open launcher",
				description: "Inspect panel slots and activate the current workspace panel.",
				run: () => this.openLauncherOverlay(),
			},
			{
				id: "shell.next-panel",
				label: "Next panel slot",
				description: "Reserved no-op until additional panel instances are added.",
				run: () => this.setStatus("Panel switching is reserved until more panels ship"),
			},
			{
				id: "shell.previous-panel",
				label: "Previous panel slot",
				description: "Reserved no-op until additional panel instances are added.",
				run: () => this.setStatus("Panel switching is reserved until more panels ship"),
			},
			{
				id: "shell.quit",
				label: "Quit MasterTUI",
				description: "Stop the shell and restore the terminal state.",
				run: () => this.stop(),
			},
			...panelCommands,
		].sort((a, b) => a.label.localeCompare(b.label));
	}

	private setStatus(text: string): void {
		this.status = text;
		this.tui.requestRender();
	}

	private showOverlay(id: string, component: OverlayRecord["component"], options: OverlayOptions): void {
		this.closeOverlay(id);
		const handle = this.tui.showOverlay(component, options);
		this.overlays.push({
			id,
			component,
			options,
			hide: () => handle.hide(),
		});
	}

	private closeTopOverlay(): void {
		const overlay = this.overlays.pop();
		if (!overlay) {
			return;
		}
		overlay.hide();
		this.tui.setFocus(this.panelManager.getActive().component);
	}

	private closeOverlay(id: string): void {
		const index = this.overlays.findIndex((entry) => entry.id === id);
		if (index === -1) {
			return;
		}
		const [overlay] = this.overlays.splice(index, 1);
		overlay.hide();
		this.tui.setFocus(this.panelManager.getActive().component);
	}
}
