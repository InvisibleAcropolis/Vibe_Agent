export type ScribeSubgraphNodeId = "hydrate_context" | "update_docs" | "emit_diff_summary" | "complete";

/**
 * Finalized implementation payload that Scribe consumes after Mechanic/Inquisitor
 * produce stable code and verification outcomes.
 */
export interface ScribeImplementationContext {
	featureId: string;
	summary: string;
	publicInterfaces: string[];
	implementationCoordinates: string[];
	astSnapshotRef?: string;
	readmeSections: string[];
	architectureNotes: string[];
}

export interface ScribeDiffSummaryArtifact {
	artifactId: string;
	path: string;
	summary: string;
	changedDocPaths: string[];
	createdAt: string;
}

/**
 * Deterministic Scribe state machine for doc publication:
 * 1) hydrate finalized implementation context/AST references
 * 2) update docstrings/API docs/README + architecture notes
 * 3) emit diff-summary artifact
 * 4) return success signal required by Orc completion
 */
export interface ScribeSubgraphState {
	threadId: string;
	taskId: string;
	next: ScribeSubgraphNodeId;
	implementationContext?: ScribeImplementationContext;
	updatedDocTargets: string[];
	diffSummaryArtifact?: ScribeDiffSummaryArtifact;
	successSignal: boolean;
	completionSummary?: string;
}

export interface ScribeSubgraphExecutors {
	hydrateContext(state: Readonly<ScribeSubgraphState>): Promise<{ implementationContext: ScribeImplementationContext }>;
	updateDocs(
		state: Readonly<ScribeSubgraphState>,
		context: Readonly<ScribeImplementationContext>,
	): Promise<{ updatedDocTargets: string[] }>;
	emitDiffSummaryArtifact(
		state: Readonly<ScribeSubgraphState>,
		context: Readonly<ScribeImplementationContext>,
		updatedDocTargets: readonly string[],
	): Promise<{ artifact: ScribeDiffSummaryArtifact }>;
}

export interface ScribeSubgraph {
	step(state: ScribeSubgraphState): Promise<ScribeSubgraphState>;
}

function normalizePaths(paths: readonly string[]): string[] {
	return Array.from(new Set(paths.map((entry) => entry.trim()).filter((entry) => entry.length > 0))).sort();
}

function assertPublicInterfacesDocumented(context: ScribeImplementationContext, updatedDocTargets: readonly string[]): void {
	const interfaceDocTargets = updatedDocTargets.filter((entry) => /(?:^|\/)src\//.test(entry) || /api/i.test(entry));
	if (context.publicInterfaces.length > 0 && interfaceDocTargets.length === 0) {
		throw new Error("Scribe completion blocked: updated docs must include public interface/API documentation targets.");
	}
}

function assertReadmeAndArchitectureDocumented(context: ScribeImplementationContext, updatedDocTargets: readonly string[]): void {
	if (context.readmeSections.length > 0 && !updatedDocTargets.some((entry) => /README\.md$/i.test(entry))) {
		throw new Error("Scribe completion blocked: README updates are required for this feature scope.");
	}
	if (context.architectureNotes.length > 0 && !updatedDocTargets.some((entry) => /docs\/orchestration\//i.test(entry))) {
		throw new Error("Scribe completion blocked: architecture notes must be updated for this feature scope.");
	}
}

export function createScribeSubgraph(config: {
	executors: ScribeSubgraphExecutors;
	now?: () => Date;
}): ScribeSubgraph {
	const now = config.now ?? (() => new Date());

	async function runHydrateContextNode(state: ScribeSubgraphState): Promise<ScribeSubgraphState> {
		const hydrated = await config.executors.hydrateContext(state);
		return {
			...state,
			next: "update_docs",
			implementationContext: hydrated.implementationContext,
		};
	}

	async function runUpdateDocsNode(state: ScribeSubgraphState): Promise<ScribeSubgraphState> {
		if (!state.implementationContext) {
			throw new Error("Scribe update_docs blocked: implementation context is missing.");
		}
		const updateResult = await config.executors.updateDocs(state, state.implementationContext);
		const updatedDocTargets = normalizePaths(updateResult.updatedDocTargets);
		assertPublicInterfacesDocumented(state.implementationContext, updatedDocTargets);
		assertReadmeAndArchitectureDocumented(state.implementationContext, updatedDocTargets);
		return {
			...state,
			next: "emit_diff_summary",
			updatedDocTargets,
		};
	}

	async function runEmitDiffSummaryNode(state: ScribeSubgraphState): Promise<ScribeSubgraphState> {
		if (!state.implementationContext) {
			throw new Error("Scribe emit_diff_summary blocked: implementation context is missing.");
		}
		if (state.updatedDocTargets.length === 0) {
			throw new Error("Scribe emit_diff_summary blocked: no documentation targets were updated.");
		}
		const result = await config.executors.emitDiffSummaryArtifact(state, state.implementationContext, state.updatedDocTargets);
		return {
			...state,
			next: "complete",
			diffSummaryArtifact: result.artifact,
			successSignal: true,
			completionSummary: `Scribe updated ${state.updatedDocTargets.length} documentation target(s) and emitted diff artifact ${result.artifact.artifactId} at ${now().toISOString()}.`,
		};
	}

	return {
		async step(state: ScribeSubgraphState): Promise<ScribeSubgraphState> {
			switch (state.next) {
				case "hydrate_context":
					return runHydrateContextNode(state);
				case "update_docs":
					return runUpdateDocsNode(state);
				case "emit_diff_summary":
					return runEmitDiffSummaryNode(state);
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
