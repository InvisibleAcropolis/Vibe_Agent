import { Box, Container, Image, Markdown, SelectList, SettingsList, Text, matchesKey, type Component } from "@mariozechner/pi-tui";
import { paintLine } from "../ansi.js";
import type { MouseEvent, Rect } from "../mouse.js";
import { pointInRect } from "../mouse.js";
import { masterTuiTheme } from "../theme.js";
import type { PanelContext, PanelDefinition, PanelInstance, ShellCommand } from "../types.js";

const pixelBase64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pT9lXQAAAAASUVORK5CYII=";

const overviewMarkdown = `
FutureIDE's **MasterTUI** is the reusable shell for every terminal-native surface that comes next.

- It owns a real panel manager from day one.
- It keeps overlays, keyboard routing, and mouse interception in one place.
- It reuses \`@mariozechner/pi-tui\` primitives instead of inventing a second rendering stack.

## What this panel demonstrates

1. Boxed sections and wrapped text
2. Markdown rendering
3. Select-list driven navigation
4. Settings-list state management
5. Image fallback and graphics hand-off
`;

type FocusArea = "content" | "navigator" | "settings";

class WorkspacePanelComponent implements Component {
	private readonly navigator: SelectList;
	private readonly settings: SettingsList;
	private readonly image = new Image(pixelBase64, "image/png", masterTuiTheme.imageTheme, {
		filename: "future-ide-demo.png",
		maxWidthCells: 20,
		maxHeightCells: 6,
	});
	private focusArea: FocusArea = "content";
	private scrollOffset = 0;
	private imageMode = "Auto";
	private navigatorMessage = "The workspace panel is the only live panel in v1. Use the launcher to inspect reserved slots.";

	constructor(private readonly context: PanelContext) {
		this.navigator = new SelectList(
			[
				{
					value: "workspace",
					label: "Workspace Panel",
					description: "The current live panel. This section proves the panel manager already has a reusable contract.",
				},
				{
					value: "sub-agents",
					label: "Sub-agent Slots",
					description: "Reserved for future multi-panel agent sessions and psmux-backed workspaces.",
				},
				{
					value: "file-browser",
					label: "File Browser",
					description: "Reserved slot for repo navigation, preview, and command execution surfaces.",
				},
				{
					value: "runtime",
					label: "Runtime Adapter",
					description: "Reserved seam for later external runtime hosts, including psmux panels.",
				},
			],
			5,
			masterTuiTheme.selectListTheme,
		);
		this.navigator.onSelect = (item) => {
			this.navigatorMessage = item.description ?? item.label;
			this.context.setStatus(`Workspace selection: ${item.label}`);
		};

		this.settings = new SettingsList(
			[
				{
					id: "focus",
					label: "Focus region",
					currentValue: "content",
					values: ["content", "navigator", "settings"],
					description: "Cycles which section receives keyboard navigation when you press Tab.",
				},
				{
					id: "image",
					label: "Image mode",
					currentValue: "Auto",
					values: ["Auto", "Fallback"],
					description: "Auto uses terminal image support when available. Fallback forces the text placeholder.",
				},
				{
					id: "mouse",
					label: "Mouse path",
					currentValue: "active",
					values: ["active", "active"],
					description: "Mouse is intentionally scoped to list clicks, panel focus, and scroll regions in v1.",
				},
			],
			5,
			masterTuiTheme.settingsListTheme,
			(id, newValue) => {
				if (id === "focus") {
					this.focusArea = newValue as FocusArea;
				}
				if (id === "image") {
					this.imageMode = newValue;
				}
				this.context.setStatus(`Workspace setting changed: ${id} → ${newValue}`);
			},
			() => {
				this.focusArea = "content";
				this.context.setStatus("Returned focus to workspace content");
			},
			{ enableSearch: false },
		);
	}

	invalidate(): void {
		this.navigator.invalidate();
		this.settings.invalidate();
		this.image.invalidate();
	}

