import type { ShellNextState } from "./state.js";

export interface ShellNextActions {
	toggleThinking(state: ShellNextState): ShellNextState;
	toggleToolOutput(state: ShellNextState): ShellNextState;
	toggleSessionsPanel(state: ShellNextState): ShellNextState;
}

export function createShellNextActions(): ShellNextActions {
	return {
		toggleThinking: (state) => ({ ...state, showThinking: !state.showThinking }),
		toggleToolOutput: (state) => ({ ...state, toolOutputExpanded: !state.toolOutputExpanded }),
		toggleSessionsPanel: (state) => ({ ...state, sessionsPanelVisible: !state.sessionsPanelVisible }),
	};
}
