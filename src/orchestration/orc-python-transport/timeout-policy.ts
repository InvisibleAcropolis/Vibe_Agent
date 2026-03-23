import type { OrcTransportTimeoutPolicyResult } from "./policy-results.js";
import { mapTransportRecoveryToPolicyAction, maxTransportPolicyAction } from "./policy-results.js";
import type { OrcPythonTransportHealth, StderrSnippet } from "./types.js";

export function evaluateTransportTimeoutPolicy(params: {
	health: OrcPythonTransportHealth;
	recentStderr: StderrSnippet[];
	idleWarningMs: number;
	stallTimeoutMs: number;
	readyTimeoutMs: number;
	now?: number;
}): OrcTransportTimeoutPolicyResult {
	const { health, idleWarningMs, now = Date.now(), readyTimeoutMs, recentStderr, stallTimeoutMs } = params;
	const nowIso = new Date(now).toISOString();
	const lastProgressAt = health.timeouts.lastProgressAt ? Date.parse(health.timeouts.lastProgressAt) : now;
	const silenceMs = now - lastProgressAt;
	const spawnedAt = Date.parse(health.spawnedAt ?? health.timeouts.lastProgressAt ?? nowIso);
	const readyTimedOut = !health.readyAt && now - spawnedAt >= readyTimeoutMs && !health.timeouts.lastReadyTimeoutAt;
	const stallTimedOut = silenceMs >= stallTimeoutMs && !health.timeouts.lastStallFaultAt;
	const lastIdleWarningAt = health.timeouts.lastIdleWarningAt ? Date.parse(health.timeouts.lastIdleWarningAt) : 0;
	const idleWarningDue = !stallTimedOut && silenceMs >= idleWarningMs && now - lastIdleWarningAt >= idleWarningMs;
	const emissions: OrcTransportTimeoutPolicyResult["emissions"] = [];
	const healthMarks: OrcTransportTimeoutPolicyResult["healthMarks"] = {};
	let action: OrcTransportTimeoutPolicyResult["action"] = "continue";
	if (readyTimedOut) {
		healthMarks.lastReadyTimeoutAt = nowIso;
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
		action = maxTransportPolicyAction(action, mapTransportRecoveryToPolicyAction("transport_ready_timeout"));
	}
	if (stallTimedOut) {
		healthMarks.lastStallFaultAt = nowIso;
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
		action = maxTransportPolicyAction(action, mapTransportRecoveryToPolicyAction("transport_stall_timeout"));
	}
	if (idleWarningDue) {
		healthMarks.lastIdleWarningAt = nowIso;
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
		action = maxTransportPolicyAction(action, mapTransportRecoveryToPolicyAction("transport_idle_timeout"));
	}
	return { emissions, action, healthMarks, nowIso, silenceMs };
}
