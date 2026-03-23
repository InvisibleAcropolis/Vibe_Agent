import type { TransportSupervisorContext } from "./types.js";

export function startMonitors(start: () => void, stop: () => void): NodeJS.Timeout {
	stop();
	const monitor = setInterval(start, 250);
	monitor.unref?.();
	return monitor;
}

export function stopMonitors(monitorInterval?: NodeJS.Timeout): void {
	if (monitorInterval) {
		clearInterval(monitorInterval);
	}
}

export function evaluateTransportTimeouts(context: TransportSupervisorContext): void {
	if (!context.child) {
		return;
	}
	const now = Date.now();
	const lastProgressAt = context.health.timeouts.lastProgressAt ? Date.parse(context.health.timeouts.lastProgressAt) : now;
	const silenceMs = now - lastProgressAt;
	if (!context.health.readyAt && now - Date.parse(context.health.spawnedAt ?? context.health.timeouts.lastProgressAt ?? new Date(now).toISOString()) >= context.readyTimeoutMs && !context.health.timeouts.lastReadyTimeoutAt) {
		context.health.timeouts.lastReadyTimeoutAt = new Date(now).toISOString();
		context.emitTransportFault("transport_ready_timeout", "Python runner failed to emit a valid envelope before the ready timeout elapsed.", {
			stream: "stdout",
			readyTimeoutMs: context.readyTimeoutMs,
			silenceMs,
			bufferedBytes: context.health.stdoutBufferedBytes,
			stderrSnippets: context.recentStderr,
			retryable: true,
		});
	}
	if (silenceMs >= context.stallTimeoutMs && !context.health.timeouts.lastStallFaultAt) {
		context.health.timeouts.lastStallFaultAt = new Date(now).toISOString();
		context.emitTransportFault("transport_stall_timeout", "Python runner exceeded the fatal stall timeout without stdout/stderr progress.", {
			stream: "stdout",
			idleWarningMs: context.idleWarningMs,
			stallTimeoutMs: context.stallTimeoutMs,
			silenceMs,
			lastStdoutChunkAt: context.health.timeouts.lastStdoutChunkAt,
			lastStderrChunkAt: context.health.timeouts.lastStderrChunkAt,
			stderrSnippets: context.recentStderr,
			retryable: true,
		});
		return;
	}
	if (silenceMs >= context.idleWarningMs) {
		const lastIdleWarningAt = context.health.timeouts.lastIdleWarningAt ? Date.parse(context.health.timeouts.lastIdleWarningAt) : 0;
		if (now - lastIdleWarningAt >= context.idleWarningMs) {
			context.health.timeouts.lastIdleWarningAt = new Date(now).toISOString();
			context.emitTransportWarning("transport_idle_timeout", "Python runner has been idle longer than the warning threshold but remains within the recoverable window.", {
				stream: "stdout",
				idleWarningMs: context.idleWarningMs,
				stallTimeoutMs: context.stallTimeoutMs,
				silenceMs,
				lastStdoutChunkAt: context.health.timeouts.lastStdoutChunkAt,
				lastStderrChunkAt: context.health.timeouts.lastStderrChunkAt,
				stderrSnippets: context.recentStderr,
				recoverable: true,
			});
		}
	}
}
