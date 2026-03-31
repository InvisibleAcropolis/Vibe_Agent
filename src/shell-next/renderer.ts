import type { ShellNextState } from "./state.js";
import type { RichDocumentRenderModel, TranscriptItem } from "./shared-models.js";

export interface ShellNextRenderModel {
	header: string;
	status: string;
	transcript: readonly TranscriptItem[];
	richDocuments: readonly RichDocumentRenderModel[];
}

export interface ShellNextRenderer {
	render(state: ShellNextState): ShellNextRenderModel;
}

export function createShellNextRenderer(): ShellNextRenderer {
	return {
		render: (state) => ({
			header: "Vibe Agent (Shell Next)",
			status: state.showThinking ? "Thinking visible" : "Thinking hidden",
			transcript: [],
			richDocuments: [],
		}),
	};
}
