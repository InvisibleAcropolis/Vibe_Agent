import type { ShellNextState } from "./state.js";
import type { TranscriptItem } from "./shared-models.js";
import type { TranscriptTimelineController } from "./transcript-timeline.js";

export interface ShellNextActions {
	toggleThinking(state: ShellNextState): ShellNextState;
	toggleToolOutput(state: ShellNextState): ShellNextState;
	toggleSessionsPanel(state: ShellNextState): ShellNextState;
	replaceTranscript(timeline: TranscriptTimelineController, items: readonly TranscriptItem[]): void;
	appendTranscript(timeline: TranscriptTimelineController, items: readonly TranscriptItem[]): void;
	setStreaming(timeline: TranscriptTimelineController, isStreaming: boolean): void;
	handleKeyboardScroll(timeline: TranscriptTimelineController, target: "page-up" | "page-down" | "top" | "bottom"): void;
	handleMouseScroll(timeline: TranscriptTimelineController, direction: "up" | "down", stride?: number): void;
}

export function createShellNextActions(): ShellNextActions {
	return {
		toggleThinking: (state) => ({ ...state, showThinking: !state.showThinking }),
		toggleToolOutput: (state) => ({ ...state, toolOutputExpanded: !state.toolOutputExpanded }),
		toggleSessionsPanel: (state) => ({ ...state, sessionsPanelVisible: !state.sessionsPanelVisible }),
		replaceTranscript: (timeline, items) => timeline.replaceItems(items),
		appendTranscript: (timeline, items) => timeline.appendItems(items),
		setStreaming: (timeline, isStreaming) => timeline.setStreaming(isStreaming),
		handleKeyboardScroll: (timeline, target) => {
			switch (target) {
				case "page-up":
					timeline.scrollPageUp();
					break;
				case "page-down":
					timeline.scrollPageDown();
					break;
				case "top":
					timeline.scrollToTop();
					break;
				case "bottom":
					timeline.scrollToBottom();
					break;
			}
		},
		handleMouseScroll: (timeline, direction, stride) => timeline.scrollWheel(direction, stride),
	};
}
