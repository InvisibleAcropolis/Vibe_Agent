import type { ShellNextState } from "./state.js";

export interface ShellNextRenderModel {
	header: string;
	status: string;
}

export interface ShellNextRenderer {
	render(state: ShellNextState): ShellNextRenderModel;
}

export function createShellNextRenderer(): ShellNextRenderer {
	return {
		render: (state) => ({
			header: "Vibe Agent (Shell Next)",
			status: state.showThinking ? "Thinking visible" : "Thinking hidden",
		}),
	};
}
