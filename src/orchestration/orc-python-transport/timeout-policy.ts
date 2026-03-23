import { classifyOrcTransportIssue } from "../orc-events/index.js";
import type { OrcTransportPolicyResult } from "./policy-results.js";
import type { OrcPythonTransportHealth, StderrSnippet } from "./types.js";

export interface OrcTransportTimeoutEvaluation {
	readyTimedOut: boolean;
	stallTimedOut: boolean;
	idleWarningDue: boolean;
	silenceMs: number;
	nowIso: string;
}

export function evaluateTransportTimeoutPolicy(params: {
	health: OrcPythonTransportHealth;
	recentStderr: StderrSnippet[];
	idleWarningMs: number;
	stallTimeoutMs: number;
	readyTimeoutMs: number;
	now?: number;
}): OrcTransportTimeoutEvaluation & OrcTransportPolicyResult {
	const { health, idleWarningMs, now = Date.now(), readyTimeoutMs, recentStderr, stallTimeoutMs } = params;
	const nowIso = new Date(now).toISOString();
	const lastProgressAt = health.timeouts.lastProgressAt ? Date.parse(health.timeouts.lastProgressAt) : now;
	const silenceMs = now - lastProgressAt;
	const spawnedAt = Date.parse(health.spawnedAt ?? health.timeouts.lastProgressAt ?? nowIso);
	const readyTimedOut = !health.readyAt && now - spawnedAt >= readyTimeoutMs && !health.timeouts.lastReadyTimeoutAt;
	const stallTimedOut = silenceMs >= stallTimeoutMs && !health.timeouts.lastStallFaultAt;
	const lastIdleWarningAt = health.timeouts.lastIdleWarningAt ? Date.parse(health.timeouts.lastIdleWarningAt) : 0;
	const idleWarningDue = !stallTimedOut && silenceMs >= idleWarningMs && now - lastIdleWarningAt >= idleWarningMs;
	const emissions: OrcTransportPolicyResult["emissions"] = [];
	let action: OrcTransportPolicyResult["action"] = "continue";
	if (readyTimedOut) {
		emissions.push({
			kind: "fault",
			code: "transport_ready_timeout",
			message: "Python runner failed to emit a valid envelope before the ready timeout elapsed.",
			payload: {
				stream: "stdout",
				readyTimeoutMs,
				silenceMs,
				bufferedBytes: health.stdoutBufferedBytes,
				stderrSnippets: recentStderr,
				retryable: true,
			},
		});
		action = maxAction(action, mapRecoveryToAction("transport_ready_timeout"));
	}
	if (stallTimedOut) {
		emissions.push({
			kind: "fault",
			code: "transport_stall_timeout",
			message: "Python runner exceeded the fatal stall timeout without stdout/stderr progress.",
			payload: {
				stream: "stdout",
				idleWarningMs,
				stallTimeoutMs,
				silenceMs,
				lastStdoutChunkAt: health.timeouts.lastStdoutChunkAt,
				lastStderrChunkAt: health.timeouts.lastStderrChunkAt,
				stderrSnippets: recentStderr,
				retryable: true,
			},
		});
		action = maxAction(action, mapRecoveryToAction("transport_stall_timeout"));
	}
	if (idleWarningDue) {
		emissions.push({
			kind: "warning",
			code: "transport_idle_timeout",
			message: "Python runner has been idle longer than the warning threshold but remains within the recoverable window.",
			payload: {
				stream: "stdout",
				idleWarningMs,
				stallTimeoutMs,
				silenceMs,
				lastStdoutChunkAt: health.timeouts.lastStdoutChunkAt,
				lastStderrChunkAt: health.timeouts.lastStderrChunkAt,
				stderrSnippets: recentStderr,
				recoverable: true,
			},
		});
		action = maxAction(action, mapRecoveryToAction("transport_idle_timeout"));
	}
	return { emissions, action, readyTimedOut, stallTimedOut, idleWarningDue, silenceMs, nowIso };
}

function mapRecoveryToAction(code: Parameters<typeof classifyOrcTransportIssue>[0]): OrcTransportPolicyResult["action"] {
	const rule = classifyOrcTransportIssue(code);
	return rule.recovery === "continue_stream" ? "continue" : rule.recovery === "request_supervisor_restart" ? "restart" : "terminate";
}

function maxAction(left: OrcTransportPolicyResult["action"], right: OrcTransportPolicyResult["action"]): OrcTransportPolicyResult["action"] {
	const order: Record<OrcTransportPolicyResult["action"], number> = { continue: 0, restart: 1, terminate: 2 };
	return order[right] > order[left] ? right : left;
}
