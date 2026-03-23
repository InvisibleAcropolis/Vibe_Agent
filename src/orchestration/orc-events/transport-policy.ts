/**
 * Transport policy boundary: classify transport warning/fault codes and retry dispositions.
 * Normalization may attach this policy metadata, while reducers should prefer normalized fields already carried on events.
 */
import type {
	OrcFailureDisposition,
	OrcTransportFaultBoundaryRule,
	OrcTransportFaultCode,
	OrcTransportWarningCode,
} from "./types.js";

export const ORC_TRANSPORT_FAULT_BOUNDARY_RULES: Record<
	OrcTransportWarningCode | OrcTransportFaultCode,
	OrcTransportFaultBoundaryRule
> = {
	transport_parse_noise: {
		code: "transport_parse_noise",
		boundary: "recoverable_noise",
		defaultStatus: "degraded",
		recovery: "continue_stream",
		description: "A single completed stdout line could not be decoded or normalized, but newline framing remains intact.",
	},
	transport_idle_timeout: {
		code: "transport_idle_timeout",
		boundary: "recoverable_noise",
		defaultStatus: "degraded",
		recovery: "continue_stream",
		description: "The child process has gone quiet longer than the idle threshold but has not yet exceeded the fatal stall timeout.",
	},
	transport_partial_line_truncated: {
		code: "transport_partial_line_truncated",
		boundary: "recoverable_noise",
		defaultStatus: "degraded",
		recovery: "continue_stream",
		description: "End-of-stream arrived with an unterminated stdout JSONL fragment, so the partial bytes were reported instead of silently parsed or dropped.",
	},
	transport_stderr_truncated: {
		code: "transport_stderr_truncated",
		boundary: "recoverable_noise",
		defaultStatus: "degraded",
		recovery: "continue_stream",
		description: "A stderr diagnostic snippet exceeded the preview budget and was truncated for UI/debug safety.",
	},
	transport_corrupt_stream: {
		code: "transport_corrupt_stream",
		boundary: "fatal_corruption",
		defaultStatus: "faulted",
		recovery: "request_supervisor_restart",
		description: "Repeated malformed stdout lines or invalid envelope structure indicate the JSONL stream can no longer be trusted.",
	},
	transport_ready_timeout: {
		code: "transport_ready_timeout",
		boundary: "fatal_corruption",
		defaultStatus: "faulted",
		recovery: "request_supervisor_restart",
		description: "The child process spawned but failed to produce a valid ready-capable envelope before the launch timeout elapsed.",
	},
	transport_stall_timeout: {
		code: "transport_stall_timeout",
		boundary: "fatal_corruption",
		defaultStatus: "faulted",
		recovery: "request_supervisor_restart",
		description: "No stdout/stderr progress was observed beyond the fatal stall threshold, so the transport should be considered hung.",
	},
	transport_stdout_overflow: {
		code: "transport_stdout_overflow",
		boundary: "fatal_corruption",
		defaultStatus: "faulted",
		recovery: "terminate_transport",
		description: "The stdout assembler buffer exceeded its byte budget before a newline arrived, destroying trustworthy record boundaries.",
	},
	transport_startup_failure: {
		code: "transport_startup_failure",
		boundary: "fatal_corruption",
		defaultStatus: "faulted",
		recovery: "request_supervisor_restart",
		description: "The runner failed before a stable ready state was established.",
	},
	transport_disconnect: {
		code: "transport_disconnect",
		boundary: "fatal_corruption",
		defaultStatus: "offline",
		recovery: "request_supervisor_restart",
		description: "The transport disconnected unexpectedly and may require replay-aware recovery.",
	},
	transport_broken_pipe: {
		code: "transport_broken_pipe",
		boundary: "fatal_corruption",
		defaultStatus: "faulted",
		recovery: "request_supervisor_restart",
		description: "A required IPC pipe closed unexpectedly while the runtime was communicating with the runner.",
	},
	transport_non_zero_exit: {
		code: "transport_non_zero_exit",
		boundary: "fatal_corruption",
		defaultStatus: "offline",
		recovery: "request_supervisor_restart",
		description: "The runner exited with a non-zero status code.",
	},
	transport_signal_shutdown: {
		code: "transport_signal_shutdown",
		boundary: "fatal_corruption",
		defaultStatus: "offline",
		recovery: "request_supervisor_restart",
		description: "The runner was terminated by SIGTERM/SIGINT or another external signal.",
	},
	transport_user_cancellation: {
		code: "transport_user_cancellation",
		boundary: "fatal_corruption",
		defaultStatus: "offline",
		recovery: "terminate_transport",
		description: "The operator intentionally cancelled the run.",
	},
	transport_ambiguous_terminal_state: {
		code: "transport_ambiguous_terminal_state",
		boundary: "fatal_corruption",
		defaultStatus: "faulted",
		recovery: "request_supervisor_restart",
		description: "Conflicting terminal signals were observed and the true final state is ambiguous.",
	},
};

