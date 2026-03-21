import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentHost, AgentHostState } from "../agent-host.js";
import type { AppStateStore } from "../app-state-store.js";
import { ArtifactCatalogService } from "../durable/artifacts/artifact-catalog-service.js";
import { WorkbenchInventoryService } from "../durable/workbench-inventory-service.js";
import { renderAgentMessages } from "../message-renderer.js";
import type { ShellView } from "../shell-view.js";

export class AppMessageSyncService {
	constructor(
		private readonly host: AgentHost,
		private readonly shellView: ShellView,
		private readonly stateStore: AppStateStore,
		private readonly artifactCatalog: ArtifactCatalogService,
		private readonly inventory: WorkbenchInventoryService,
		private readonly getRuntimeContext: () => { runtimeId: string; sessionId?: string },
	) {}

	sync(options: {
		messages?: AgentMessage[];
		hostState?: AgentHostState;
	} = {}): void {
		const messages = options.messages ?? this.host.getMessages();
		const hostState = options.hostState ?? this.host.getState();
		const renderResult = renderAgentMessages(messages, {
			hideThinking: true,
			toolOutputExpanded: this.stateStore.getState().toolOutputExpanded,
			tui: this.shellView.tui,
		});

		this.shellView.setMessages(renderResult.components);
		this.artifactCatalog.replaceFromMessages(this.getRuntimeContext(), messages);
		this.stateStore.setArtifacts(this.inventory.listArtifactViews());

		if (messages.length === 0 && !hostState.isStreaming) {
			this.stateStore.resetActiveThinking();
		}

		this.shellView.refresh();
	}
}
