import type { OrcCanonicalEventEnvelope } from "../orc-io.js";
import { evaluateParseFailurePolicy } from "./parse-failure-policy.js";
import type { AssembledLine, OrcPythonTransportHealth, StderrSnippet } from "./types.js";

export type StdoutParseResult =
	| { kind: "ignore" }
	| { kind: "canonical_envelope"; envelope: OrcCanonicalEventEnvelope; observedAt: string }
	| { kind: "policy_request"; observedAt: string; policy: ReturnType<typeof evaluateParseFailurePolicy> };

export function handleStdoutLine(params: {
	line: AssembledLine;
	health: OrcPythonTransportHealth;
	recentStderr: StderrSnippet[];
	fatalParseFailureCount: number;
	stdoutBufferedBytes: number;
}): StdoutParseResult {
	const { fatalParseFailureCount, health, line, recentStderr, stdoutBufferedBytes } = params;
	const normalizedLine = line.text.endsWith("\r") ? line.text.slice(0, -1) : line.text;
	const trimmedLine = normalizedLine.trim();
	if (trimmedLine.length === 0) {
		return { kind: "ignore" };
	}
	const observedAt = new Date().toISOString();
	health.stdoutLines += 1;
	health.lastEventAt = observedAt;
	let envelope: OrcCanonicalEventEnvelope | undefined;
	try {
		envelope = JSON.parse(trimmedLine) as OrcCanonicalEventEnvelope;
	} catch (error) {
		return noteParseFailure({
			byteLength: line.byteLength,
			detail: error instanceof Error ? error.message : String(error),
			fatalParseFailureCount,
			health,
			line: trimmedLine,
			message: `Failed to parse stdout JSONL line ${health.stdoutLines}.`,
			recentStderr,
			stdoutBufferedBytes,
		});
	}
	if (!isCanonicalEnvelope(envelope)) {
		return noteParseFailure({
			byteLength: line.byteLength,
			detail: "Missing required canonical envelope fields.",
			fatalParseFailureCount,
			health,
			line: trimmedLine,
			message: `Stdout line ${health.stdoutLines} decoded as JSON but did not satisfy the canonical envelope contract.`,
			recentStderr,
			stdoutBufferedBytes,
		});
	}
	health.consecutiveParseFailures = 0;
	health.lastStdoutEventId = envelope.origin.eventId;
	health.lastStdoutSequence = envelope.origin.streamSequence;
	return { kind: "canonical_envelope", envelope, observedAt };
}

export function noteParseFailure(params: {
	message: string;
	line: string;
	byteLength: number;
	detail: string;
	health: OrcPythonTransportHealth;
	recentStderr: StderrSnippet[];
	stdoutBufferedBytes: number;
	fatalParseFailureCount: number;
}): StdoutParseResult {
	const { byteLength, detail, fatalParseFailureCount, health, line, message, recentStderr, stdoutBufferedBytes } = params;
	health.parseFailures += 1;
	health.consecutiveParseFailures += 1;
	health.lastErrorAt = health.lastEventAt;
	health.lastError = `transport_parse_noise: ${detail}`;
	return {
		kind: "policy_request",
		observedAt: new Date().toISOString(),
		policy: evaluateParseFailurePolicy({
			message,
			line,
			byteLength,
			detail,
			lineSequence: health.stdoutLines,
			consecutiveParseFailures: health.consecutiveParseFailures,
			fatalParseFailureCount,
			stdoutBufferedBytes,
			lastStdoutSequence: health.lastStdoutSequence,
			recentStderr,
		}),
	};
}

export function isCanonicalEnvelope(value: unknown): value is OrcCanonicalEventEnvelope {
	if (!value || typeof value !== "object") {
		return false;
	}
	const envelope = value as OrcCanonicalEventEnvelope;
	return Boolean(
		envelope.origin?.eventId &&
			typeof envelope.origin.eventId === "string" &&
			envelope.origin.runCorrelationId &&
			typeof envelope.origin.runCorrelationId === "string" &&
			typeof envelope.origin.streamSequence === "number" &&
			typeof envelope.origin.emittedAt === "string" &&
			envelope.who?.id &&
			typeof envelope.who.id === "string" &&
			envelope.what?.name &&
			typeof envelope.what.name === "string" &&
			envelope.what?.category &&
			typeof envelope.what.category === "string" &&
			envelope.how?.channel &&
			typeof envelope.how.channel === "string" &&
			typeof envelope.when === "string",
	);
}

export function previewLine(value: string, max = 160): string {
	return value.length <= max ? value : `${value.slice(0, max)}…`;
}

export function extractObservedSequenceHint(line: string): number | undefined {
	const match = line.match(/"streamSequence"\s*:\s*(\d+)/u);
	return match ? Number(match[1]) : undefined;
}
