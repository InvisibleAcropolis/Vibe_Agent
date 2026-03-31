import { Container, Text, TUI, type Component, type Terminal } from "@mariozechner/pi-tui";
import { FooterDataProvider } from "../footer-data-provider.js";
import type { MouseEvent, Rect } from "../mouse.js";
import type { FooterFactory, HeaderFactory, WidgetFactory } from "../shell/shell-types.js";
import type { ShellView } from "../shell-view.js";
import { TranscriptViewport } from "../components/transcript-viewport.js";
import type { NormalizedTranscriptPublication } from "../shell/transcript-publication.js";

export class ShellNextView implements ShellView {
	readonly tui: TUI;
	readonly footerData = new FooterDataProvider(process.cwd());
	private readonly transcriptViewport = new TranscriptViewport();
	private readonly root = new Container();
	private readonly transcriptContainer = new Container();
	private readonly composerContainer = new Container();
	private readonly composerSeparator = new Text("", 0, 0);
	private transcriptRect: Rect = { row: 1, col: 1, width: 1, height: 1 };
	private latestTranscriptPublication?: NormalizedTranscriptPublication;
	private activeEditor: Component | null = null;

	constructor(terminal: Terminal) {
		this.tui = new TUI(terminal, true);
		this.transcriptContainer.addChild(this.transcriptViewport);
		this.composerContainer.addChild(this.composerSeparator);
		this.root.addChild(this.transcriptContainer);
		this.root.addChild(this.composerContainer);
		this.tui.addChild(this.root);
		(terminal as { setResizeHandler?: (handler: () => void) => () => void }).setResizeHandler?.(() => {
			this.refresh();
			this.tui.requestRender();
		});
	}

	start(): void {
		this.refresh();
		this.tui.start();
	}
	stop(): void {
		this.footerData.dispose();
		this.tui.stop();
	}
	setEditor(component: Component): void {
		this.activeEditor = component;
		this.composerContainer.clear();
		this.composerContainer.addChild(this.composerSeparator);
		this.composerContainer.addChild(component);
		this.refresh();
		this.tui.requestRender();
	}
	setFocus(component: Component | null): void {
		this.tui.setFocus(component);
	}
	setMessages(components: Component[]): void {
		this.transcriptViewport.setComponents(components);
		this.refresh();
		this.tui.requestRender();
	}

	publishNormalizedTranscript(publication: NormalizedTranscriptPublication): void {
		this.latestTranscriptPublication = publication;
	}
	clearMessages(): void {
		this.transcriptViewport.setComponents([]);
		this.refresh();
		this.tui.requestRender();
	}
	setWidget(_key: string, _content: WidgetFactory | string[] | undefined, _placement?: "aboveEditor" | "belowEditor"): void {}
	setHeaderFactory(_factory: HeaderFactory | undefined): void {}
	setFooterFactory(_factory: FooterFactory | undefined): void {}
	setTitle(title: string): void {
		this.tui.terminal.setTitle(title);
	}
	refresh(): void {
		const width = Math.max(1, this.tui.terminal.columns);
		const height = Math.max(1, this.tui.terminal.rows);
		this.root.col = 1;
		this.root.row = 1;
		this.root.width = width;
		this.root.height = height;
		this.composerSeparator.setText("─".repeat(width));
		const composerHeight = this.activeEditor ? Math.max(0, this.composerContainer.render(width).length) : 0;
		const transcriptHeight = Math.max(1, height - composerHeight);
		this.transcriptContainer.row = 1;
		this.transcriptContainer.col = 1;
		this.transcriptContainer.width = width;
		this.transcriptContainer.height = transcriptHeight;
		this.composerContainer.row = transcriptHeight + 1;
		this.composerContainer.col = 1;
		this.composerContainer.width = width;
		this.composerContainer.height = composerHeight;
		this.transcriptRect = { row: 1, col: 1, width, height: transcriptHeight };
		this.transcriptViewport.setViewportHeight(transcriptHeight);
		this.transcriptViewport.measure(width);
	}
	toggleSessionsPanel(): void {}
	scrollTranscript(lines: number): void {
		this.transcriptViewport.scrollBy(lines);
		this.refresh();
		this.tui.requestRender();
	}
	scrollTranscriptToTop(): void {
		this.transcriptViewport.scrollToTop();
		this.refresh();
		this.tui.requestRender();
	}
	scrollTranscriptToBottom(): void {
		this.transcriptViewport.scrollToBottom();
		this.refresh();
		this.tui.requestRender();
	}
	dispatchMouse(event: MouseEvent): boolean {
		if (event.action !== "scroll") return false;
		const inside =
			event.row >= this.transcriptRect.row &&
			event.row < this.transcriptRect.row + this.transcriptRect.height &&
			event.col >= this.transcriptRect.col &&
			event.col < this.transcriptRect.col + this.transcriptRect.width;
		if (!inside) return false;
		this.scrollTranscript(event.button === "wheelUp" ? -3 : 3);
		return true;
	}
	getMenuAnchor(_key: string): { row: number; col: number } {
		return { row: 1, col: 1 };
	}
}
