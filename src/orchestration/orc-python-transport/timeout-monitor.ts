import { evaluateTransportTimeoutPolicy } from "./timeout-policy.js";
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

export function evaluateTransportTimeouts(context: TransportSupervisorContext): ReturnType<typeof evaluateTransportTimeoutPolicy> | undefined {
	if (!context.child) {
		return undefined;
	}
	return evaluateTransportTimeoutPolicy({
		health: context.health,
		recentStderr: context.recentStderr,
		idleWarningMs: context.idleWarningMs,
		stallTimeoutMs: context.stallTimeoutMs,
		readyTimeoutMs: context.readyTimeoutMs,
	});
}
