import type { OrcBusEvent } from "./orc-events.js";
import { getOrcSecurityTelemetryDisposition, isBlockingOrcSecurityEvent, type OrcSecurityEvent } from "./orc-security.js";
import type { OrcControlPlaneState, OrcReducedTransportHealth, OrcWorkerResultStatus } from "./orc-state.js";

export type OrcPresentationIntent = "neutral" | "active" | "success" | "warning" | "blocked" | "cancelled" | "failed";
export type OrcPresentationTone = "default" | "accent" | "success" | "warning" | "dim";
export type OrcTrackerSignOffStatus = "not-started" | "in-progress" | "blocked" | "ready" | "signed-off";

export interface OrcPresentedSummary {
	label: string;
	detail: string;
	intent: OrcPresentationIntent;
	tone: OrcPresentationTone;
}

export interface OrcTrackerTaskCounts {
	completed: number;
	blocked: number;
}

export interface OrcTrackerPresentationSummary {
	phase: OrcPresentedSummary;
	thread: OrcPresentedSummary;
	wave: OrcPresentedSummary;
	completedTasks: OrcPresentedSummary;
	blockedTasks: OrcPresentedSummary;
	checkpoint: OrcPresentedSummary;
	signOff: OrcPresentedSummary & { status: OrcTrackerSignOffStatus };
	highlights: string[];
	counts: OrcTrackerTaskCounts;
}

export function humanizeOrcValue(value: string): string {
	return value
		.replace(/[-_]+/g, " ")
		.replace(/\b\w/g, (match) => match.toUpperCase());
}

export function presentOrcEventSummary(event: OrcBusEvent): OrcPresentedSummary {
	switch (event.kind) {
		case "agent.message":
			return {
				label: event.interaction.isUserFacing ? "Agent responded to the user" : "Agent emitted an internal update",
				detail: event.payload.content || fallbackActorLabel(event.payload.workerId, "Agent") + " sent a message.",
				intent: "active",
				tone: "accent",
			};
		case "tool.call": {
			const toolName = event.payload.toolName || "Tool";
			const actor = fallbackActorLabel(event.payload.workerId ?? event.payload.agentId, "Agent");
			const preview = event.payload.commandPreview ? ` (${event.payload.commandPreview})` : "";
			return {
				label: "Tool action started",
				detail: `${actor} started ${toolName}${preview}.`,
				intent: event.payload.approvalRequired ? "blocked" : "active",
				tone: event.payload.approvalRequired ? "warning" : "accent",
			};
		}
		case "tool.result": {
			const toolName = event.payload.toolName || "Tool";
			const detail = firstNonEmpty(event.payload.errorText, event.payload.outputText, `${toolName} ${humanizeOrcValue(event.payload.status).toLowerCase()}.`);
			if (event.payload.status === "succeeded") {
				return { label: "Tool action succeeded", detail, intent: "success", tone: "success" };
			}
			if (event.payload.status === "cancelled") {
				return { label: "Tool action cancelled", detail, intent: "cancelled", tone: "warning" };
			}
			return {
				label: event.payload.status === "timed_out" ? "Tool action failed" : "Tool action failed",
				detail,
				intent: "failed",
				tone: "warning",
			};
		}
		case "worker.status":
			return presentWorkerStatus(event.payload.status, event.payload.workerId, event.payload.summary, event.payload.waveId);
		case "stream.warning":
			return {
				label: "Transport warning",
				detail: event.payload.message || "Transport emitted a warning.",
				intent: "warning",
				tone: "warning",
			};
		case "transport.fault":
			if (event.payload.status === "degraded") {
				return {
					label: "Transport degraded",
					detail: [event.payload.message, event.payload.remediationHint].filter(Boolean).join(" ") || "Transport degraded.",
					intent: "warning",
					tone: "warning",
				};
			}
			return {
				label: event.payload.status === "offline" ? "Transport failed" : "Transport failed",
				detail: [event.payload.message, event.payload.remediationHint].filter(Boolean).join(" ") || "Transport faulted.",
				intent: "failed",
				tone: "warning",
			};
		case "checkpoint.status":
			return {
				label: `Checkpoint ${checkpointVerb(event.payload.status)}`,
				detail: firstNonEmpty(event.payload.message, event.payload.checkpointId ? `Checkpoint ${event.payload.checkpointId}.` : undefined, `Checkpoint ${event.payload.status}.`),
				intent: event.payload.status === "failed" ? "failed" : event.payload.status === "stale" ? "warning" : "success",
				tone: event.payload.status === "failed" ? "warning" : event.payload.status === "stale" ? "warning" : "success",
			};
		case "security.approval":
			return presentSecurityEvent(event.payload.event);
		case "graph.lifecycle": {
			const graphId = event.payload.graphId || "Graph";
			if (event.payload.stage === "completed") {
				return { label: "Run completed", detail: `${graphId} completed.`, intent: "success", tone: "success" };
			}
			if (event.payload.stage === "failed") {
				return { label: "Run failed", detail: firstNonEmpty(event.payload.reason, `${graphId} failed.`), intent: "failed", tone: "warning" };
			}
			if (event.payload.stage === "cancelled") {
				return { label: "Run cancelled", detail: firstNonEmpty(event.payload.reason, `${graphId} cancelled.`), intent: "cancelled", tone: "warning" };
			}
			return { label: `Run ${humanizeOrcValue(event.payload.stage).toLowerCase()}`, detail: `${graphId} ${event.payload.stage}.`, intent: "active", tone: "accent" };
		}
		case "process.lifecycle":
			if (event.payload.stage === "ready") {
				return { label: "Transport recovered", detail: "Runner is ready and emitting telemetry again.", intent: "success", tone: "success" };
			}
			if (event.payload.stage === "terminated" || event.payload.stage === "exited") {
				return {
					label: event.payload.exitCode === 0 ? "Transport completed" : event.payload.failureCode === "transport_user_cancellation" ? "Run cancelled" : "Transport stopped",
					detail: firstNonEmpty(event.payload.reason, event.payload.remediationHint, processExitDetail(event.payload.exitCode, event.payload.signal)),
					intent: event.payload.failureCode === "transport_user_cancellation" ? "cancelled" : event.payload.exitCode === 0 ? "success" : "failed",
					tone: event.payload.exitCode === 0 ? "success" : "warning",
				};
			}
			return {
				label: event.payload.stage === "spawned" ? "Transport started" : "Transport update",
				detail: processExitDetail(event.payload.exitCode, event.payload.signal, event.payload.pid),
				intent: "active",
				tone: "accent",
			};
	}
}

