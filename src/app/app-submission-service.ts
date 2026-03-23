import type { PiMonoAppDebugger } from "../app-debugger.js";
import type { AgentHost, AgentHostState } from "../agent-host.js";
import type { EditorController } from "../editor-controller.js";
import { LogoBlockSystem } from "../logo-block-system.js";

export class AppSubmissionService {
	private bootLogoDismissed = false;

	constructor(
		private readonly dependencies: {
			debuggerSink: PiMonoAppDebugger;
			host: AgentHost;
			editorController: EditorController;
			logoBlockSystem: LogoBlockSystem;
			handleSlashCommand: (text: string) => Promise<boolean>;
			getHostState: () => AgentHostState | undefined;
		},
	) {}

	resetForStart(): void {
		this.bootLogoDismissed = false;
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
		if (!this.bootLogoDismissed) {
			this.bootLogoDismissed = true;
			this.dependencies.logoBlockSystem.dismiss();
		}

		await this.dependencies.host.prompt(text, this.dependencies.getHostState()?.isStreaming ? { streamingBehavior } : undefined);
	}
}
