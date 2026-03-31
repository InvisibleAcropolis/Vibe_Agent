import type { ShellNextState } from "./state.js";
import type { RichDocumentRenderModel, TranscriptItem } from "./shared-models.js";
import type { TranscriptTimelineView } from "./transcript-timeline.js";

export interface ShellNextRenderModel {
	header: string;
	status: string;
	transcript: readonly TranscriptItem[];
	richDocuments: readonly RichDocumentRenderModel[];
}

export interface ShellNextRenderer {
	render(state: ShellNextState, timeline?: TranscriptTimelineView): ShellNextRenderModel;
}

export function createShellNextRenderer(): ShellNextRenderer {
	return {
		render: (state, timeline) => ({
			header: "Vibe Agent (Shell Next)",
			status: `${state.showThinking ? "Thinking visible" : "Thinking hidden"} · ${timeline?.followMode ? "follow" : "paused"}`,
			transcript: timeline?.items ?? [],
			richDocuments: [],
		}),
	};
}
