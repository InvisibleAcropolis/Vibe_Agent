import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentHostState } from "../agent-host.js";
import type { NormalizedTranscript } from "../transcript-normalizer.js";

export type TranscriptPublicationMode = "legacy" | "next" | "dual";

export interface NormalizedTranscriptPublication {
	readonly messages: AgentMessage[];
	readonly hostState: AgentHostState;
	readonly normalizedTranscript: NormalizedTranscript;
}
