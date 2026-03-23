import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AppStateStore } from "../app-state-store.js";
import { ThinkingTray } from "../components/thinking-tray.js";
import { extractLatestThinkingText } from "../message-renderer.js";

export class ShellThinkingSync {
	constructor(
		private readonly dependencies: {
			stateStore: AppStateStore;
			thinkingTray: ThinkingTray;
			getMessages: () => AgentMessage[];
		},
	) {}

	sync(): void {
		const state = this.dependencies.stateStore.getState();
		this.dependencies.thinkingTray.setEnabled(state.showThinking);
		if (!state.showThinking) {
			this.dependencies.thinkingTray.setThinkingText(undefined);
			return;
		}
		if (state.activeThinking.hasTurnState || state.activeThinking.hasThinkingEvents || state.activeThinking.text.length > 0) {
			this.dependencies.thinkingTray.setThinkingText(state.activeThinking.text);
			return;
		}
		this.dependencies.thinkingTray.setThinkingText(extractLatestThinkingText(this.dependencies.getMessages()));
	}
}
