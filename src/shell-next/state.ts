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
	meta: ShellNextMeta;
}

export function createInitialShellNextState(): ShellNextState {
	return {
		showThinking: true,
		toolOutputExpanded: false,
		meta: {
			streamPhase: "idle",
		},
	};
}
