import type { AgentMessage } from "@mariozechner/pi-agent-core";
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
			getFocusedComponentLabel: () => string | undefined;
			getRuntimeContext: () => { runtimeId: string; sessionId?: string };
		},
	) {}

	write(reason: string): string | undefined {
		try {
			const snapshot = this.dependencies.shellView.getDebugSnapshot();
			const bundleDir = this.dependencies.debuggerSink.writeSnapshot({
				reason,
				renderedLines: snapshot.lines,
				viewport: { width: snapshot.width, height: snapshot.height },
				messages: this.dependencies.getMessages(),
				hostState: this.dependencies.getHostState(),
				statusMessage: this.dependencies.stateStore.getState().statusMessage,
				workingMessage: this.dependencies.stateStore.getState().workingMessage,
				helpMessage: this.dependencies.stateStore.getState().helpMessage,
				focusedLabel: this.dependencies.getFocusedComponentLabel(),
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
