export const ORC_MEMORY_SCHEMA_VERSION = 1 as const;

export type OrcMemoryBackendMode = "filesystem" | "vector";

export interface OrcMemoryBackendRoute {
	mode: OrcMemoryBackendMode;
	namespace?: string;
}

export type OrcMemoryRecordKind =
	| "subagent_findings"
	| "intermediate_artifacts"
	| "completion_status"
	| "handoff_summary";

export interface OrcMemoryRecordBase<TKind extends OrcMemoryRecordKind> {
	schemaVersion: typeof ORC_MEMORY_SCHEMA_VERSION;
	kind: TKind;
	threadId: string;
	agentId: string;
	paneId: string;
	runCorrelationId?: string;
	updatedAt: string;
}

export interface OrcSubagentFindingItem {
	id: string;
	summary: string;
	evidence: string[];
	confidence?: "low" | "medium" | "high";
}

export interface OrcSubagentFindingsRecord extends OrcMemoryRecordBase<"subagent_findings"> {
	findings: OrcSubagentFindingItem[];
}

export interface OrcIntermediateArtifactItem {
	id: string;
	kind: "tool_output" | "file" | "command" | "note";
	label: string;
	content: string;
	createdAt: string;
}

export interface OrcIntermediateArtifactsRecord extends OrcMemoryRecordBase<"intermediate_artifacts"> {
	artifacts: OrcIntermediateArtifactItem[];
}

export interface OrcCompletionStatusRecord extends OrcMemoryRecordBase<"completion_status"> {
	status: "completed" | "failed" | "cancelled" | "timed_out" | "unknown";
	reason: string;
	completedAt: string;
	consumedAt?: string;
}

export interface OrcHandoffSummaryRecord extends OrcMemoryRecordBase<"handoff_summary"> {
	summary: string;
	nextActions: string[];
	planDelta: {
		completed: string[];
		pending: string[];
	};
}

export interface OrcMemoryArtifactBundle {
	subagentFindings?: OrcSubagentFindingsRecord;
	intermediateArtifacts?: OrcIntermediateArtifactsRecord;
	completionStatus?: OrcCompletionStatusRecord;
	handoffSummary?: OrcHandoffSummaryRecord;
}

export interface OrcGlobalPlanState {
	agentId: string;
	lastUpdatedAt: string;
	status: OrcCompletionStatusRecord["status"];
	summary?: string;
	completed: string[];
	pending: string[];
}

export interface OrcMemorySourceProvenance {
	backend: OrcMemoryBackendMode;
	recordKind?: OrcMemoryRecordKind;
	threadId?: string;
	agentId?: string;
	paneId?: string;
	sourcePath?: string;
	vectorDocumentId?: string;
}

export interface OrcMemoryRetrievalHit {
	id: string;
	snippet: string;
	score?: number;
	confidenceHint: "low" | "medium" | "high";
	provenance: OrcMemorySourceProvenance;
}

export interface OrcMemoryRetrievalResult {
	backend: OrcMemoryBackendMode;
	query: string;
	retrievedAt: string;
	hits: OrcMemoryRetrievalHit[];
}
