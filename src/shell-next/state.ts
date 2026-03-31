export type ShellNextStreamPhase = "streaming" | "idle";

export interface ShellNextMeta {
	sessionLabel?: string;
	runtimeLabel?: string;
	psmuxHostLabel?: string;
	providerId?: string;
	modelId?: string;
	streamPhase: ShellNextStreamPhase;
}

export interface ShellNextState {
	showThinking: boolean;
	toolOutputExpanded: boolean;
	sessionsPanelVisible: boolean;
	meta: ShellNextMeta;
}

export function createInitialShellNextState(): ShellNextState {
	return {
		showThinking: true,
		toolOutputExpanded: false,
		sessionsPanelVisible: false,
		meta: {
			streamPhase: "idle",
		},
	};
}
