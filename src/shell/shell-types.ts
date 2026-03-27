import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Component, TUI } from "@mariozechner/pi-tui";
import type { AgentHostState } from "../agent-host.js";
import type { AnimationState } from "../animation-engine.js";
import type { AppShellState } from "../app-state-store.js";
import type { TranscriptViewportState } from "../components/transcript-viewport.js";
import type { FooterDataProvider } from "../footer-data-provider.js";
import type { MouseEvent, Rect } from "../mouse.js";
import type { Theme } from "./shell-coding-agent-interop.js";

export type WidgetFactory = (tui: TUI, theme: Theme) => Component & { dispose?(): void };
export type FooterFactory = (tui: TUI, theme: Theme, footerData: FooterDataProvider) => Component & { dispose?(): void };
export type HeaderFactory = (tui: TUI, theme: Theme) => Component & { dispose?(): void };

export interface ShellLayoutInput {
	cols: number;
	rows: number;
	customHeaderHeight: number;
	headerHeight: number;
	menuHeight: number;
	separatorTopHeight: number;
	separatorMidHeight: number;
	widgetAboveHeight: number;
	editorHeight: number;
	widgetBelowHeight: number;
	footerContentHeight: number;
	statusHeight: number;
	summaryHeight: number;
	thinkingTrayHeight: number;
	sessionsPanelVisible: boolean;
	rightWidth: number;
}

export interface ShellLayoutResult {
	contentHeight: number;
	transcriptRect: Rect;
}

export interface ShellChromeRenderInput {
	cols: number;
	state: AppShellState;
	hostState: AgentHostState | undefined;
	footerData: FooterDataProvider;
	transcriptState: TranscriptViewportState;
	messages: AgentMessage[];
	animationState?: AnimationState;
	customHeaderActive: boolean;
}

export interface ShellChromeRenderResult {
	headerInfoText: string;
	menuBarText: string;
	separatorTopText: string;
	separatorMidText: string;
	statusText: string;
	summaryText: string;
	wipeChar: string | null;
	sessionBorderColor?: string;
}

export interface ShellMenuAnchorInput {
	key: string;
	cols: number;
	customHeaderHeight: number;
	headerHeight: number;
}

export interface TranscriptMouseInput {
	event: MouseEvent;
	rect: Rect;
}
