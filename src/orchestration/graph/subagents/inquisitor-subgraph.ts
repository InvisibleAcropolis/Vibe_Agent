export type InquisitorFailureCategory = "test_failure" | "runtime_error" | "infrastructure_error" | "unknown";

export interface FailureDossier {
	failureCategory: InquisitorFailureCategory;
	stackTrace: string;
	payload: Record<string, unknown>;
	failedAt: string;
}

export type InquisitorSubgraphNodeId = "generate_tests" | "execute_tests" | "route_failure" | "complete";

export interface InquisitorSubgraphState {
	threadId: string;
	taskId: string;
	next: InquisitorSubgraphNodeId;
	attemptCount: number;
	generatedArtifacts: string[];
	latestTestCommand?: string;
	failureDossier?: FailureDossier;
	completionSummary?: string;
}

export interface InquisitorSubgraphExecutors {
	generateTests(state: Readonly<InquisitorSubgraphState>): Promise<{ generatedArtifacts: string[]; testCommand?: string }>;
	executeTests(state: Readonly<InquisitorSubgraphState>): Promise<{
		success: boolean;
		stackTrace?: string;
		payload?: unknown;
		failureCategory?: InquisitorFailureCategory;
	}>;
	routeFailureToMechanic?(state: Readonly<InquisitorSubgraphState>, dossier: FailureDossier): Promise<void>;
	emitValidationSuccessToOrc?(state: Readonly<InquisitorSubgraphState>): Promise<void>;
}

export interface InquisitorSubgraph {
	step(state: InquisitorSubgraphState): Promise<InquisitorSubgraphState>;
}

const TEST_ARTIFACT_PATTERN = /(^|\/)test(s)?\//i;
const TEST_FILE_PATTERN = /(?:^|\/).+\.(?:test|spec)\.[cm]?[jt]sx?$/i;

function normalizeArtifacts(files: string[]): string[] {
	return Array.from(new Set(files.map((entry) => entry.trim()).filter((entry) => entry.length > 0))).sort();
}

function assertTestOnlyArtifacts(files: string[]): void {
	const nonTestArtifacts = files.filter((entry) => !TEST_ARTIFACT_PATTERN.test(entry) && !TEST_FILE_PATTERN.test(entry));
	if (nonTestArtifacts.length > 0) {
		throw new Error(`Inquisitor cannot mutate production code directly. Non-test artifacts detected: ${nonTestArtifacts.join(", ")}`);
	}
}

function normalizeFailureDossier(params: {
	failureCategory?: InquisitorFailureCategory;
	stackTrace?: string;
	payload?: unknown;
	now: () => Date;
}): FailureDossier {
	const normalizedPayload =
		params.payload && typeof params.payload === "object" && !Array.isArray(params.payload)
			? (params.payload as Record<string, unknown>)
			: { rawPayload: params.payload ?? null };
	return {
		failureCategory: params.failureCategory ?? "unknown",
		stackTrace: (params.stackTrace ?? "No stack trace captured.").trim() || "No stack trace captured.",
		payload: normalizedPayload,
		failedAt: params.now().toISOString(),
	};
}

export function createInquisitorSubgraph(config: {
	executors: InquisitorSubgraphExecutors;
	now?: () => Date;
}): InquisitorSubgraph {
	const now = config.now ?? (() => new Date());

	async function runGenerateTestsNode(state: InquisitorSubgraphState): Promise<InquisitorSubgraphState> {
		const generation = await config.executors.generateTests(state);
		const generatedArtifacts = normalizeArtifacts([...state.generatedArtifacts, ...generation.generatedArtifacts]);
		assertTestOnlyArtifacts(generatedArtifacts);
		return {
			...state,
			next: "execute_tests",
			attemptCount: state.attemptCount + 1,
			generatedArtifacts,
			latestTestCommand: generation.testCommand,
		};
	}

	async function runExecuteTestsNode(state: InquisitorSubgraphState): Promise<InquisitorSubgraphState> {
		const execution = await config.executors.executeTests(state);
		if (execution.success) {
			await config.executors.emitValidationSuccessToOrc?.(state);
			return {
				...state,
				next: "complete",
				failureDossier: undefined,
				completionSummary: `Validation success emitted to Orc on attempt ${state.attemptCount}.`,
			};
		}

		return {
			...state,
			next: "route_failure",
			failureDossier: normalizeFailureDossier({
				failureCategory: execution.failureCategory,
				stackTrace: execution.stackTrace,
				payload: execution.payload,
				now,
			}),
		};
	}

	async function runRouteFailureNode(state: InquisitorSubgraphState): Promise<InquisitorSubgraphState> {
		const dossier = state.failureDossier
			?? normalizeFailureDossier({
				failureCategory: "unknown",
				stackTrace: undefined,
				payload: undefined,
				now,
			});
		await config.executors.routeFailureToMechanic?.(state, dossier);
		return {
			...state,
			next: "generate_tests",
			failureDossier: dossier,
		};
	}

	return {
		async step(state: InquisitorSubgraphState): Promise<InquisitorSubgraphState> {
			switch (state.next) {
				case "generate_tests":
					return runGenerateTestsNode(state);
				case "execute_tests":
					return runExecuteTestsNode(state);
				case "route_failure":
					return runRouteFailureNode(state);
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
