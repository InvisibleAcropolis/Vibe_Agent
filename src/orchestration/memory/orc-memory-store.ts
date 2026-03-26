import { join } from "node:path";
import {
	atomicWriteJsonSync,
	ensureDirSync,
	readJsonIfExistsSync,
	withDirectoryLockSync,
} from "./fs-safe.js";
import {
	ORC_MEMORY_SCHEMA_VERSION,
	type OrcCompletionStatusRecord,
	type OrcGlobalPlanState,
	type OrcHandoffSummaryRecord,
	type OrcIntermediateArtifactsRecord,
	type OrcMemoryArtifactBundle,
	type OrcSubagentFindingsRecord,
} from "./types.js";

const FILES = {
	subagentFindings: "subagent-findings.json",
	intermediateArtifacts: "intermediate-artifacts.json",
	completionStatus: "completion-status.json",
	handoffSummary: "handoff-summary.json",
} as const;

export interface OrcMemoryCoordinates {
	threadId: string;
	agentId: string;
	paneId: string;
}

export class OrcMemoryStore {
	constructor(private readonly rootDir: string) {
		ensureDirSync(rootDir);
	}

	writeSubagentFindings(record: OrcSubagentFindingsRecord): void {
		this.writeRecord(this.filePath(record, FILES.subagentFindings), record, "subagent_findings");
	}

	writeIntermediateArtifacts(record: OrcIntermediateArtifactsRecord): void {
		this.writeRecord(this.filePath(record, FILES.intermediateArtifacts), record, "intermediate_artifacts");
	}

	writeCompletionStatus(record: OrcCompletionStatusRecord): void {
		this.writeRecord(this.filePath(record, FILES.completionStatus), record, "completion_status");
	}

	writeHandoffSummary(record: OrcHandoffSummaryRecord): void {
		this.writeRecord(this.filePath(record, FILES.handoffSummary), record, "handoff_summary");
	}

	consumeAfterAgentEnd(coordinates: OrcMemoryCoordinates): OrcMemoryArtifactBundle {
		const dir = this.coordsDir(coordinates);
		return withDirectoryLockSync(dir, () => {
			const bundle: OrcMemoryArtifactBundle = {
				subagentFindings: this.readRecord<OrcSubagentFindingsRecord>(coordinates, FILES.subagentFindings, "subagent_findings"),
				intermediateArtifacts: this.readRecord<OrcIntermediateArtifactsRecord>(coordinates, FILES.intermediateArtifacts, "intermediate_artifacts"),
				completionStatus: this.readRecord<OrcCompletionStatusRecord>(coordinates, FILES.completionStatus, "completion_status"),
				handoffSummary: this.readRecord<OrcHandoffSummaryRecord>(coordinates, FILES.handoffSummary, "handoff_summary"),
			};
			if (bundle.completionStatus) {
				const consumedCompletion: OrcCompletionStatusRecord = {
					...bundle.completionStatus,
					consumedAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				};
				atomicWriteJsonSync(this.filePath(consumedCompletion, FILES.completionStatus), consumedCompletion);
				bundle.completionStatus = consumedCompletion;
			}
			return bundle;
		});
	}

	updateGlobalPlanState(current: OrcGlobalPlanState | undefined, bundle: OrcMemoryArtifactBundle): OrcGlobalPlanState | undefined {
		const completion = bundle.completionStatus;
		if (!completion) {
			return current;
		}
		return {
			agentId: completion.agentId,
			lastUpdatedAt: completion.updatedAt,
			status: completion.status,
			summary: bundle.handoffSummary?.summary ?? current?.summary,
			completed: bundle.handoffSummary?.planDelta.completed ?? current?.completed ?? [],
			pending: bundle.handoffSummary?.planDelta.pending ?? current?.pending ?? [],
		};
	}

	private writeRecord<T extends { schemaVersion: number; kind: string; threadId: string; agentId: string; paneId: string }>(path: string, record: T, expectedKind: T["kind"]): void {
		assert(record.schemaVersion === ORC_MEMORY_SCHEMA_VERSION, `schemaVersion must be ${ORC_MEMORY_SCHEMA_VERSION}`);
		assert(record.kind === expectedKind, `kind must be '${expectedKind}'`);
		assert(typeof record.threadId === "string" && record.threadId.length > 0, "threadId is required");
		assert(typeof record.agentId === "string" && record.agentId.length > 0, "agentId is required");
		assert(typeof record.paneId === "string" && record.paneId.length > 0, "paneId is required");
		const dir = this.coordsDir(record);
		withDirectoryLockSync(dir, () => {
			atomicWriteJsonSync(path, record);
		});
	}

	private readRecord<T extends { schemaVersion: number; kind: string }>(coordinates: OrcMemoryCoordinates, fileName: string, expectedKind: T["kind"]): T | undefined {
		const path = join(this.coordsDir(coordinates), fileName);
		const record = readJsonIfExistsSync<T>(path);
		if (!record) {
			return undefined;
		}
		assert(record.schemaVersion === ORC_MEMORY_SCHEMA_VERSION, `Invalid schemaVersion in ${fileName}`);
		assert(record.kind === expectedKind, `Invalid kind in ${fileName}`);
		return record;
	}

	private filePath(record: { threadId: string; agentId: string; paneId: string }, fileName: string): string {
		return join(this.coordsDir(record), fileName);
	}

	private coordsDir(coords: OrcMemoryCoordinates): string {
		return join(this.rootDir, coords.threadId, coords.agentId, coords.paneId);
	}
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(`Orc memory schema validation failed: ${message}`);
	}
}
