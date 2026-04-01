import { ArtifactViewer } from "../components/artifact-viewer.js";
import { HelpOverlay } from "../components/help-overlay.js";
import { OrchestrationStatusPanel } from "../components/orchestration-status-panel.js";
import { SessionStatsOverlay } from "../components/session-stats-overlay.js";
import { WorkbenchInventoryService, type OrchestrationDocumentType } from "../durable/workbench-inventory-service.js";
import type { AgentHost, AgentHostState } from "../agent-host.js";
import type { AppStateStore } from "../app-state-store.js";
import type { FooterDataProvider } from "../footer-data-provider.js";
import type { OverlayController } from "../overlay-controller.js";
import type { ShellView } from "../shell-view.js";
import { createOrcTrackerDashboardViewModel } from "../orchestration/orc-tracker.js";
import type { Artifact } from "../types.js";
import { toOpenTuiDocumentItems, type OpenTuiOverlayModel } from "../shell-opentui/overlay-models.js";

export class CommandOverlayService {
	constructor(
		private readonly dependencies: {
			host: AgentHost;
			overlayController: OverlayController;
			stateStore: AppStateStore;
			footerData: FooterDataProvider;
			shellView: ShellView;
			inventory: WorkbenchInventoryService;
			getHostState: () => AgentHostState | undefined;
			onError: (context: string, error: unknown, details?: Record<string, unknown>) => void;
		},
	) {}

	openOrcDashboard(): void {
		if (this.dependencies.shellView.implementation === "opentui") {
			const model = createOrcTrackerDashboardViewModel();
			const lines = [
				"Orc remains a separate product window from Coding Chat.",
				"Use F3 > Summon Orc to open or refocus the dedicated Orc session.",
				"",
				`Threads: ${String((model as { threads?: unknown[] }).threads?.length ?? 0)}`,
				`Workers: ${String((model as { workers?: unknown[] }).workers?.length ?? 0)}`,
				`Checkpoints: ${String((model as { checkpoints?: unknown[] }).checkpoints?.length ?? 0)}`,
			];
			this.showOpenTuiOverlay("orc-dashboard", {
				kind: "text",
				title: "Orc Status",
				description: "Coding Chat does not embed Orc dashboards.",
				lines,
			});
			return;
		}
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
			if (this.dependencies.shellView.implementation === "opentui") {
				this.showOpenTuiOverlay("session-stats", {
					kind: "text",
					title: "Session Statistics",
					description: "Live session usage and runtime metadata.",
					lines: this.buildStatsLines(stats as unknown as Record<string, unknown>, hostState, gitBranch),
				});
				return;
			}
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
		if (this.dependencies.shellView.implementation === "opentui") {
			this.showArtifactDocuments("artifact-viewer", "Artifacts", "Generated and modified files from the active coding session.", this.dependencies.inventory.listArtifactViews());
			return;
		}
		this.dependencies.overlayController.showCustomOverlay(
			"artifact-viewer",
			new ArtifactViewer(this.dependencies.inventory.listArtifactViews(), () => this.dependencies.overlayController.closeOverlay("artifact-viewer")),
			{ width: "85%", maxHeight: "80%", anchor: "center", margin: 1 },
		);
	}

	openOrchestrationDocumentViewer(documentTypes?: OrchestrationDocumentType[]): void {
		if (this.dependencies.shellView.implementation === "opentui") {
			this.showArtifactDocuments(
				"orc-document-viewer",
				"Orchestration Documents",
				"Generated tracker, research, roadmap, and manifest artifacts.",
				this.dependencies.inventory.listOrchestrationDocumentViews(documentTypes),
			);
			return;
		}
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
		if (this.dependencies.shellView.implementation === "opentui") {
			this.showOpenTuiOverlay("help", {
				kind: "text",
				title: "Help",
				description: "Core keybindings and slash commands for the OpenTUI coding chat.",
				lines: this.buildHelpLines(),
			});
			return;
		}
		this.dependencies.overlayController.showCustomOverlay(
			"help",
			new HelpOverlay(() => this.dependencies.overlayController.closeOverlay("help")),
			{ width: "80%", maxHeight: "80%", anchor: "center", margin: 1 },
		);
	}

