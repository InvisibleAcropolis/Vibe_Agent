import { FooterDataProvider } from "../footer-data-provider.js";
import type { MouseEvent } from "../mouse.js";
import type { OverlayOptionsWithMousePolicy, ShellOverlayHandle } from "../overlay-controller.js";
import type { ShellView } from "../shell-view.js";
import type { NormalizedTranscriptPublication } from "../shell/transcript-publication.js";
import type { ShellMenuDefinition } from "../components/shell-menu-overlay.js";
import type { AppStateStore } from "../app-state-store.js";
import type { AgentHostState } from "../agent-host.js";

type DeferredCall = (view: LazyOpenTuiBoundView) => void;

type LazyOpenTuiBoundView = ShellView & {
	bindEditorController?: (controller: unknown) => void;
	openSelectOverlay?: <T>(
		id: string,
		title: string,
		description: string,
		items: Array<{ value: T; label: string; description?: string }>,
		onSelect: (value: T) => void,
		onCancel?: () => void,
	) => void;
	openTextPrompt?: (title: string, description: string, initialValue: string, onSubmit: (value: string) => void, onCancel?: () => void) => void;
	openEditorPrompt?: (title: string, prefill: string, onSubmit: (value: string) => void, onCancel: () => void) => void;
	openMenuOverlay?: (id: string, definition: ShellMenuDefinition) => void;
	showCustomOverlay?: (id: string, component: unknown, options: OverlayOptionsWithMousePolicy) => ShellOverlayHandle;
	closeTopOverlay?: () => void;
	closeOverlay?: (id: string) => void;
	closeAllOverlays?: () => void;
	getOverlayDepth?: () => number;
};

export class LazyOpenTuiShellView implements ShellView {
	readonly implementation = "opentui" as const;
	readonly footerData = new FooterDataProvider(process.cwd());

	private boundView?: LazyOpenTuiBoundView;
	private readonly deferredCalls: DeferredCall[] = [];

	constructor(
		private readonly options: {
			stateStore: AppStateStore;
			getHostState: () => AgentHostState | undefined;
			onShellAction?: (action: { type: "overlay-open"; target: "command-palette" | "settings" | "sessions" | "orchestration" } | { type: "surface-launch"; target: "sessions-browser" | "orc-session" }) => void;
		},
	) {}

	start(): void {
		void this.bind().then((view) => view.start());
	}

	stop(): void {
		if (this.boundView) {
			this.boundView.stop();
			return;
		}
		this.footerData.dispose();
	}

	setEditor(component: unknown): void {
		this.enqueue((view) => view.setEditor(component));
	}

	setFocus(component: unknown): void {
		this.enqueue((view) => view.setFocus(component));
	}

	setMessages(components: unknown[]): void {
		this.enqueue((view) => view.setMessages(components));
	}

	publishNormalizedTranscript(publication: NormalizedTranscriptPublication): void {
		this.enqueue((view) => view.publishNormalizedTranscript?.(publication));
	}

	clearMessages(): void {
		this.enqueue((view) => view.clearMessages());
	}

	setWidget(key: string, content: unknown, placement?: "aboveEditor" | "belowEditor"): void {
		this.enqueue((view) => view.setWidget(key, content, placement));
	}

	setHeaderFactory(factory: unknown): void {
		this.enqueue((view) => view.setHeaderFactory(factory));
	}

	setFooterFactory(factory: unknown): void {
		this.enqueue((view) => view.setFooterFactory(factory));
	}

	setTitle(title: string): void {
		this.enqueue((view) => view.setTitle(title));
	}

	refresh(): void {
		this.enqueue((view) => view.refresh());
	}

	requestRender(): void {
		this.enqueue((view) => view.requestRender());
	}

	toggleSessionsPanel(): void {
		this.enqueue((view) => view.toggleSessionsPanel());
	}

	scrollTranscript(lines: number): void {
		this.enqueue((view) => view.scrollTranscript(lines));
	}

	scrollTranscriptToTop(): void {
		this.enqueue((view) => view.scrollTranscriptToTop());
	}

	scrollTranscriptToBottom(): void {
		this.enqueue((view) => view.scrollTranscriptToBottom());
	}

	dispatchMouse(event: MouseEvent): boolean {
		return this.boundView?.dispatchMouse(event) ?? false;
	}

	getMenuAnchor(key: string): { row: number; col: number } {
		return this.boundView?.getMenuAnchor(key) ?? { row: 1, col: 1 };
	}

	getDebugSnapshot(): { width: number; height: number; lines: string[] } {
		return this.boundView?.getDebugSnapshot() ?? { width: 80, height: 24, lines: ["OpenTUI shell not initialized."] };
	}

	setDebugHandler(handler: (() => void) | undefined): void {
		this.enqueue((view) => view.setDebugHandler?.(handler));
	}

	bindEditorController(controller: unknown): void {
		this.enqueue((view) => view.bindEditorController?.(controller));
	}

	openSelectOverlay<T>(
		id: string,
		title: string,
		description: string,
		items: Array<{ value: T; label: string; description?: string }>,
		onSelect: (value: T) => void,
		onCancel?: () => void,
	): void {
		this.enqueue((view) => view.openSelectOverlay?.(id, title, description, items, onSelect, onCancel));
	}

	openTextPrompt(title: string, description: string, initialValue: string, onSubmit: (value: string) => void, onCancel?: () => void): void {
		this.enqueue((view) => view.openTextPrompt?.(title, description, initialValue, onSubmit, onCancel));
	}

	openEditorPrompt(title: string, prefill: string, onSubmit: (value: string) => void, onCancel: () => void): void {
		this.enqueue((view) => view.openEditorPrompt?.(title, prefill, onSubmit, onCancel));
	}

	openMenuOverlay(id: string, definition: ShellMenuDefinition): void {
		this.enqueue((view) => view.openMenuOverlay?.(id, definition));
	}

	showCustomOverlay(id: string, component: unknown, options: OverlayOptionsWithMousePolicy): ShellOverlayHandle {
		if (this.boundView?.showCustomOverlay) {
			return this.boundView.showCustomOverlay(id, component, options);
		}
		this.enqueue((view) => {
			view.showCustomOverlay?.(id, component, options);
		});
		return {
			hide: () => this.closeOverlay(id),
			isHidden: () => !this.boundView?.getOverlayDepth?.(),
			setHidden: (hidden) => {
				if (hidden) {
					this.closeOverlay(id);
				}
			},
		};
	}

	closeTopOverlay(): void {
		this.enqueue((view) => view.closeTopOverlay?.());
	}

	closeOverlay(id: string): void {
		this.enqueue((view) => view.closeOverlay?.(id));
	}

	closeAllOverlays(): void {
		this.enqueue((view) => view.closeAllOverlays?.());
	}

	getOverlayDepth(): number {
		return this.boundView?.getOverlayDepth?.() ?? 0;
	}

	private enqueue(call: DeferredCall): void {
		if (this.boundView) {
			call(this.boundView);
			return;
		}
		this.deferredCalls.push(call);
	}

	private async bind(): Promise<LazyOpenTuiBoundView> {
		if (this.boundView) {
			return this.boundView;
		}
		const module = await import("./shell-opentui-view.js");
		const view = new module.OpenTuiShellView({
			stateStore: this.options.stateStore,
			getHostState: this.options.getHostState,
			onShellAction: this.options.onShellAction,
		}) as LazyOpenTuiBoundView;
		this.boundView = view;
		for (const call of this.deferredCalls.splice(0)) {
			call(view);
		}
		return view;
	}
}