	render(width: number): string[] {
		const sections = [
			...this.renderHero(width),
			...this.renderImage(width),
			...this.renderOverview(width),
			...this.renderNavigator(width),
			...this.renderSettings(width),
		];
		const bodyHeight = this.context.getBodyHeight();
		const maxScroll = Math.max(0, sections.length - bodyHeight);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScroll));
		const visible = sections.slice(this.scrollOffset, this.scrollOffset + bodyHeight);
		while (visible.length < bodyHeight) {
			visible.push(paintLine("", width, masterTuiTheme.panelBg));
		}
		return visible;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "tab")) {
			this.focusArea = this.focusArea === "content" ? "navigator" : this.focusArea === "navigator" ? "settings" : "content";
			this.settings.updateValue("focus", this.focusArea);
			this.context.setStatus(`Focus moved to ${this.focusArea}`);
			return;
		}

		if (this.focusArea === "navigator") {
			this.navigator.handleInput(data);
			return;
		}
		if (this.focusArea === "settings") {
			this.settings.handleInput(data);
			return;
		}

		if (matchesKey(data, "down")) {
			this.scrollBy(1);
		} else if (matchesKey(data, "up")) {
			this.scrollBy(-1);
		} else if (matchesKey(data, "pageDown")) {
			this.scrollBy(Math.max(1, Math.floor(this.context.getBodyHeight() / 2)));
		} else if (matchesKey(data, "pageUp")) {
			this.scrollBy(-Math.max(1, Math.floor(this.context.getBodyHeight() / 2)));
		} else if (matchesKey(data, "home")) {
			this.scrollOffset = 0;
			this.context.setStatus("Workspace scrolled to top");
		} else if (matchesKey(data, "end")) {
			this.scrollOffset = Number.MAX_SAFE_INTEGER;
			this.context.requestRender();
		}
	}

	handleMouse(event: MouseEvent, rect: Rect): boolean {
		if (!pointInRect(event, rect)) {
			return false;
		}
		if (event.action === "scroll") {
			this.scrollBy(event.button === "wheelUp" ? -2 : 2);
			return true;
		}
		if (event.action === "down" && event.button === "left") {
			this.focusArea = "content";
			this.settings.updateValue("focus", "content");
			this.context.setStatus("Workspace panel focused");
			return true;
		}
		return true;
	}

	getCommands(): ShellCommand[] {
		return [
			{
				id: "workspace.focus-content",
				label: "Focus workspace content",
				description: "Return keyboard control to the scrollable workspace body.",
				run: () => {
					this.focusArea = "content";
					this.settings.updateValue("focus", "content");
					this.context.setStatus("Workspace content focused");
				},
			},
			{
				id: "workspace.focus-navigator",
				label: "Focus navigator section",
				description: "Route keyboard input to the SelectList showcase section.",
				run: () => {
					this.focusArea = "navigator";
					this.settings.updateValue("focus", "navigator");
					this.context.setStatus("Navigator section focused");
				},
			},
			{
				id: "workspace.focus-settings",
				label: "Focus settings section",
				description: "Route keyboard input to the SettingsList section.",
				run: () => {
					this.focusArea = "settings";
					this.settings.updateValue("focus", "settings");
					this.context.setStatus("Settings section focused");
				},
			},
			{
				id: "workspace.reset-scroll",
				label: "Reset workspace scroll",
				description: "Jump back to the first section in the panel.",
				run: () => {
					this.scrollOffset = 0;
					this.context.setStatus("Workspace scroll reset");
				},
			},
		];
	}

	private scrollBy(amount: number): void {
		this.scrollOffset = Math.max(0, this.scrollOffset + amount);
		this.context.requestRender();
	}

	private renderHero(width: number): string[] {
		const content = new Container();
		content.addChild(
			new Text(
				`${masterTuiTheme.accentStrong("Phase 2: Standalone MasterTUI")}\n${masterTuiTheme.muted("This app is the reusable terminal shell for FutureIDE. It stands on pi-tui and keeps FutureIDE composition local to apps/.")}`,
				0,
				0,
			),
		);
		return this.renderSection("Overview", width, content, this.focusArea === "content");
	}

	private renderOverview(width: number): string[] {
		const content = new Container();
		content.addChild(new Markdown(overviewMarkdown, 0, 0, masterTuiTheme.markdownTheme, masterTuiTheme.defaultMarkdownText));
		return this.renderSection("System Notes", width, content, false);
	}

	private renderNavigator(width: number): string[] {
		const content = new Container();
		content.addChild(new Text(masterTuiTheme.muted(this.navigatorMessage), 0, 0));
		content.addChild(new Text("", 0, 0));
		content.addChild(this.navigator);
		return this.renderSection("Navigator Showcase", width, content, this.focusArea === "navigator");
	}

	private renderSettings(width: number): string[] {
		const content = new Container();
		content.addChild(new Text(masterTuiTheme.muted("SettingsList remains live in-panel so future specialized TUIs can inherit the same shell conventions."), 0, 0));
		content.addChild(new Text("", 0, 0));
		content.addChild(this.settings);
		return this.renderSection("Settings", width, content, this.focusArea === "settings");
	}

	private renderImage(width: number): string[] {
		const content = new Container();
		content.addChild(
			new Text(
				this.imageMode === "Fallback"
					? masterTuiTheme.warning("Fallback mode forced: showing the textual image placeholder only.")
					: masterTuiTheme.muted("Auto mode: image output will use terminal graphics when supported, otherwise the fallback tag remains visible."),
				0,
				0,
			),
		);
		content.addChild(new Text("", 0, 0));
		content.addChild(this.imageMode === "Fallback" ? new Text("[Image: future-ide-demo.png [image/png] 1x1]", 0, 0) : this.image);
		return this.renderSection("Graphics Demo", width, content, false);
	}

	private renderSection(title: string, width: number, body: Component, focused: boolean): string[] {
		const inner = new Container();
		inner.addChild(new Text(masterTuiTheme.sectionTitle(title, focused), 0, 0));
		inner.addChild(new Text("", 0, 0));
		inner.addChild(body);

		const box = new Box(1, 1, focused ? masterTuiTheme.panelBgActive : masterTuiTheme.sectionBg);
		box.addChild(inner);
		return box.render(width);
	}
}

export function createWorkspacePanel(context: PanelContext): PanelDefinition {
	return {
		id: "workspace",
		title: "Workspace",
		description: "The live FutureIDE MasterTUI panel used to validate the reusable shell.",
		create: () => {
			const component = new WorkspacePanelComponent(context);
			const instance: PanelInstance = {
				id: "workspace",
				title: "Workspace",
				description: "The live FutureIDE MasterTUI panel used to validate the reusable shell.",
				component,
				handleMouse: (event, rect) => component.handleMouse(event, rect),
				getCommands: () => component.getCommands(),
			};
			return instance;
		},
	};
}