	openFloatingAnimboxTest(): void {
		if (this.dependencies.shellView.implementation !== "opentui") {
			this.showPlaceholderStatus("Floating Animbox Test is available only in the OpenTUI coding chat.");
			return;
		}
		this.showOpenTuiOverlay("floating-animbox-test", {
			kind: "floating-animbox",
			title: "Floating Animbox Test",
			description: "Live plasma animation host for future Orc telemetry and metering.",
			sourceFile: "src/components/anim_plasma.ts",
			exportName: "renderPlasma",
			presetId: "default",
			cols: 40,
			rows: 12,
			x: 10,
			y: 5,
		});
		this.dependencies.stateStore.setStatusMessage("Opened Floating Animbox Test.");
	}

	showPlaceholderStatus(message: string): void {
		this.dependencies.stateStore.setStatusMessage(message);
	}

	private showOpenTuiOverlay(id: string, model: OpenTuiOverlayModel): void {
		this.dependencies.overlayController.showCustomOverlay(id, model, {
			width: "85%",
			maxHeight: "80%",
			anchor: "center",
			margin: 1,
		});
	}

	private showArtifactDocuments(id: string, title: string, description: string, artifacts: readonly Artifact[]): void {
		this.showOpenTuiOverlay(id, {
			kind: "document",
			title,
			description,
			items: toOpenTuiDocumentItems(artifacts, "artifact"),
			emptyMessage: "No documents available yet.",
		});
	}

	private buildStatsLines(stats: Record<string, unknown>, hostState: AgentHostState | undefined, gitBranch: string | null): string[] {
		const tokens = (stats.tokens as Record<string, unknown> | undefined) ?? {};
		return [
			`Session: ${String(stats.sessionId ?? "unknown")}`,
			hostState?.sessionName ? `Name: ${hostState.sessionName}` : undefined,
			stats.sessionFile ? `File: ${String(stats.sessionFile)}` : undefined,
			gitBranch ? `Git branch: ${gitBranch}` : undefined,
			"",
			hostState?.model ? `Model: ${hostState.model.provider}/${hostState.model.id}` : undefined,
			hostState ? `Thinking: ${hostState.thinkingLevel}` : undefined,
			hostState ? `Streaming: ${hostState.isStreaming ? "yes" : "no"}` : undefined,
			"",
			`Messages: ${String(stats.totalMessages ?? 0)}`,
			`User messages: ${String(stats.userMessages ?? 0)}`,
			`Assistant messages: ${String(stats.assistantMessages ?? 0)}`,
			`Tool calls: ${String(stats.toolCalls ?? 0)}`,
			`Tool results: ${String(stats.toolResults ?? 0)}`,
			"",
			`Input tokens: ${String(tokens.input ?? 0)}`,
			`Output tokens: ${String(tokens.output ?? 0)}`,
			`Cache read: ${String(tokens.cacheRead ?? 0)}`,
			`Cache write: ${String(tokens.cacheWrite ?? 0)}`,
			`Total tokens: ${String(tokens.total ?? 0)}`,
			stats.cost !== undefined ? `Cost: $${Number(stats.cost).toFixed(4)}` : undefined,
		].filter((line): line is string => line !== undefined);
	}

	private buildHelpLines(): string[] {
		return [
			"Global",
			"  F1 settings menu",
			"  F2 sessions menu",
			"  F3 Orc menu / launch entry points",
			"  Esc on empty composer opens command palette",
			"  Shift+Ctrl+D writes a debug snapshot",
			"",
			"Composer",
			"  Enter sends the current prompt",
			"  Shift+Enter inserts a newline",
			"  Ctrl+Enter sends follow-up mode",
			"  Ctrl+L opens model selection",
			"  Ctrl+T toggles thinking visibility",
			"  Ctrl+O toggles tool output expansion",
			"",
			"Transcript",
			"  PageUp / PageDown scroll",
			"  Home jumps to top",
			"  End jumps to bottom and restores follow mode",
			"",
			"Commands",
			"  /settings opens settings",
			"  /resume switches sessions",
			"  /artifacts opens artifact browser",
			"  /stats opens session statistics",
			"  /help opens this help overlay",
			"  /animbox-test opens the floating animation test overlay",
			"",
			"Orc",
			"  Coding Chat does not embed Orc panels.",
			"  Use F3 > Summon Orc to open the dedicated Orc window.",
		];
	}
}
