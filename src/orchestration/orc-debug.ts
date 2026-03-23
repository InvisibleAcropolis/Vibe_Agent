import { appendFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getVibeLogsDir, type VibeDurablePathOptions } from "../durable/durable-paths.js";
import type { OrcCanonicalEventEnvelope } from "./orc-io.js";
import type { OrcPythonTransportDiagnosticEvent, OrcPythonTransportHealth, OrcPythonTransportLifecycleEvent } from "./orc-python-transport.js";
import type { OrcControlPlaneState } from "./orc-state.js";

export interface OrcDebugArtifactLocation {
	rootDirPath: string;
	threadDirPath: string;
	runDirPath: string;
	runtimeMetadataPath: string;
	pythonStderrPath: string;
	rawEventMirrorPath: string;
	parserWarningsPath: string;
	transportDiagnosticsPath: string;
}

export interface OrcDebugModeOptions extends VibeDurablePathOptions {
	enabled?: boolean;
}

export interface OrcDebugRuntimeMetadata {
	threadId: string;
	runCorrelationId: string;
	createdAt: string;
	debugMode: "opt_in";
	artifacts: Record<string, string>;
	project?: {
		projectId: string;
		projectRoot: string;
		workspaceRoot?: string;
	};
	transport?: {
		command?: string;
		args: string[];
		cwd?: string;
		pid?: number;
	};
	state?: Pick<OrcControlPlaneState, "checkpointId" | "phase" | "lastUpdatedAt">;
	safety: {
		operatorUiSurface: "default_dashboard_unchanged";
		caveats: string[];
	};
}

function sanitizePathToken(value: string | undefined, fallback: string): string {
	const sanitized = value?.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return sanitized && sanitized.length > 0 ? sanitized : fallback;
}

export function getOrcDebugArtifactLocation(
	threadId: string,
	runCorrelationId: string,
	options?: VibeDurablePathOptions,
): OrcDebugArtifactLocation {
	const rootDirPath = join(getVibeLogsDir(options), "orchestration", "debug");
	const safeThreadId = sanitizePathToken(threadId, "unknown-thread");
	const safeRunId = sanitizePathToken(runCorrelationId, "unknown-run");
	const threadDirPath = join(rootDirPath, "threads", safeThreadId);
	const runDirPath = join(threadDirPath, "runs", safeRunId);
	return {
		rootDirPath,
		threadDirPath,
		runDirPath,
		runtimeMetadataPath: join(runDirPath, "runtime-metadata.json"),
		pythonStderrPath: join(runDirPath, "python-stderr.jsonl"),
		rawEventMirrorPath: join(runDirPath, "raw-event-mirror.jsonl"),
		parserWarningsPath: join(runDirPath, "parser-warnings.jsonl"),
		transportDiagnosticsPath: join(runDirPath, "transport-diagnostics.jsonl"),
	};
}

export class OrcDebugArtifactsWriter {
	readonly location: OrcDebugArtifactLocation;

	constructor(threadId: string, runCorrelationId: string, options?: VibeDurablePathOptions) {
		this.location = getOrcDebugArtifactLocation(threadId, runCorrelationId, options);
		this.ensureDirs();
	}

	writeRuntimeMetadata(metadata: OrcDebugRuntimeMetadata): void {
		this.writeJsonAtomically(this.location.runtimeMetadataPath, metadata);
	}

	recordRawEventMirror(envelope: OrcCanonicalEventEnvelope): void {
		this.appendJsonLine(this.location.rawEventMirrorPath, envelope);
	}

	recordParserWarning(entry: Record<string, unknown>): void {
		this.appendJsonLine(this.location.parserWarningsPath, entry);
	}

	recordPythonStderr(event: OrcPythonTransportDiagnosticEvent): void {
		this.appendJsonLine(this.location.pythonStderrPath, event);
	}

	recordTransportDiagnostic(entry: Record<string, unknown>): void {
		this.appendJsonLine(this.location.transportDiagnosticsPath, entry);
	}

	recordLifecycleEvent(event: OrcPythonTransportLifecycleEvent, health: OrcPythonTransportHealth): void {
		this.recordTransportDiagnostic({
			type: "lifecycle",
			at: event.at,
			event,
			health,
		});
	}

	recordHealthSnapshot(reason: string, health: OrcPythonTransportHealth): void {
		this.recordTransportDiagnostic({
			type: "health_snapshot",
			at: new Date().toISOString(),
			reason,
			health,
		});
	}

	private ensureDirs(): void {
		for (const dirPath of [this.location.rootDirPath, this.location.threadDirPath, this.location.runDirPath]) {
			if (!existsSync(dirPath)) {
				mkdirSync(dirPath, { recursive: true, mode: 0o700 });
			}
		}
	}

	private appendJsonLine(filePath: string, value: unknown): void {
		appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
	}

	private writeJsonAtomically(filePath: string, value: unknown): void {
		const tempPath = `${filePath}.tmp`;
		writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
		renameSync(tempPath, filePath);
	}
}
