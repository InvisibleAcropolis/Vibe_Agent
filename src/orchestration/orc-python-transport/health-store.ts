import { randomUUID } from "node:crypto";
import { classifyOrcFailureDisposition } from "../orc-events/transport-policy.js";
import { classifyOrcTransportIssue } from "../orc-events/transport-policy.js";
import type { OrcTransportFaultCode, OrcTransportWarningCode } from "../orc-events/types.js";
import type { OrcCanonicalEventEnvelope } from "../orc-io.js";
import type { OrcPythonTransportHealth, OrcPythonTransportLifecycleStage, TransportStream } from "./types.js";

export class OrcPythonTransportHealthStore {
	constructor(private health: OrcPythonTransportHealth) {}

	get snapshot(): OrcPythonTransportHealth {
		return this.health;
	}

	replace(next: OrcPythonTransportHealth): void {
		this.health = next;
	}

	clone(): OrcPythonTransportHealth {
		return {
			...this.health,
			args: [...this.health.args],
			timeouts: { ...this.health.timeouts },
		};
	}

	markStage(stage: OrcPythonTransportLifecycleStage, status?: OrcPythonTransportHealth["status"]): void {
		this.health.stage = stage;
		if (status) {
			this.health.status = status;
		}
		this.health.lastEventAt = new Date().toISOString();
	}

	recordStreamProgress(stream: TransportStream): void {
		const at = new Date().toISOString();
		this.health.lastEventAt = at;
		this.health.timeouts.lastProgressAt = at;
		if (stream === "stdout") {
			this.health.timeouts.lastStdoutChunkAt = at;
			return;
		}
		this.health.timeouts.lastStderrChunkAt = at;
	}

	setBufferedBytes(stream: TransportStream, value: number): void {
		if (stream === "stdout") {
			this.health.stdoutBufferedBytes = value;
			return;
		}
		this.health.stderrBufferedBytes = value;
	}

	buildTransportEnvelope(
		kind: "stream.warning" | "transport.fault",
		code: OrcTransportWarningCode | OrcTransportFaultCode,
		message: string,
		status: "degraded" | "faulted" | "offline",
		rawPayload: Record<string, unknown>,
	): OrcCanonicalEventEnvelope<Record<string, unknown>> {
		const now = new Date().toISOString();
		const isWarning = kind === "stream.warning";
		const disposition = !isWarning ? classifyOrcFailureDisposition(code as OrcTransportFaultCode) : undefined;
		return {
			origin: {
				runCorrelationId: this.health.runCorrelationId ?? `orc-run-${randomUUID()}`,
				eventId: `transport-${randomUUID()}`,
				streamSequence: (this.health.lastStdoutSequence ?? this.health.stdoutLines) + 1,
				emittedAt: now,
				source: "orc_runtime",
				threadId: this.health.threadId,
				phase: "phase-2-transport-recovery",
			},
			who: {
				kind: "transport",
				id: this.health.pid ? `python-transport-${this.health.pid}` : "python-transport",
				label: "Python transport supervisor",
				runCorrelationId: this.health.runCorrelationId,
			},
			what: {
				category: "transport",
				name: code,
				description: message,
				severity: isWarning ? "warning" : "error",
				status: isWarning ? "streaming" : "failed",
			},
			how: {
				channel: "event_bus",
				interactionTarget: "computer",
				environment: "transport",
				transport: "python_child_process",
			},
			when: now,
			rawPayload: {
				namespace: "orc.transport.supervisor",
				payload: {
					eventKind: kind,
					code,
					message,
					status,
					remediationHint: disposition?.remediationHint,
					retryability: disposition?.retryability,
					pid: this.health.pid,
					warningCode: isWarning ? code : undefined,
					faultCode: isWarning ? undefined : code,
					threadId: this.health.threadId,
					runCorrelationId: this.health.runCorrelationId,
					lineSequence: this.health.stdoutLines,
					chunkSequence: this.health.stdoutLines + this.health.stderrLines,
					...rawPayload,
				},
			},
		};
	}

	recordWarning(code: OrcTransportWarningCode, message: string): { at: string; status: "degraded" | "faulted" | "offline" } {
		const rule = classifyOrcTransportIssue(code);
		const at = new Date().toISOString();
		this.health.warningEvents += 1;
		const status: "degraded" | "faulted" | "offline" =
			rule.defaultStatus === "faulted" || rule.defaultStatus === "offline" ? rule.defaultStatus : "degraded";
		this.health.status = this.health.status === "faulted" ? "faulted" : status;
		this.health.lastErrorAt = at;
		this.health.lastError = `${code}: ${message}`;
		this.health.lastEventAt = at;
		return { at, status };
	}

	recordFault(code: OrcTransportFaultCode, message: string): { at: string; status: "degraded" | "faulted" | "offline" } {
		const rule = classifyOrcTransportIssue(code);
		const at = new Date().toISOString();
		this.health.faultEvents += 1;
		this.health.status = rule.defaultStatus === "offline" ? "offline" : "faulted";
		this.health.lastErrorAt = at;
		this.health.lastError = `${code}: ${message}`;
		this.health.lastEventAt = at;
		const status: "degraded" | "faulted" | "offline" =
			rule.defaultStatus === "degraded" || rule.defaultStatus === "offline" ? rule.defaultStatus : "faulted";
		return { at, status };
	}
}