export function presentOrcTrackerSummary(state?: OrcControlPlaneState): OrcTrackerPresentationSummary {
	const counts = countTrackerTasks(state);
	const signOffStatus = deriveTrackerSignOffStatus(state, counts.blocked);
	const transportSummary = presentTransportHealthSummary(state?.transportHealth);
	const highlights = buildStateHighlights(state, counts, signOffStatus, transportSummary);
	const phaseSummary = presentPhaseSummary(state);
	return {
		phase: phaseSummary,
		thread: state?.threadId
			? { label: state.threadId, detail: `Active Orc thread: ${state.threadId}.`, intent: "neutral", tone: "default" }
			: { label: "No thread selected", detail: "Launch or resume an Orc thread to populate tracker state.", intent: "neutral", tone: "dim" },
		wave: state?.activeWave?.waveId
			? { label: state.activeWave.waveId, detail: firstNonEmpty(state.activeWave.goal, `Active wave ${state.activeWave.waveId}.`), intent: "active", tone: "default" }
			: { label: "No wave in progress", detail: "No execution wave is active right now.", intent: "neutral", tone: "dim" },
		completedTasks: { label: String(counts.completed), detail: `${counts.completed} completed task${counts.completed === 1 ? "" : "s"}.`, intent: counts.completed > 0 ? "success" : "neutral", tone: counts.completed > 0 ? "success" : "dim" },
		blockedTasks: { label: String(counts.blocked), detail: `${counts.blocked} blocked, cancelled, or failed item${counts.blocked === 1 ? "" : "s"}.`, intent: counts.blocked > 0 ? "blocked" : "neutral", tone: counts.blocked > 0 ? "warning" : "dim" },
		checkpoint: presentCheckpointField(state),
		signOff: { ...presentTrackerSignOff(signOffStatus), status: signOffStatus },
		highlights,
		counts,
	};
}

export function deriveTrackerSignOffStatus(state: OrcControlPlaneState | undefined, blockedTasks: number): OrcTrackerSignOffStatus {
	if (!state) {
		return "not-started";
	}
	if (hasBlockingSecurityState(state) || blockedTasks > 0 || state.phase === "failed" || state.phase === "cancelled") {
		return "blocked";
	}
	if (state.phase === "completed") {
		return "signed-off";
	}
	if (state.phase === "checkpointed") {
		return "ready";
	}
	return "in-progress";
}

export function countTrackerTasks(state?: OrcControlPlaneState): OrcTrackerTaskCounts {
	return {
		completed: state?.workerResults.filter((result) => result.status === "completed").length ?? 0,
		blocked: (state?.workerResults.filter((result) => isBlockedWorkerResult(result.status)).length ?? 0)
			+ (state?.securityEvents?.filter((event) => isBlockingOrcSecurityEvent(event)).length ?? 0),
	};
}

