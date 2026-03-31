import type { Artifact } from "./types.js";

export interface ActiveThinkingState {
	text: string;
	hasTurnState: boolean;
	hasThinkingEvents: boolean;
	turnActive: boolean;
	provider?: string;
	modelId?: string;
	api?: string;
}

const EMPTY_ACTIVE_THINKING: ActiveThinkingState = {
	text: "",
	hasTurnState: false,
	hasThinkingEvents: false,
	turnActive: false,
};

export type TranscriptExpansionState = Record<string, boolean>;

export interface TranscriptBehaviorState {
	followMode: boolean;
	expansionState: TranscriptExpansionState;
	selectedTranscriptItemId?: string;
	launchedSurfaceIds: string[];
}

export interface AppShellState {
	statusMessage: string;
	workingMessage?: string;
	helpMessage?: string;
	contextTitle?: string;
	contextMessage?: string;
	contextTone?: "accent" | "info" | "success" | "warning" | "dim";
	showThinking: boolean;
	/** @deprecated Use `showThinking` only; this mirror flag exists for migration compatibility. */
	hideThinking: boolean;
	/** @deprecated Use `transcript.expansionState["tool-output"]` for transcript-first expansion state. */
	toolOutputExpanded: boolean;
	/** @deprecated Focus labels are a legacy row-layout affordance and should not drive transcript behavior. */
	focusLabel: string;
	overlayIds: string[];
	lastStartupPhase?: string;
	artifacts: Artifact[];
	showArtifactPanel: boolean;
	sessionStatsVisible: boolean;
	activeRuntimeId: string;
	activeRuntimeName: string;
	activeConversationLabel: string;
	activeThinking: ActiveThinkingState;
	transcript: TranscriptBehaviorState;
	permissionPending?: { toolName: string; args: Record<string, unknown>; resolve: (approved: boolean) => void };
}

type AppStateListener = (state: AppShellState) => void;

export interface AppStateStore {
	getState(): AppShellState;
	subscribe(listener: AppStateListener): () => void;
	setStatusMessage(message: string): void;
	setOnStatusChange(cb: (message: string) => void): void;
	setWorkingMessage(message: string | undefined): void;
	setHelpMessage(message: string | undefined): void;
	setContextBanner(
		title: string | undefined,
		message: string | undefined,
		tone?: AppShellState["contextTone"],
	): void;
	setShowThinking(show: boolean): void;
	setHideThinking(hidden: boolean): void;
	setFollowMode(followMode: boolean): void;
	setToolOutputExpanded(expanded: boolean): void;
	setTranscriptExpansionState(expansionState: TranscriptExpansionState): void;
	setTranscriptItemExpanded(itemId: string, expanded: boolean): void;
	setSelectedTranscriptItem(itemId: string | undefined): void;
	launchSurface(surfaceId: string): void;
	closeLaunchedSurface(surfaceId: string): void;
	clearLaunchedSurfaces(): void;
	setFocusLabel(label: string): void;
	pushOverlay(id: string): void;
	removeOverlay(id: string): void;
	clearOverlays(): void;
	setLastStartupPhase(phase: string | undefined): void;
	setArtifacts(artifacts: Artifact[]): void;
	addArtifact(artifact: Artifact): void;
	clearArtifacts(): void;
	setShowArtifactPanel(show: boolean): void;
	setSessionStatsVisible(visible: boolean): void;
	setActiveRuntime(runtime: { id: string; name: string; conversationLabel: string }): void;
	setActiveThinking(state: ActiveThinkingState): void;
	resetActiveThinking(): void;
	setPermissionPending(pending: AppShellState["permissionPending"]): void;
}

export class DefaultAppStateStore implements AppStateStore {
	private state: AppShellState = {
		statusMessage: "Starting Vibe Agent...",
		showThinking: true,
		hideThinking: false,
		toolOutputExpanded: false,
		focusLabel: "editor",
		overlayIds: [],
		artifacts: [],
		showArtifactPanel: false,
		sessionStatsVisible: false,
		activeRuntimeId: "coding",
		activeRuntimeName: "Coding Runtime",
		activeConversationLabel: "Coding chat",
		activeThinking: { ...EMPTY_ACTIVE_THINKING },
		transcript: {
			followMode: true,
			expansionState: {},
			selectedTranscriptItemId: undefined,
			launchedSurfaceIds: [],
		},
	};
	private listeners = new Set<AppStateListener>();
	private onStatusChange?: (message: string) => void;

	setOnStatusChange(cb: (message: string) => void): void {
		this.onStatusChange = cb;
	}

	getState(): AppShellState {
		return {
			...this.state,
			overlayIds: [...this.state.overlayIds],
			artifacts: [...this.state.artifacts],
			activeThinking: { ...this.state.activeThinking },
			transcript: {
				followMode: this.state.transcript.followMode,
				expansionState: { ...this.state.transcript.expansionState },
				selectedTranscriptItemId: this.state.transcript.selectedTranscriptItemId,
				launchedSurfaceIds: [...this.state.transcript.launchedSurfaceIds],
			},
		};
	}

