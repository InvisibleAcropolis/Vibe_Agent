import { classifyOrcTransportIssue, type OrcTransportFaultCode, type OrcTransportWarningCode } from "../orc-events/index.js";
import type { StderrSnippet } from "./types.js";
import { extractObservedSequenceHint, previewLine } from "./protocol-parser.js";
import type { OrcTransportPolicyResult } from "./policy-results.js";

export function evaluateParseFailurePolicy(params: {
	message: string;
	line: string;
	byteLength: number;
	detail: string;
	lineSequence: number;
	consecutiveParseFailures: number;
	fatalParseFailureCount: number;
	stdoutBufferedBytes: number;
	lastStdoutSequence?: number;
	recentStderr: StderrSnippet[];
}): OrcTransportPolicyResult {
	const {
		byteLength,
		consecutiveParseFailures,
		detail,
		fatalParseFailureCount,
		lastStdoutSequence,
		line,
		lineSequence,
		message,
		recentStderr,
		stdoutBufferedBytes,
	} = params;
	const warningCode: OrcTransportWarningCode = "transport_parse_noise";
	const warning = {
		kind: "warning" as const,
		code: warningCode,
		message,
		payload: {
			stream: "stdout",
			warningCode,
			message: `${message} ${detail}`,
			lineSequence,
			recoverable: true,
			linePreview: previewLine(line),
			lineBytes: byteLength,
			bufferedBytes: stdoutBufferedBytes,
			expectedSequenceHint: lastStdoutSequence === undefined ? undefined : lastStdoutSequence + 1,
			observedSequenceHint: extractObservedSequenceHint(line),
			stderrSnippets: recentStderr,
		},
	};
	if (consecutiveParseFailures < fatalParseFailureCount) {
		return { emissions: [warning], action: mapRecoveryToAction(warning.code) };
	}
	const faultCode: OrcTransportFaultCode = "transport_corrupt_stream";
	return {
		emissions: [warning, {
			kind: "fault",
			code: faultCode,
			message: "Repeated stdout parse failures crossed the fatal corruption threshold.",
			payload: {
				...warning.payload,
				retryable: true,
				failureThreshold: fatalParseFailureCount,
				consecutiveParseFailures,
			},
		}],
		action: mapRecoveryToAction(faultCode),
	};
}

function mapRecoveryToAction(code: Parameters<typeof classifyOrcTransportIssue>[0]): OrcTransportPolicyResult["action"] {
	const rule = classifyOrcTransportIssue(code);
	return rule.recovery === "continue_stream" ? "continue" : rule.recovery === "request_supervisor_restart" ? "restart" : "terminate";
}
