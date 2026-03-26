export type MechanicSubgraphNodeId = "edit" | "verify" | "escalate" | "complete";

export interface MechanicVerificationDiagnostic {
	tool: "lint" | "compile";
	severity: "error" | "warning";
	code?: string;
	message: string;
	file?: string;
	line?: number;
	column?: number;
}

export interface MechanicEscalationPayload {
	reason: "retry_ceiling_reached";
	attemptCount: number;
	maxAttempts: number;
	lastError: string;
	changedFiles: string[];
	diagnostics: MechanicVerificationDiagnostic[];
	escalatedTo: "orc";
	escalatedAt: string;
}

export interface MechanicSubgraphState {
	threadId: string;
	taskId: string;
	next: MechanicSubgraphNodeId;
	attemptCount: number;
	maxAttempts: number;
	lastError?: string;
	changedFiles: string[];
	verificationDiagnostics: MechanicVerificationDiagnostic[];
	escalation?: MechanicEscalationPayload;
	completionSummary?: string;
}

export interface MechanicSubgraphExecutors {
	edit(state: Readonly<MechanicSubgraphState>): Promise<{ changedFiles: string[] }>;
	verify(state: Readonly<MechanicSubgraphState>): Promise<{ success: boolean; diagnostics: MechanicVerificationDiagnostic[] }>;
	escalateToOrc?(state: Readonly<MechanicSubgraphState>, payload: MechanicEscalationPayload): Promise<void>;
}

export interface MechanicSubgraph {
	step(state: MechanicSubgraphState): Promise<MechanicSubgraphState>;
}

const HARD_RETRY_CEILING = 3;

function normalizeChangedFiles(files: string[]): string[] {
	return Array.from(new Set(files.map((entry) => entry.trim()).filter((entry) => entry.length > 0))).sort();
}

function formatLastError(diagnostics: MechanicVerificationDiagnostic[]): string {
	if (diagnostics.length === 0) return "Verification failed with no diagnostics.";
	const first = diagnostics[0];
	return `${first.tool}:${first.code ?? "UNKNOWN"}: ${first.message}`;
}

export function createMechanicSubgraph(config: {
	executors: MechanicSubgraphExecutors;
	now?: () => Date;
}): MechanicSubgraph {
	const now = config.now ?? (() => new Date());

	async function runEditNode(state: MechanicSubgraphState): Promise<MechanicSubgraphState> {
		if (state.attemptCount >= state.maxAttempts) {
			return {
				...state,
				next: "escalate",
			};
		}
		const editResult = await config.executors.edit(state);
		const changedFiles = normalizeChangedFiles([...state.changedFiles, ...editResult.changedFiles]);
		return {
			...state,
			next: "verify",
			attemptCount: state.attemptCount + 1,
			changedFiles,
		};
	}

	async function runVerifyNode(state: MechanicSubgraphState): Promise<MechanicSubgraphState> {
		const verification = await config.executors.verify(state);
		if (verification.success) {
			return {
				...state,
				next: "complete",
				verificationDiagnostics: verification.diagnostics,
				completionSummary: `Mechanic verification passed on attempt ${state.attemptCount}.`,
			};
		}

		const retryAllowed = state.attemptCount < state.maxAttempts;
		return {
			...state,
			next: retryAllowed ? "edit" : "escalate",
			verificationDiagnostics: verification.diagnostics,
			lastError: formatLastError(verification.diagnostics),
		};
	}

	async function runEscalateNode(state: MechanicSubgraphState): Promise<MechanicSubgraphState> {
		const payload: MechanicEscalationPayload = {
			reason: "retry_ceiling_reached",
			attemptCount: state.attemptCount,
			maxAttempts: state.maxAttempts,
			lastError: state.lastError ?? "Unknown Mechanic verification failure.",
			changedFiles: normalizeChangedFiles(state.changedFiles),
			diagnostics: state.verificationDiagnostics,
			escalatedTo: "orc",
			escalatedAt: now().toISOString(),
		};
		await config.executors.escalateToOrc?.(state, payload);
		return {
			...state,
			next: "complete",
			escalation: payload,
			completionSummary: `Escalated to Orc after ${state.attemptCount} failed attempt(s).`,
		};
	}

	return {
		async step(state: MechanicSubgraphState): Promise<MechanicSubgraphState> {
			const normalizedState: MechanicSubgraphState = {
				...state,
				maxAttempts: Math.min(state.maxAttempts, HARD_RETRY_CEILING),
			};
			switch (normalizedState.next) {
				case "edit":
					return runEditNode(normalizedState);
				case "verify":
					return runVerifyNode(normalizedState);
				case "escalate":
					return runEscalateNode(normalizedState);
				case "complete":
					return normalizedState;
				default: {
					const exhaustiveGuard: never = normalizedState.next;
					throw new Error(`Unknown node: ${String(exhaustiveGuard)}`);
				}
			}
		},
	};
}
