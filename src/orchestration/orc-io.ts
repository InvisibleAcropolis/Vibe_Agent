import { basename } from "node:path";
import type { OrcControlPlaneState, OrcProjectContext } from "./orc-state.js";
import type { OrcSecurityEvent, OrcSecurityPolicyOverrides } from "./orc-security.js";

export interface LaunchOrcRequest {
	project: OrcProjectContext;
	prompt: string;
	resumeThreadId?: string;
	resumeCheckpointId?: string;
	/**
	 * Phase 1 override hook for the runtime/session factory.
	 * Later implementations should merge and enforce these values before any worker tools start.
	 */
	securityPolicyOverrides?: OrcSecurityPolicyOverrides;
}

export interface LaunchOrcResponse {
	threadId: string;
	checkpointId?: string;
	state: OrcControlPlaneState;
}

export interface LoadOrcTrackerStateRequest {
	threadId: string;
	checkpointId?: string;
}

export interface LoadOrcTrackerStateResponse {
	state?: OrcControlPlaneState;
	found: boolean;
}

export type OrcArtifactKind = "artifact" | "log";
export type OrcDocumentKind = "plan" | "roadmap" | "research" | "session" | "tracker" | "artifact-manifest";
export type OrcDocumentFormat = "markdown" | "json";

export type OrcRunCorrelationId = string;
export type OrcEventId = string;
export type OrcStreamSequenceNumber = number;

/**
 * High-level category assigned before events are reduced into control-plane state or view models.
 */
export type OrcEventCategory =
	| "transport"
	| "lifecycle"
	| "agent_message"
	| "tool_call"
	| "tool_result"
	| "checkpoint"
	| "tracker"
	| "diagnostic"
	| "security";

/**
 * Severity is carried end-to-end so transport warnings and worker failures can be surfaced
 * without requiring each consumer to invent its own mapping.
 */
export type OrcEventSeverity = "debug" | "info" | "notice" | "warning" | "error" | "critical";

/**
 * Lifecycle status models the execution state of the event itself, not the reduced control-plane phase.
 */
export type OrcEventLifecycleStatus =
	| "declared"
	| "queued"
	| "started"
	| "streaming"
	| "waiting_on_input"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "timed_out";

export type OrcEventActorKind = "agent" | "user" | "tool" | "computer" | "system" | "transport";
export type OrcInteractionTarget = "user" | "computer";
export type OrcExecutionEnvironment = "tui" | "cli" | "worker" | "tool_runtime" | "transport" | "external";

/**
 * Minimum actor metadata required to distinguish agent→user interactions from agent→computer/tool activity.
 */
export interface OrcEventActorMetadata {
	kind: OrcEventActorKind;
	id: string;
	label: string;
	workerId?: string;
	runCorrelationId?: OrcRunCorrelationId;
}

/**
 * WHAT happened in the canonical envelope.
 */
export interface OrcEventActionDescriptor {
	category: OrcEventCategory;
	name: string;
	description?: string;
	severity: OrcEventSeverity;
	status: OrcEventLifecycleStatus;
}

/**
 * HOW the activity was delivered or performed.
 */
export interface OrcEventDeliveryDescriptor {
	channel: "stdout_jsonl" | "stderr" | "tracker_snapshot" | "state_reducer" | "event_bus" | "direct";
	interactionTarget: OrcInteractionTarget;
	environment: OrcExecutionEnvironment;
	transport?: "python_child_process" | "in_process" | "future_remote_runner";
	toolName?: string;
	toolCallId?: string;
	checkpointId?: string;
}

/**
 * Origin metadata preserves provenance needed for debugging and durable handoff across transport,
 * reducers, and future replay tooling.
 */
export interface OrcEventOriginMetadata {
	runCorrelationId: OrcRunCorrelationId;
	eventId: OrcEventId;
	streamSequence: OrcStreamSequenceNumber;
	emittedAt: string;
	source: "python_runner" | "orc_runtime" | "orc_tracker" | "tui" | "future_replay";
	threadId?: string;
	phase?: string;
	waveId?: string;
	workerId?: string;
	parentEventId?: OrcEventId;
}

