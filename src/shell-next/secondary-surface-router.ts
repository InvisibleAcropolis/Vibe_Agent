import { readFileSync, writeFileSync } from "node:fs";
import { ensureParentDir, getVibeTrackerPath, type VibeDurablePathOptions } from "../durable/durable-paths.js";

export type SecondarySurfaceRouteAction = "open" | "focus" | "close";

export interface SecondarySurfaceRouteSignal {
	sessionName: string;
	surfaceId: string;
	route: string;
	action: SecondarySurfaceRouteAction;
	reason?: "open" | "focus";
	payload?: Record<string, unknown>;
	requestedAt: string;
	token: string;
}

export function getSecondarySurfaceRouteSignalPath(sessionName: string, options?: VibeDurablePathOptions): string {
	return getVibeTrackerPath(`secondary-surface-route-${sanitizeSessionName(sessionName)}.json`, options);
}

export function readSecondarySurfaceRouteSignal(
	sessionName: string,
	options?: VibeDurablePathOptions,
): SecondarySurfaceRouteSignal | undefined {
	try {
		const raw = readFileSync(getSecondarySurfaceRouteSignalPath(sessionName, options), "utf8");
		const parsed = JSON.parse(raw) as Partial<SecondarySurfaceRouteSignal>;
		if (
			typeof parsed.sessionName !== "string"
			|| typeof parsed.surfaceId !== "string"
			|| typeof parsed.route !== "string"
			|| (parsed.action !== "open" && parsed.action !== "focus" && parsed.action !== "close")
			|| typeof parsed.requestedAt !== "string"
			|| typeof parsed.token !== "string"
		) {
			return undefined;
		}
		return {
			sessionName: parsed.sessionName,
			surfaceId: parsed.surfaceId,
			route: parsed.route,
			action: parsed.action,
			reason: parsed.reason === "open" || parsed.reason === "focus" ? parsed.reason : undefined,
			payload: isRecord(parsed.payload) ? parsed.payload : undefined,
			requestedAt: parsed.requestedAt,
			token: parsed.token,
		};
	} catch {
		return undefined;
	}
}

export function writeSecondarySurfaceRouteSignal(
	input: {
		sessionName: string;
		surfaceId: string;
		route: string;
		action: SecondarySurfaceRouteAction;
		reason?: "open" | "focus";
		payload?: Record<string, unknown>;
	},
	options?: VibeDurablePathOptions,
): SecondarySurfaceRouteSignal {
	const signal: SecondarySurfaceRouteSignal = {
		sessionName: input.sessionName,
		surfaceId: input.surfaceId,
		route: input.route,
		action: input.action,
		reason: input.reason,
		payload: input.payload,
		requestedAt: new Date().toISOString(),
		token: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
	};
	const signalPath = getSecondarySurfaceRouteSignalPath(input.sessionName, options);
	ensureParentDir(signalPath);
	writeFileSync(signalPath, JSON.stringify(signal, null, 2), "utf8");
	return signal;
}

function sanitizeSessionName(sessionName: string): string {
	return sessionName.trim().replaceAll(/[^A-Za-z0-9._-]+/g, "_");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
