export interface ShellNextState {
	showThinking: boolean;
	toolOutputExpanded: boolean;
	sessionsPanelVisible: boolean;
}

export function createInitialShellNextState(): ShellNextState {
	return {
		showThinking: true,
		toolOutputExpanded: false,
		sessionsPanelVisible: false,
	};
}
