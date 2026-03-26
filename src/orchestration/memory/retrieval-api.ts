import type {
	OrcMemoryArtifactBundle,
	OrcMemoryBackendRoute,
	OrcMemoryRetrievalHit,
	OrcMemoryRetrievalResult,
} from "./types.js";

export interface OrcMemoryRetrievalRequest {
	route: OrcMemoryBackendRoute;
	query: string;
	threadId: string;
	maxHits?: number;
}

export interface OrcFilesystemRetrievalBackend {
	mode: "filesystem";
	retrieve(input: OrcMemoryRetrievalRequest): Promise<OrcMemoryRetrievalResult>;
}

export interface OrcVectorRetrievalBackend {
	mode: "vector";
	retrieve(input: OrcMemoryRetrievalRequest): Promise<OrcMemoryRetrievalResult>;
}

export type OrcMemoryRetrievalBackend = OrcFilesystemRetrievalBackend | OrcVectorRetrievalBackend;

function normalizeHitSnippet(snippet: string): string {
	return snippet.replace(/\s+/g, " ").trim();
}

function inferConfidence(score?: number): "low" | "medium" | "high" {
	if (typeof score !== "number") {
		return "medium";
	}
	if (score >= 0.85) {
		return "high";
	}
	if (score >= 0.6) {
		return "medium";
	}
	return "low";
}

export function createFilesystemMemoryRetrievalBackend(deps: {
	listBundles(threadId: string): Promise<ReadonlyArray<{ coordinates: { threadId: string; agentId: string; paneId: string }; bundle: OrcMemoryArtifactBundle }>>;
	now?: () => Date;
}): OrcFilesystemRetrievalBackend {
	const now = deps.now ?? (() => new Date());
	return {
		mode: "filesystem",
		async retrieve(input) {
			const maxHits = Math.max(1, input.maxHits ?? 6);
			const bundles = await deps.listBundles(input.threadId);
			const hits: OrcMemoryRetrievalHit[] = [];
			for (const entry of bundles) {
				const findingRecords = entry.bundle.subagentFindings?.findings ?? [];
				for (const finding of findingRecords) {
					if (!finding.summary.toLowerCase().includes(input.query.toLowerCase())) {
						continue;
					}
					hits.push({
						id: finding.id,
						snippet: normalizeHitSnippet(`${finding.summary}. Evidence: ${finding.evidence.join("; ")}`),
						confidenceHint: finding.confidence ?? "medium",
						provenance: {
							backend: "filesystem",
							recordKind: "subagent_findings",
							threadId: entry.coordinates.threadId,
							agentId: entry.coordinates.agentId,
							paneId: entry.coordinates.paneId,
						},
					});
				}
				const summary = entry.bundle.handoffSummary?.summary;
				if (summary && summary.toLowerCase().includes(input.query.toLowerCase())) {
					hits.push({
						id: `${entry.coordinates.agentId}:${entry.coordinates.paneId}:handoff`,
						snippet: normalizeHitSnippet(summary),
						confidenceHint: "medium",
						provenance: {
							backend: "filesystem",
							recordKind: "handoff_summary",
							threadId: entry.coordinates.threadId,
							agentId: entry.coordinates.agentId,
							paneId: entry.coordinates.paneId,
						},
					});
				}
			}
			return {
				backend: "filesystem",
				query: input.query,
				retrievedAt: now().toISOString(),
				hits: hits.slice(0, maxHits),
			};
		},
	};
}

export function createVectorMemoryRetrievalBackend(deps: {
	search(input: { namespace?: string; query: string; threadId: string; topK: number }): Promise<
		ReadonlyArray<{ id: string; snippet: string; score?: number; sourcePath?: string; vectorDocumentId?: string }>
	>;
	now?: () => Date;
}): OrcVectorRetrievalBackend {
	const now = deps.now ?? (() => new Date());
	return {
		mode: "vector",
		async retrieve(input) {
			const topK = Math.max(1, input.maxHits ?? 6);
			const rows = await deps.search({
				namespace: input.route.namespace,
				query: input.query,
				threadId: input.threadId,
				topK,
			});
			return {
				backend: "vector",
				query: input.query,
				retrievedAt: now().toISOString(),
				hits: rows.slice(0, topK).map((row) => ({
					id: row.id,
					snippet: normalizeHitSnippet(row.snippet),
					score: row.score,
					confidenceHint: inferConfidence(row.score),
					provenance: {
						backend: "vector",
						threadId: input.threadId,
						sourcePath: row.sourcePath,
						vectorDocumentId: row.vectorDocumentId,
					},
				})),
			};
		},
	};
}

export async function retrieveOrcMemory(
	input: OrcMemoryRetrievalRequest,
	backends: ReadonlyArray<OrcMemoryRetrievalBackend>,
): Promise<OrcMemoryRetrievalResult> {
	const backend = backends.find((candidate) => candidate.mode === input.route.mode);
	if (!backend) {
		throw new Error(`No memory retrieval backend is registered for mode '${input.route.mode}'.`);
	}
	return backend.retrieve(input);
}
