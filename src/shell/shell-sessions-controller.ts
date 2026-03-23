import type { Component } from "@mariozechner/pi-tui";
import type { AnimationEngine } from "../animation-engine.js";
import { SessionsPanel } from "../components/sessions-panel.js";
import { SideBySideContainer } from "../components/side-by-side-container.js";
import type { AgentHost, AgentHostState } from "../agent-host.js";

export class ShellSessionsController {
	private sessionsPanel: SessionsPanel | null = null;
	private sessionsPanelVisible = false;

	constructor(
		private readonly dependencies: {
			contentArea: SideBySideContainer;
			getAgentHost: () => AgentHost | undefined;
			getHostState: () => AgentHostState | undefined;
			setFocus: (component: Component | null) => void;
			requestRender: () => void;
			animationEngine?: AnimationEngine;
		},
	) {}

	toggle(): void {
		this.sessionsPanelVisible = !this.sessionsPanelVisible;
		if (this.sessionsPanelVisible) {
			if (!this.sessionsPanel) {
				this.sessionsPanel = new SessionsPanel({
					getSessions: async () => {
						const host = this.dependencies.getAgentHost();
						if (!host) {
							return [];
						}
						return host.listSessions("all");
					},
					getCurrentSessionFile: () => this.dependencies.getHostState()?.sessionFile,
					onSwitch: async (sessionPath) => {
						this.dependencies.animationEngine?.triggerWipeTransition();
						await this.dependencies.getAgentHost()?.switchSession(sessionPath);
					},
					onClose: () => {
						this.sessionsPanelVisible = false;
						this.dependencies.contentArea.right = null;
						this.dependencies.setFocus(null);
						this.dependencies.requestRender();
					},
				});
			}
			void this.sessionsPanel.refresh();
			this.dependencies.contentArea.right = this.sessionsPanel;
			this.dependencies.setFocus(this.sessionsPanel as Component);
			this.dependencies.animationEngine?.triggerFocusFlash("sessions");
			return;
		}

		this.dependencies.contentArea.right = null;
		this.dependencies.setFocus(null);
	}

	isVisible(): boolean {
		return this.sessionsPanelVisible;
	}

	setBorderColor(color: string | undefined): void {
		if (this.sessionsPanel && color) {
			this.sessionsPanel.borderColor = color;
		}
	}
}
