import { readFileSync, writeFileSync } from "node:fs";
import { ensureParentDir, getVibeTrackerPath, type VibeDurablePathOptions } from "./durable/durable-paths.js";

export interface SplashReplaySignal {
	sessionName: string;
	token: string;
	requestedAt: string;
}

export function getSplashReplaySignalPath(
	sessionName: string,
	options?: VibeDurablePathOptions,
): string {
	return getVibeTrackerPath(`splash-replay-${sanitizeSessionName(sessionName)}.json`, options);
}

export function readSplashReplaySignal(
	sessionName: string,
	options?: VibeDurablePathOptions,
): SplashReplaySignal | undefined {
	const signalPath = getSplashReplaySignalPath(sessionName, options);
	try {
		const raw = readFileSync(signalPath, "utf8");
		const parsed = JSON.parse(raw) as Partial<SplashReplaySignal>;
		if (
			typeof parsed.sessionName !== "string"
			|| typeof parsed.token !== "string"
			|| typeof parsed.requestedAt !== "string"
		) {
			return undefined;
		}
		return {
			sessionName: parsed.sessionName,
			token: parsed.token,
			requestedAt: parsed.requestedAt,
		};
	} catch {
		return undefined;
	}
}

export function writeSplashReplaySignal(
	sessionName: string,
	options?: VibeDurablePathOptions,
): SplashReplaySignal {
	const signal: SplashReplaySignal = {
		sessionName,
		token: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
		requestedAt: new Date().toISOString(),
	};
	const signalPath = getSplashReplaySignalPath(sessionName, options);
	ensureParentDir(signalPath);
	writeFileSync(signalPath, JSON.stringify(signal, null, 2), "utf8");
	return signal;
}

function sanitizeSessionName(sessionName: string): string {
	return sessionName.trim().replaceAll(/[^A-Za-z0-9._-]+/g, "_");
}
