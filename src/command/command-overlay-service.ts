import { ArtifactViewer } from "../components/artifact-viewer.js";
import { HelpOverlay } from "../components/help-overlay.js";
import { OrchestrationStatusPanel } from "../components/orchestration-status-panel.js";
import { SessionStatsOverlay } from "../components/session-stats-overlay.js";
import { WorkbenchInventoryService, type OrchestrationDocumentType } from "../durable/workbench-inventory-service.js";
import type { AgentHost, AgentHostState } from "../agent-host.js";
import type { AppStateStore } from "../app-state-store.js";
import type { FooterDataProvider } from "../footer-data-provider.js";
import type { OverlayController } from "../overlay-controller.js";
import { createOrcTrackerDashboardViewModel } from "../orchestration/orc-tracker.js";

export class CommandOverlayService {
	constructor(
		private readonly dependencies: {
			host: AgentHost;
			overlayController: OverlayController;
			stateStore: AppStateStore;
			footerData: FooterDataProvider;
			inventory: WorkbenchInventoryService;
			getHostState: () => AgentHostState | undefined;
			onError: (context: string, error: unknown, details?: Record<string, unknown>) => void;
		},
	) {}

	openOrcDashboard(): void {
		this.dependencies.overlayController.showCustomOverlay(
			"orc-dashboard",
			new OrchestrationStatusPanel(createOrcTrackerDashboardViewModel(), () => this.dependencies.overlayController.closeOverlay("orc-dashboard")),
			{ width: 78, maxHeight: "80%", anchor: "center", margin: 1 },
		);
	}

	openStatsOverlay(): void {
		try {
			const stats = this.dependencies.host.getSessionStats();
			const hostState = this.dependencies.getHostState();
			const gitBranch = this.dependencies.footerData.getGitBranch();
			this.dependencies.overlayController.showCustomOverlay(
				"session-stats",
				new SessionStatsOverlay(stats, hostState, gitBranch, () => this.dependencies.overlayController.closeOverlay("session-stats")),
				{ width: 72, maxHeight: "80%", anchor: "center", margin: 1 },
			);
		} catch (error) {
			this.dependencies.onError("openStatsOverlay", error);
		}
	}

	openArtifactViewer(): void {
		this.dependencies.overlayController.showCustomOverlay(
			"artifact-viewer",
			new ArtifactViewer(this.dependencies.inventory.listArtifactViews(), () => this.dependencies.overlayController.closeOverlay("artifact-viewer")),
			{ width: "85%", maxHeight: "80%", anchor: "center", margin: 1 },
		);
	}

	openOrchestrationDocumentViewer(documentTypes?: OrchestrationDocumentType[]): void {
		this.dependencies.overlayController.showCustomOverlay(
			"orc-document-viewer",
			new ArtifactViewer(
				this.dependencies.inventory.listOrchestrationDocumentViews(documentTypes),
				() => this.dependencies.overlayController.closeOverlay("orc-document-viewer"),
			),
			{ width: "85%", maxHeight: "80%", anchor: "center", margin: 1 },
		);
	}

	openHelpOverlay(): void {
		this.dependencies.overlayController.showCustomOverlay(
			"help",
			new HelpOverlay(() => this.dependencies.overlayController.closeOverlay("help")),
			{ width: "80%", maxHeight: "80%", anchor: "center", margin: 1 },
		);
	}

	showPlaceholderStatus(message: string): void {
		this.dependencies.stateStore.setStatusMessage(message);
	}
}
