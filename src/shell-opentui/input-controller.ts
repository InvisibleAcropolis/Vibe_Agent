import type { InputController } from "../input-controller.js";

type TerminalInputHandler = (data: string) => { consume?: boolean; data?: string } | undefined;

export class OpenTuiInputController implements InputController {
	private readonly terminalInputHandlers = new Set<TerminalInputHandler>();

	attach(): void {}

	registerTerminalInputHandler(handler: TerminalInputHandler): () => void {
		this.terminalInputHandlers.add(handler);
		return () => this.terminalInputHandlers.delete(handler);
	}
}
