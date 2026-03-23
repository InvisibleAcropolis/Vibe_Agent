import type { Component } from "@mariozechner/pi-tui";
import { TranscriptViewport } from "../components/transcript-viewport.js";
import type { TranscriptMouseInput } from "./shell-types.js";

export class ShellTranscriptController {
	constructor(private readonly transcriptViewport: TranscriptViewport) {}

	setMessages(components: Component[]): void {
		this.transcriptViewport.setComponents(components);
	}

	clearMessages(): void {
		this.transcriptViewport.setComponents([]);
	}

	setViewportHeight(height: number): void {
		this.transcriptViewport.setViewportHeight(height);
	}

	measure(width: number) {
		return this.transcriptViewport.measure(width);
	}

	getState() {
		return this.transcriptViewport.getState();
	}

	scrollBy(lines: number): void {
		this.transcriptViewport.scrollBy(lines);
	}

	scrollToTop(): void {
		this.transcriptViewport.scrollToTop();
	}

	scrollToBottom(): void {
		this.transcriptViewport.scrollToBottom();
	}

	dispatchMouse(input: TranscriptMouseInput): boolean {
		if (input.event.action !== "scroll") {
			return false;
		}
		const inside =
			input.event.row >= input.rect.row &&
			input.event.row < input.rect.row + input.rect.height &&
			input.event.col >= input.rect.col &&
			input.event.col < input.rect.col + input.rect.width;
		if (!inside) {
			return false;
		}
		this.scrollBy(input.event.button === "wheelUp" ? -3 : 3);
		return true;
	}
}