/**
 * Canonical transport envelope shared by Python telemetry, the TypeScript transport, and the future
 * Global Event Bus. The required fields answer WHO did WHAT HOW at WHEN, while `rawPayload` preserves
 * namespaced source material for debugging and downstream normalization.
 */
export interface OrcCanonicalEventEnvelope<TRawPayload = Record<string, unknown>> {
	origin: OrcEventOriginMetadata;
	who: OrcEventActorMetadata;
	what: OrcEventActionDescriptor;
	how: OrcEventDeliveryDescriptor;
	when: string;
	rawPayload?: {
		namespace: string;
		payload: TRawPayload;
	};
}

/**
 * Stable Orc durable-artifact identity used across markdown documents and paired manifests.
 */
export interface OrcDocumentCoordinates {
	projectId: string;
	phaseId?: string;
	taskId?: string;
	threadId?: string;
	waveId?: string;
	timestamp: string;
}

/**
 * One durable artifact entry on disk. Markdown artifacts and machine-readable manifests can share
 * the same coordinates and be differentiated by format and file extension.
 */
export interface OrcArtifactDocument {
	id: string;
	kind: OrcDocumentKind;
	format: OrcDocumentFormat;
	coordinates: OrcDocumentCoordinates;
	label: string;
	sourcePath: string;
	createdAt: string;
	relatedPath?: string;
	workerId?: string;
}

/**
 * Inventory manifest stored next to paired artifacts so external tooling can validate completeness.
 */
export interface OrcArtifactManifest {
	version: 1;
	document: OrcArtifactDocument;
	pairedMarkdownPath?: string;
	pairedJsonPath?: string;
	threadId?: string;
	waveId?: string;
	status: "ready" | "draft";
	metadata?: Record<string, string | number | boolean | null>;
}

export interface OrcArtifactLogEntry {
	id: string;
	kind: OrcArtifactKind;
	label: string;
	sourcePath: string;
	createdAt?: string;
	workerId?: string;
	waveId?: string;
}

export interface EnumerateOrcArtifactsRequest {
	threadId: string;
	checkpointId?: string;
	kind?: OrcArtifactKind | "all";
}

export interface EnumerateOrcArtifactsResponse {
	entries: OrcArtifactLogEntry[];
}

export interface ResumeOrcThreadRequest {
	threadId: string;
	checkpointId?: string;
}

export interface ResumeOrcThreadResponse {
	threadId: string;
	checkpointId?: string;
	state?: OrcControlPlaneState;
}

/**
 * Stable I/O payload for approval-required and blocked-command events.
 * The UI should render `statusText` directly so these strings exist before worker enforcement ships.
 */
export interface OrcSecurityStatusPayload extends OrcSecurityEvent {}

export function slugifyOrcSegment(value: string | undefined, fallback: string): string {
	const normalized = (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	return normalized || fallback;
}

export function buildOrcFileStem(kind: OrcDocumentKind, coordinates: OrcDocumentCoordinates): string {
	const segments = [
		slugifyOrcSegment(coordinates.projectId, "project"),
		coordinates.phaseId ? `phase-${slugifyOrcSegment(coordinates.phaseId, "phase")}` : undefined,
		coordinates.taskId ? `task-${slugifyOrcSegment(coordinates.taskId, "task")}` : undefined,
		coordinates.threadId ? `thread-${slugifyOrcSegment(coordinates.threadId, "thread")}` : undefined,
		coordinates.waveId ? `wave-${slugifyOrcSegment(coordinates.waveId, "wave")}` : undefined,
		coordinates.timestamp.replace(/[:.]/g, "-").replace(/z$/i, "Z"),
		slugifyOrcSegment(kind, kind),
	];
	return segments.filter(Boolean).join("__");
}

export function inferOrcDocumentLabel(sourcePath: string): string {
	return basename(sourcePath) || sourcePath;
}