	subscribe(listener: AppStateListener): () => void {
		this.listeners.add(listener);
		listener(this.getState());
		return () => this.listeners.delete(listener);
	}

	setStatusMessage(message: string): void {
		this.update({ statusMessage: message });
		this.onStatusChange?.(message);
	}

	setWorkingMessage(message: string | undefined): void {
		this.update({ workingMessage: message });
	}

	setHelpMessage(message: string | undefined): void {
		this.update({ helpMessage: message });
	}

	setContextBanner(
		title: string | undefined,
		message: string | undefined,
		tone: AppShellState["contextTone"] = message ? "info" : undefined,
	): void {
		this.update({
			contextTitle: title,
			contextMessage: message,
			contextTone: title || message ? tone : undefined,
		});
	}

	setShowThinking(show: boolean): void {
		this.update({ showThinking: show, hideThinking: !show });
	}

	setHideThinking(hidden: boolean): void {
		this.update({ hideThinking: hidden, showThinking: !hidden });
	}

	setFollowMode(followMode: boolean): void {
		this.update({
			transcript: {
				...this.state.transcript,
				followMode,
			},
		});
	}

	setToolOutputExpanded(expanded: boolean): void {
		this.update({
			toolOutputExpanded: expanded,
			transcript: {
				...this.state.transcript,
				expansionState: {
					...this.state.transcript.expansionState,
					"tool-output": expanded,
				},
			},
		});
	}

	setTranscriptExpansionState(expansionState: TranscriptExpansionState): void {
		this.update({
			transcript: {
				...this.state.transcript,
				expansionState: { ...expansionState },
			},
			toolOutputExpanded: Boolean(expansionState["tool-output"]),
		});
	}

	setTranscriptItemExpanded(itemId: string, expanded: boolean): void {
		this.setTranscriptExpansionState({
			...this.state.transcript.expansionState,
			[itemId]: expanded,
		});
	}

	setSelectedTranscriptItem(itemId: string | undefined): void {
		this.update({
			transcript: {
				...this.state.transcript,
				selectedTranscriptItemId: itemId,
			},
		});
	}

	launchSurface(surfaceId: string): void {
		if (this.state.transcript.launchedSurfaceIds.includes(surfaceId)) {
			return;
		}
		this.update({
			transcript: {
				...this.state.transcript,
				launchedSurfaceIds: [...this.state.transcript.launchedSurfaceIds, surfaceId],
			},
		});
	}

	closeLaunchedSurface(surfaceId: string): void {
		if (!this.state.transcript.launchedSurfaceIds.includes(surfaceId)) {
			return;
		}
		this.update({
			transcript: {
				...this.state.transcript,
				launchedSurfaceIds: this.state.transcript.launchedSurfaceIds.filter((id) => id !== surfaceId),
			},
		});
	}

	clearLaunchedSurfaces(): void {
		if (this.state.transcript.launchedSurfaceIds.length === 0) {
			return;
		}
		this.update({
			transcript: {
				...this.state.transcript,
				launchedSurfaceIds: [],
			},
		});
	}

	setFocusLabel(label: string): void {
		this.update({ focusLabel: label });
	}

	pushOverlay(id: string): void {
		if (this.state.overlayIds.includes(id)) {
			return;
		}
		this.update({ overlayIds: [...this.state.overlayIds, id] });
	}

	removeOverlay(id: string): void {
		if (!this.state.overlayIds.includes(id)) {
			return;
		}
		this.update({ overlayIds: this.state.overlayIds.filter((entry) => entry !== id) });
	}

	clearOverlays(): void {
		if (this.state.overlayIds.length === 0) {
			return;
		}
		this.update({ overlayIds: [] });
	}

	setLastStartupPhase(phase: string | undefined): void {
		this.update({ lastStartupPhase: phase });
	}

	setArtifacts(artifacts: Artifact[]): void {
		this.update({ artifacts: [...artifacts] });
	}

	addArtifact(artifact: Artifact): void {
		this.update({ artifacts: [...this.state.artifacts, artifact] });
	}

	clearArtifacts(): void {
		this.update({ artifacts: [] });
	}

	setShowArtifactPanel(show: boolean): void {
		this.update({ showArtifactPanel: show });
	}

	setSessionStatsVisible(visible: boolean): void {
		this.update({ sessionStatsVisible: visible });
	}

	setActiveRuntime(runtime: { id: string; name: string; conversationLabel: string }): void {
		this.update({
			activeRuntimeId: runtime.id,
			activeRuntimeName: runtime.name,
			activeConversationLabel: runtime.conversationLabel,
		});
	}

	setActiveThinking(state: ActiveThinkingState): void {
		this.update({ activeThinking: { ...state } });
	}

	resetActiveThinking(): void {
		this.update({ activeThinking: { ...EMPTY_ACTIVE_THINKING } });
	}

	setPermissionPending(pending: AppShellState["permissionPending"]): void {
		this.update({ permissionPending: pending });
	}

	private update(partial: Partial<AppShellState>): void {
		this.state = {
			...this.state,
			...partial,
		};
		const snapshot = this.getState();
		for (const listener of this.listeners) {
			listener(snapshot);
		}
	}
}
