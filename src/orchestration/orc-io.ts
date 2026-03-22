import { basename } from "node:path";
import type { OrcControlPlaneState, OrcProjectContext } from "./orc-state.js";

export interface LaunchOrcRequest {
	project: OrcProjectContext;
	prompt: string;
	resumeThreadId?: string;
	resumeCheckpointId?: string;
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
