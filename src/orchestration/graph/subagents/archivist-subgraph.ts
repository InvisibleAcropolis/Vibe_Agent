import type {
	OrcMemoryBackendRoute,
	OrcMemoryRetrievalResult,
	OrcMemorySourceProvenance,
} from "../../memory/index.js";

export type ArchivistSubgraphNodeId = "retrieve_semantic_context" | "compress_history" | "inject_orc_context" | "complete";

export interface OrcArchivistContextSnippet {
	id: string;
	summary: string;
	confidenceHint: "low" | "medium" | "high";
	provenance: OrcMemorySourceProvenance;
}

export interface OrcArchivistContextInjection {
	summary: string;
	snippets: OrcArchivistContextSnippet[];
	truncated: boolean;
	charBudget: number;
}

export interface ArchivistSubgraphState {
	threadId: string;
	taskId: string;
	next: ArchivistSubgraphNodeId;
	query: string;
	memoryRoute: OrcMemoryBackendRoute;
	maxSources: number;
	maxSummaryChars: number;
	retrieval?: OrcMemoryRetrievalResult;
	contextInjection?: OrcArchivistContextInjection;
	completionSummary?: string;
}

export interface ArchivistSubgraphExecutors {
	retrieveSemanticMemory(state: Readonly<ArchivistSubgraphState>): Promise<OrcMemoryRetrievalResult>;
	emitContextInjection?(state: Readonly<ArchivistSubgraphState>, injection: OrcArchivistContextInjection): Promise<void>;
}

export interface ArchivistSubgraph {
	step(state: ArchivistSubgraphState): Promise<ArchivistSubgraphState>;
}

function compressSummary(input: string, maxSummaryChars: number): { summary: string; truncated: boolean } {
	if (input.length <= maxSummaryChars) {
		return { summary: input, truncated: false };
	}
	return {
		summary: `${input.slice(0, Math.max(0, maxSummaryChars - 1)).trimEnd()}…`,
		truncated: true,
	};
}

export function createArchivistSubgraph(config: { executors: ArchivistSubgraphExecutors }): ArchivistSubgraph {
	async function runRetrieveSemanticContextNode(state: ArchivistSubgraphState): Promise<ArchivistSubgraphState> {
		const retrieval = await config.executors.retrieveSemanticMemory(state);
		return {
			...state,
			next: "compress_history",
			retrieval,
		};
	}

	async function runCompressHistoryNode(state: ArchivistSubgraphState): Promise<ArchivistSubgraphState> {
		const retrieval = state.retrieval;
		if (!retrieval) {
			throw new Error("Archivist compress_history blocked: retrieval output is missing.");
		}
		const snippets = retrieval.hits.slice(0, Math.max(1, state.maxSources)).map((hit) => ({
			id: hit.id,
			summary: hit.snippet,
			confidenceHint: hit.confidenceHint,
			provenance: hit.provenance,
		}));
		const mergedSummary = snippets
			.map((snippet, index) => {
				const source =
					snippet.provenance.sourcePath
					?? [snippet.provenance.threadId, snippet.provenance.agentId, snippet.provenance.paneId].filter(Boolean).join("/");
				return `${index + 1}. ${snippet.summary} (confidence=${snippet.confidenceHint}; source=${source || "unknown"})`;
			})
			.join(" ");
		const compressed = compressSummary(mergedSummary, Math.max(120, state.maxSummaryChars));
		return {
			...state,
			next: "inject_orc_context",
			contextInjection: {
				summary: compressed.summary,
				snippets,
				truncated: compressed.truncated || retrieval.hits.length > snippets.length,
				charBudget: state.maxSummaryChars,
			},
		};
	}

	async function runInjectOrcContextNode(state: ArchivistSubgraphState): Promise<ArchivistSubgraphState> {
		if (!state.contextInjection) {
			throw new Error("Archivist inject_orc_context blocked: context injection is missing.");
		}
		await config.executors.emitContextInjection?.(state, state.contextInjection);
		return {
			...state,
			next: "complete",
			completionSummary: `Archivist injected ${state.contextInjection.snippets.length} summarized memory snippet(s) via ${state.memoryRoute.mode} backend.`,
		};
	}

	return {
		async step(state: ArchivistSubgraphState): Promise<ArchivistSubgraphState> {
			switch (state.next) {
				case "retrieve_semantic_context":
					return runRetrieveSemanticContextNode(state);
				case "compress_history":
					return runCompressHistoryNode(state);
				case "inject_orc_context":
					return runInjectOrcContextNode(state);
				case "complete":
					return state;
				default: {
					const exhaustiveGuard: never = state.next;
					throw new Error(`Unknown node: ${String(exhaustiveGuard)}`);
				}
			}
		},
	};
}