export function classifyOrcTransportIssue(
	code: OrcTransportWarningCode | OrcTransportFaultCode,
): OrcTransportFaultBoundaryRule {
	return ORC_TRANSPORT_FAULT_BOUNDARY_RULES[code];
}

export const ORC_FAILURE_DISPOSITIONS: Record<OrcTransportFaultCode, OrcFailureDisposition> = {
	transport_corrupt_stream: {
		code: "transport_corrupt_stream",
		terminalState: "failed",
		retryability: "phase_2_retryable",
		remediationHint: "Restart the Python runner; the JSONL framing is no longer trustworthy.",
		phase2Decision: "Supervisor restart is allowed in Phase 2 because no durable replay is required before relaunch.",
	},
	transport_ready_timeout: {
		code: "transport_ready_timeout",
		terminalState: "failed",
		retryability: "phase_2_retryable",
		remediationHint: "Confirm the runner bootstrap command and Python environment, then relaunch the transport.",
		phase2Decision: "Phase 2 may retry bootstrap failures by starting a fresh transport process.",
	},
	transport_stall_timeout: {
		code: "transport_stall_timeout",
		terminalState: "failed",
		retryability: "phase_2_retryable",
		remediationHint: "Terminate the hung runner and start a fresh transport session.",
		phase2Decision: "Phase 2 may restart a hung transport because work replay is not attempted yet.",
	},
	transport_stdout_overflow: {
		code: "transport_stdout_overflow",
		terminalState: "failed",
		retryability: "not_retryable",
		remediationHint: "Reduce runner output volume or fix framing before retrying; the current stream exceeded the safety budget.",
		phase2Decision: "Deferred for manual remediation because Phase 2 cannot safely recover the lost record boundary.",
	},
	transport_startup_failure: {
		code: "transport_startup_failure",
		terminalState: "failed",
		retryability: "phase_2_retryable",
		remediationHint: "Verify the spawn contract, executable path, and permissions, then relaunch.",
		phase2Decision: "Phase 2 can retry spawn/setup failures with a clean process start.",
	},
	transport_disconnect: {
		code: "transport_disconnect",
		terminalState: "failed",
		retryability: "phase_3_recovery",
		remediationHint: "Inspect runner logs and use checkpoint/replay recovery when it becomes available; Phase 2 only records the failure.",
		phase2Decision: "Deferred to Phase 3 because reconnecting may require durable replay to reconstruct in-flight state.",
	},
	transport_broken_pipe: {
		code: "transport_broken_pipe",
		terminalState: "failed",
		retryability: "phase_2_retryable",
		remediationHint: "The child closed its pipe unexpectedly; inspect stderr and launch a fresh runner.",
		phase2Decision: "Phase 2 may retry broken-pipe failures by starting a new transport process.",
	},
	transport_non_zero_exit: {
		code: "transport_non_zero_exit",
		terminalState: "failed",
		retryability: "phase_3_recovery",
		remediationHint: "Review stderr and tracker snapshots before relaunching; durable replay is needed to recover in-flight work safely.",
		phase2Decision: "Deferred to Phase 3 because the process may have exited mid-wave without replayable completion state.",
	},
	transport_signal_shutdown: {
		code: "transport_signal_shutdown",
		terminalState: "failed",
		retryability: "phase_3_recovery",
		remediationHint: "Determine whether an external SIGTERM/SIGINT interrupted the run, then resume only after replay support is available.",
		phase2Decision: "Deferred to Phase 3 because signal interruptions may leave partial side effects that need replay-aware recovery.",
	},
	transport_user_cancellation: {
		code: "transport_user_cancellation",
		terminalState: "cancelled",
		retryability: "phase_2_retryable",
		remediationHint: "Operator cancellation is final for this run; start a new run or resume from a later checkpoint if desired.",
		phase2Decision: "Phase 2 treats user cancellation as an intentional terminal state and allows launching a fresh run later.",
	},
	transport_ambiguous_terminal_state: {
		code: "transport_ambiguous_terminal_state",
		terminalState: "ambiguous",
		retryability: "phase_3_recovery",
		remediationHint: "Inspect tracker state and logs before resume; conflicting terminal signals require operator-guided recovery.",
		phase2Decision: "Deferred to Phase 3 because conflicting terminal signals require durable recovery/replay analysis.",
	},
};

export function classifyOrcFailureDisposition(code: OrcTransportFaultCode): OrcFailureDisposition {
	return ORC_FAILURE_DISPOSITIONS[code];
}
