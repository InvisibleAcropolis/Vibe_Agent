import type { EventEmitter } from "node:events";
import type { OrcTransportFaultCode, OrcTransportWarningCode } from "../orc-events/types.js";
import type { OrcDebugArtifactsWriter } from "../orc-debug.js";
import type { OrcCanonicalEventEnvelope } from "../orc-io.js";
import type { OrcTransportPolicyAction, OrcTransportPolicyResult, OrcTransportTimeoutHealthMarks } from "./policy-results.js";
import type {
	OrcPythonTransportDiagnosticEvent,
	OrcPythonTransportHealth,
	OrcPythonTransportLifecycleEvent,
} from "./types.js";
import { OrcPythonTransportHealthStore } from "./health-store.js";

export interface OrcPythonTransportSupervisorOptions {
	healthStore: OrcPythonTransportHealthStore;
	emitter: EventEmitter;
	debugArtifactsWriter?: OrcDebugArtifactsWriter;
	getHealth: () => OrcPythonTransportHealth;
	getChild: () => { kill(signal: NodeJS.Signals): void } | undefined;
	getTerminationReason: () => string | undefined;
	setTerminationReason: (reason: string) => void;
}

export class OrcPythonTransportSupervisor {
	private readonly emittedFaultKeys = new Set<string>();

	constructor(private readonly options: OrcPythonTransportSupervisorOptions) {}

	resetFaultDeduplication(): void {
		this.emittedFaultKeys.clear();
	}

	applyTimeoutHealthMarks(health: OrcPythonTransportHealth, healthMarks: OrcTransportTimeoutHealthMarks): void {
		if (healthMarks.lastReadyTimeoutAt) {
			health.timeouts.lastReadyTimeoutAt = healthMarks.lastReadyTimeoutAt;
		}
		if (healthMarks.lastStallFaultAt) {
			health.timeouts.lastStallFaultAt = healthMarks.lastStallFaultAt;
		}
		if (healthMarks.lastIdleWarningAt) {
			health.timeouts.lastIdleWarningAt = healthMarks.lastIdleWarningAt;
		}
	}

	applyPolicyResult(policy: OrcTransportPolicyResult): void {
		for (const emission of policy.emissions) {
			if (emission.kind === "warning") {
				this.emitTransportWarning(emission.code, emission.message, emission.payload);
				continue;
			}
			this.emitTransportFault(emission.code, emission.message, emission.payload);
		}
		this.applyPolicyAction(policy.action);
	}

	emitTransportWarning(code: OrcTransportWarningCode, message: string, rawPayload: Record<string, unknown>): void {
		const { at, status } = this.options.healthStore.recordWarning(code, message);
		this.options.debugArtifactsWriter?.recordTransportDiagnostic({ type: "warning", at, code, message, status, rawPayload, health: this.options.getHealth() });
		this.options.emitter.emit("envelope", this.options.healthStore.buildTransportEnvelope("stream.warning", code, message, status, rawPayload));
	}

	emitTransportFault(code: OrcTransportFaultCode, message: string, rawPayload: Record<string, unknown>): void {
		const statusKey = String(rawPayload.status ?? "unknown");
		const dedupeKey = `${code}:${statusKey}:${String(rawPayload.signal ?? "none")}:${String(rawPayload.exitCode ?? "none")}:${String(rawPayload.syscall ?? "none")}`;
		if (this.emittedFaultKeys.has(dedupeKey)) {
			return;
		}
		this.emittedFaultKeys.add(dedupeKey);
		const { at, status } = this.options.healthStore.recordFault(code, message);
		this.options.debugArtifactsWriter?.recordTransportDiagnostic({ type: "fault", at, code, message, status, rawPayload, health: this.options.getHealth() });
		this.options.emitter.emit("envelope", this.options.healthStore.buildTransportEnvelope("transport.fault", code, message, status, rawPayload));
	}

	emitLifecycle(event: OrcPythonTransportLifecycleEvent): void {
		this.options.debugArtifactsWriter?.recordLifecycleEvent(event, this.options.getHealth());
		this.options.emitter.emit("lifecycle", event);
	}

	emitEnvelope(envelope: OrcCanonicalEventEnvelope): void {
		this.options.emitter.emit("envelope", envelope);
	}

	emitDiagnostic(event: OrcPythonTransportDiagnosticEvent): void {
		this.options.emitter.emit("diagnostic", event);
	}

	private applyPolicyAction(action: OrcTransportPolicyAction): void {
		const child = this.options.getChild();
		if (!child || action === "continue") {
			return;
		}
		if (action === "restart") {
			if (!this.options.getTerminationReason()) {
				this.options.setTerminationReason("transport_policy_restart_requested");
			}
			this.options.healthStore.markStage("failed", "faulted");
			child.kill("SIGTERM");
			return;
		}
		if (!this.options.getTerminationReason()) {
			this.options.setTerminationReason("transport_policy_terminated");
		}
		this.options.healthStore.markStage("failed", "faulted");
		child.kill("SIGKILL");
	}
}
