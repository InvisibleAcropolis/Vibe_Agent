import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentHostState } from "../agent-host.js";
import type { MessageRenderResult } from "../message-renderer.js";
import type { ShellView } from "../shell-view.js";
import type { NormalizedTranscript } from "../transcript-normalizer.js";
import type { NormalizedTranscriptPublication, TranscriptPublicationMode } from "../shell/transcript-publication.js";

interface TranscriptPublicationPacket {
	readonly messages: AgentMessage[];
	readonly hostState: AgentHostState;
	readonly normalizedTranscript: NormalizedTranscript;
	readonly renderResult: MessageRenderResult;
}

function supportsNormalizedPublication(shellView: ShellView): shellView is ShellView & {
	publishNormalizedTranscript: (publication: NormalizedTranscriptPublication) => void;
} {
	return typeof shellView.publishNormalizedTranscript === "function";
}

export function resolveTranscriptPublicationMode(value: string | undefined): TranscriptPublicationMode {
	switch (value?.toLowerCase()) {
		case "next":
			return "next";
		case "dual":
			return "dual";
		default:
			return "legacy";
	}
}

/**
 * Migration seam for transcript rendering.
 *
 * `legacy` preserves the existing `setMessages(...)` behavior.
 * `next` sends normalized transcript publications to shell adapters that opt in.
 * `dual` does both so rollout can validate parity before cut-over.
 */
export class TranscriptPublicationBridge {
	constructor(private readonly mode: TranscriptPublicationMode) {}

	publish(shellView: ShellView, packet: TranscriptPublicationPacket): void {
		if (this.mode === "legacy" || this.mode === "dual") {
			shellView.setMessages(packet.renderResult.components);
		}

		if (this.mode === "next" || this.mode === "dual") {
			if (supportsNormalizedPublication(shellView)) {
				shellView.publishNormalizedTranscript({
					messages: packet.messages,
					hostState: packet.hostState,
					normalizedTranscript: packet.normalizedTranscript,
				});
			} else if (this.mode === "next") {
				// Safety fallback while adapters migrate.
				shellView.setMessages(packet.renderResult.components);
			}
		}
	}
}
