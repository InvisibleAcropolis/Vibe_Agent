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

function formatMetaRow(state: ShellNextState): string {
	const { meta } = state;
	const session = `S:${meta.sessionLabel ?? "session"}`;
	const runtime = `R:${meta.runtimeLabel ?? "runtime"}`;
	const host = `H:${meta.psmuxHostLabel ?? "local"}`;
	const model = `M:${meta.providerId ?? "provider"}/${meta.modelId ?? "model"}`;
	return `${session} · ${runtime} · ${host} · ${model}`;
}

function formatStatusRow(state: ShellNextState, timeline?: TranscriptTimelineView): string {
	const streamBadge = state.meta.streamPhase === "streaming" || timeline?.isStreaming ? "●stream" : "○idle";
	const followBadge = timeline?.followMode ? "↧follow" : "↥pos";
	const bounds = timeline ? `${timeline.start + 1}-${timeline.end}/${timeline.total}` : "0-0/0";
	const thinkingBadge = state.showThinking ? "think:on" : "think:off";
	const toolBadge = state.toolOutputExpanded ? "tool:open" : "tool:fold";
	return `${streamBadge} ${followBadge} ${bounds} · ${thinkingBadge} ${toolBadge} · keys:Pg↑ Pg↓ End`;
}

export function createShellNextRenderer(): ShellNextRenderer {
	return {
		render: (state, timeline) => ({
			header: formatMetaRow(state),
			status: formatStatusRow(state, timeline),
			transcript: timeline?.items ?? [],
			richDocuments: [],
		}),
	};
}
