import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { extractArtifactRecords, type ArtifactExtractionContext, type ArtifactRecord } from "./artifact-extractor.js";

export class ArtifactCatalogService {
	private readonly recordsByScope = new Map<string, ArtifactRecord[]>();

	replaceFromMessages(context: ArtifactExtractionContext, messages: AgentMessage[]): ArtifactRecord[] {
		const records = extractArtifactRecords(messages, context);
		this.recordsByScope.set(this.scopeKey(context), records);
		return records;
	}

	list(): ArtifactRecord[] {
		return [...this.recordsByScope.values()].flat();
	}

	clear(): void {
		this.recordsByScope.clear();
	}

	private scopeKey(context: ArtifactExtractionContext): string {
		return `${context.runtimeId}:${context.sessionId ?? "session"}`;
	}
}