function presentWorkerStatus(status: string, workerId?: string, summary?: string, waveId?: string): OrcPresentedSummary {
	const workerLabel = fallbackActorLabel(workerId, "Worker");
	const context = waveId ? ` in ${waveId}` : "";
	const detail = firstNonEmpty(summary, `${workerLabel}${context} is ${humanizeOrcValue(status).toLowerCase()}.`);
	if (status === "completed") {
		return { label: "Worker completed", detail, intent: "success", tone: "success" };
	}
	if (status === "failed") {
		return { label: "Worker failed", detail, intent: "failed", tone: "warning" };
	}
	if (status === "cancelled") {
		return { label: "Worker cancelled", detail, intent: "cancelled", tone: "warning" };
	}
	if (status === "queued") {
		return { label: "Worker queued", detail, intent: "active", tone: "accent" };
	}
	if (status === "waiting_on_input") {
		return { label: "Worker waiting on input", detail, intent: "warning", tone: "warning" };
	}
	return { label: "Worker started", detail, intent: "active", tone: "accent" };
}

function presentSecurityEvent(event: OrcSecurityEvent): OrcPresentedSummary {
	const disposition = getOrcSecurityTelemetryDisposition(event);
	if (disposition === "informational") {
		return {
			label: "Security notice",
			detail: firstNonEmpty(event.detail, event.command ? `Security notice for ${event.command}.` : undefined, "A policy notice was recorded."),
			intent: "warning",
			tone: "default",
		};
	}
	if (event.kind === "blocked-command") {
		return {
			label: "Command blocked",
			detail: firstNonEmpty(event.detail, event.command ? `Blocked command: ${event.command}.` : undefined, "A command was blocked by policy."),
			intent: "blocked",
			tone: "warning",
		};
	}
	return {
		label: "Approval required",
		detail: firstNonEmpty(event.detail, event.command ? `Approval required for ${event.command}.` : undefined, "Human approval is required before work can continue."),
		intent: "blocked",
		tone: "warning",
	};
}

function presentTransportHealthSummary(transportHealth?: OrcReducedTransportHealth): OrcPresentedSummary {
	if (!transportHealth) {
		return { label: "Transport unknown", detail: "No transport health has been recorded yet.", intent: "neutral", tone: "dim" };
	}
	if (transportHealth.status === "healthy") {
		return {
			label: "Transport healthy",
			detail: firstNonEmpty(transportHealth.lastMessage, "Transport recovered and is processing events normally."),
			intent: "success",
			tone: "success",
		};
	}
	if (transportHealth.status === "degraded") {
		return {
			label: "Transport degraded",
			detail: firstNonEmpty(transportHealth.lastMessage, transportHealth.lastRemediationHint, "Transport is degraded but still receiving events."),
			intent: "warning",
			tone: "warning",
		};
	}
	if (transportHealth.status === "faulted" || transportHealth.status === "offline") {
		return {
			label: "Transport failed",
			detail: firstNonEmpty(transportHealth.lastMessage, transportHealth.lastRemediationHint, "Transport stopped delivering reliable telemetry."),
			intent: "failed",
			tone: "warning",
		};
	}
	return { label: "Transport unknown", detail: "Transport health is still being established.", intent: "neutral", tone: "dim" };
}

function presentCheckpointField(state?: OrcControlPlaneState): OrcPresentedSummary {
	if (!state?.checkpointId) {
		return { label: "No checkpoint captured", detail: "No checkpoint has been captured for this thread yet.", intent: "neutral", tone: "dim" };
	}
	const status = state.checkpointMetadata?.status;
	return {
		label: state.checkpointId,
		detail: firstNonEmpty(state.checkpointMetadata?.message, `Checkpoint ${state.checkpointId} is ${humanizeOrcValue(status ?? "captured").toLowerCase()}.`),
		intent: status === "failed" ? "failed" : status === "stale" ? "warning" : "success",
		tone: status === "failed" || status === "stale" ? "warning" : "default",
	};
}

function presentTrackerSignOff(status: OrcTrackerSignOffStatus): OrcPresentedSummary {
	switch (status) {
		case "signed-off":
			return { label: "Signed Off", detail: "The tracker reflects a completed run with no unresolved blockers.", intent: "success", tone: "success" };
		case "ready":
			return { label: "Ready", detail: "The tracker is checkpointed and ready for human review.", intent: "success", tone: "success" };
		case "blocked":
			return { label: "Blocked", detail: "Blocked, cancelled, or failed work requires attention before sign-off.", intent: "blocked", tone: "warning" };
		case "in-progress":
			return { label: "In Progress", detail: "The tracker is still receiving live orchestration updates.", intent: "active", tone: "accent" };
		default:
			return { label: "Not Started", detail: "No Orc tracker state is available yet.", intent: "neutral", tone: "dim" };
	}
}

