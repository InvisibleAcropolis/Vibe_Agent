import type { Artifact } from "./types.js";

export interface AppShellState {
	statusMessage: string;
	workingMessage?: string;
	helpMessage?: string;
	contextTitle?: string;
	contextMessage?: string;
	contextTone?: "accent" | "info" | "success" | "warning" | "dim";
	hideThinking: boolean;
	toolOutputExpanded: boolean;
	focusLabel: string;
	overlayIds: string[];
	lastStartupPhase?: string;
	artifacts: Artifact[];
	showArtifactPanel: boolean;
	sessionStatsVisible: boolean;
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
	setHideThinking(hidden: boolean): void;
	setToolOutputExpanded(expanded: boolean): void;
	setFocusLabel(label: string): void;
	pushOverlay(id: string): void;
	removeOverlay(id: string): void;
	clearOverlays(): void;
	setLastStartupPhase(phase: string | undefined): void;
	addArtifact(artifact: Artifact): void;
	clearArtifacts(): void;
	setShowArtifactPanel(show: boolean): void;
	setSessionStatsVisible(visible: boolean): void;
	setPermissionPending(pending: AppShellState["permissionPending"]): void;
}

export class DefaultAppStateStore implements AppStateStore {
	private state: AppShellState = {
		statusMessage: "Starting Vibe Agent...",
		hideThinking: false,
		toolOutputExpanded: false,
		focusLabel: "editor",
		overlayIds: [],
		artifacts: [],
		showArtifactPanel: false,
		sessionStatsVisible: false,
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

	setHideThinking(hidden: boolean): void {
		this.update({ hideThinking: hidden });
	}

	setToolOutputExpanded(expanded: boolean): void {
		this.update({ toolOutputExpanded: expanded });
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
