import type { PiMonoAppDebugger } from "../app-debugger.js";
import type { AgentHost, AgentHostState } from "../agent-host.js";
import type { EditorController } from "../editor-controller.js";

export class AppSubmissionService {
	constructor(
		private readonly dependencies: {
			debuggerSink: PiMonoAppDebugger;
			host: AgentHost;
			editorController: EditorController;
			handleSlashCommand: (text: string) => Promise<boolean>;
			getHostState: () => AgentHostState | undefined;
		},
	) {}

	resetForStart(): void {
		// Submission no longer controls the bootstrap splash lifecycle.
	}

	async submitEditor(submittedText: string, streamingBehavior: "steer" | "followUp"): Promise<void> {
		const rawText = submittedText;
		const text = rawText.trim();
		this.dependencies.debuggerSink.log("editor.submit.attempt", {
			streamingBehavior,
			length: rawText.length,
			redacted: true,
		});

		if (!text) {
			return;
		}

		if (await this.dependencies.handleSlashCommand(text)) {
			return;
		}

		this.dependencies.editorController.addToHistory(text);
		this.dependencies.editorController.setText("");

		await this.dependencies.host.prompt(text, this.dependencies.getHostState()?.isStreaming ? { streamingBehavior } : undefined);
	}
}