function buildStateHighlights(
	state: OrcControlPlaneState | undefined,
	counts: OrcTrackerTaskCounts,
	signOffStatus: OrcTrackerSignOffStatus,
	transportSummary: OrcPresentedSummary,
): string[] {
	if (!state) {
		return [
			"Start from the Orc menu to spin up an orchestration thread.",
			"Default tracker labels are concise summaries; open raw event drill-down views for canonical payload detail.",
		];
	}
	const highlights = [
		`Project: ${state.project.projectName ?? state.project.projectId}`,
		`Last updated: ${state.lastUpdatedAt}`,
		transportSummary.label,
	];
	if (state.activeWave?.goal) {
		highlights.push(`Wave goal: ${state.activeWave.goal}`);
	}
	if (counts.completed > 0) {
		highlights.push(`${counts.completed} completed task${counts.completed === 1 ? "" : "s"} recorded.`);
	}
	if (counts.blocked > 0) {
		highlights.push(`${counts.blocked} blocked, cancelled, or failed item${counts.blocked === 1 ? "" : "s"} need attention.`);
	}
	if (state.transportHealth.retryability) {
		highlights.push(`Retryability: ${humanizeOrcValue(state.transportHealth.retryability)}.`);
	}
	if (state.terminalState.remediationHint) {
		highlights.push(`Remediation: ${state.terminalState.remediationHint}`);
	}
	if (signOffStatus === "ready") {
		highlights.push("Tracker is checkpointed and ready for human review.");
	}
	return highlights;
}

function checkpointVerb(status: string): string {
	switch (status) {
		case "captured": return "captured";
		case "restored": return "restored";
		case "failed": return "failed";
		case "started": return "started";
		case "stale": return "stale";
		default: return humanizeOrcValue(status).toLowerCase();
	}
}

function isBlockedWorkerResult(status: OrcWorkerResultStatus): boolean {
	return status === "failed" || status === "cancelled" || status === "partial" || status === "ambiguous";
}

function fallbackActorLabel(value: string | undefined, fallback: string): string {
	return value && value.trim().length > 0 ? value : fallback;
}

function processExitDetail(exitCode?: number, signal?: string, pid?: number): string {
	const parts = [
		pid === undefined ? undefined : `pid ${pid}`,
		exitCode === undefined ? undefined : `exit code ${exitCode}`,
		signal === undefined ? undefined : `signal ${signal}`,
	].filter(Boolean);
	return parts.length > 0 ? `Transport ${parts.join(", ")}.` : "Transport lifecycle update recorded.";
}

function firstNonEmpty(...values: Array<string | undefined>): string {
	for (const value of values) {
		if (value && value.trim().length > 0) {
			return value;
		}
	}
	return "No additional detail available.";
}


function hasBlockingSecurityState(state: OrcControlPlaneState): boolean {
	return state.securityEvents?.some((event) => isBlockingOrcSecurityEvent(event)) ?? false;
}

function presentPhaseSummary(state?: OrcControlPlaneState): OrcPresentedSummary {
	if (!state) {
		return { label: "Waiting for graph", detail: "No orchestration thread is active yet.", intent: "neutral", tone: "dim" };
	}
	const latestSecurity = [...(state.securityEvents ?? [])].reverse().find((event) => isBlockingOrcSecurityEvent(event));
	if (latestSecurity?.kind === "approval-required") {
		return { label: "Awaiting Approval", detail: latestSecurity.detail || "Human approval is required before execution can continue.", intent: "blocked", tone: "warning" };
	}
	if (latestSecurity?.kind === "blocked-command") {
		return { label: "Blocked By Policy", detail: latestSecurity.detail || "A command was blocked by security policy.", intent: "blocked", tone: "warning" };
	}
	if (state.phase === "failed") {
		return { label: humanizeOrcValue(state.phase), detail: `Current lifecycle phase: ${humanizeOrcValue(state.phase)}.`, intent: "failed", tone: "warning" };
	}
	if (state.phase === "completed" || state.phase === "checkpointed") {
		return { label: humanizeOrcValue(state.phase), detail: `Current lifecycle phase: ${humanizeOrcValue(state.phase)}.`, intent: "success", tone: state.phase === "completed" ? "success" : "default" };
	}
	return { label: humanizeOrcValue(state.phase), detail: `Current lifecycle phase: ${humanizeOrcValue(state.phase)}.`, intent: "active", tone: "accent" };
}
