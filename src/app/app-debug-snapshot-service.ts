import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { Component } from "@mariozechner/pi-tui";
import type { PiMonoAppDebugger } from "../app-debugger.js";
import type { AgentHostState } from "../agent-host.js";
import type { AppStateStore } from "../app-state-store.js";
import type { EditorController } from "../editor-controller.js";
import { LogCatalogService } from "../durable/logs/log-catalog-service.js";
import type { ShellView } from "../shell-view.js";

export class AppDebugSnapshotService {
	constructor(
		private readonly dependencies: {
			debuggerSink: PiMonoAppDebugger;
			shellView: ShellView;
			stateStore: AppStateStore;
			editorController: EditorController;
			logCatalogService: LogCatalogService;
			getMessages: () => AgentMessage[];
			getHostState: () => AgentHostState | undefined;
			getFocusedComponent: () => Component | null;
			getRuntimeContext: () => { runtimeId: string; sessionId?: string };
		},
	) {}

	write(reason: string): string | undefined {
		try {
			const bundleDir = this.dependencies.debuggerSink.writeSnapshot({
				reason,
				tui: this.dependencies.shellView.tui,
				messages: this.dependencies.getMessages(),
				hostState: this.dependencies.getHostState(),
				statusMessage: this.dependencies.stateStore.getState().statusMessage,
				workingMessage: this.dependencies.stateStore.getState().workingMessage,
				helpMessage: this.dependencies.stateStore.getState().helpMessage,
				focusedComponent: this.dependencies.getFocusedComponent(),
				editorText: this.dependencies.editorController.getText(),
				editorCursor: this.dependencies.editorController.getCursor(),
			});
			if (bundleDir) {
				this.dependencies.logCatalogService.registerLog({
					ownerRuntimeId: this.dependencies.getRuntimeContext().runtimeId,
					sessionId: this.dependencies.getHostState()?.sessionId,
					sourcePath: bundleDir,
					logType: "debug-snapshot",
					label: "Debug Snapshot",
					reason,
				});
			}
			this.dependencies.debuggerSink.log("app.snapshot.complete", { reason, bundleDir });
			return bundleDir;
		} catch (error) {
			this.dependencies.debuggerSink.logError("app.snapshot", error, { reason });
			return undefined;
		}
	}
}
