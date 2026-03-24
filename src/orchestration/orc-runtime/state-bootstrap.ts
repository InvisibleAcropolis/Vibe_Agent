import { randomUUID } from "node:crypto";
import type { LaunchOrcRequest } from "../orc-io.js";
import {
	createInitialCheckpointMetadataSummary,
	createInitialReducedTransportHealth,
	createInitialTerminalStateSummary,
} from "../orc-events/control-plane-reducer.js";
import type { OrcCheckpointMetadata } from "../orc-checkpoints.js";
import type { OrcSecurityPolicy } from "../orc-security.js";
import type { OrcControlPlaneState, OrcLifecyclePhase } from "../orc-state.js";
import type { OrcRuntimeThreadContext } from "./types.js";
import type { ResumeOrcThreadRequest } from "../orc-io.js";

export function createInitialState(input: {
	threadId: string;
	checkpointId?: string;
	project: LaunchOrcRequest["project"];
	securityPolicy: OrcSecurityPolicy;
	phase: OrcLifecyclePhase;
	message: string;
}): OrcControlPlaneState {
	const now = new Date().toISOString();
	return {
		threadId: input.threadId,
		checkpointId: input.checkpointId,
		phase: input.phase,
		project: input.project,
		securityPolicy: input.securityPolicy,
		messages: [
			{
				id: `orc-message-${randomUUID()}`,
				role: "user",
				phase: input.phase,
				createdAt: now,
				content: input.message,
			},
		],
		workerResults: [],
		verificationErrors: [],
		checkpointMetadata: createInitialCheckpointMetadataSummary(),
		transportHealth: createInitialReducedTransportHealth(),
		terminalState: createInitialTerminalStateSummary(),
		lastUpdatedAt: now,
	};
}

export function buildLaunchInput(context: OrcRuntimeThreadContext, checkpoint?: OrcCheckpointMetadata) {
	const checkpointId = checkpoint?.checkpointId ?? context.state.checkpointId;
	return {
		threadId: context.threadId,
		projectRoot: context.state.project.projectRoot,
		workspaceRoot: context.securityPolicy.workerSandbox.workspaceRoot,
		phaseIntent: checkpoint ? `resume:${checkpoint.phase}` : `launch:${context.state.phase}`,
		securityPolicy: context.securityPolicy,
		checkpointId,
		runCorrelationId: context.runCorrelationId,
		metadata: {
			projectId: context.state.project.projectId,
			projectName: context.state.project.projectName ?? null,
			branchName: context.state.project.branchName ?? null,
		},
		resume: {
			checkpointId,
			resumeToken: checkpoint?.resumeData?.resumeToken,
			resumeCursor: checkpoint?.resumeData?.resumeCursor,
			activeWaveId: checkpoint?.resumeData?.activeWaveId,
			metadata: {
				...(checkpoint?.resumeData?.metadata ?? {}),
				trackerStateId: checkpoint?.trackerStateId ?? null,
				latestCheckpointId: checkpointId ?? null,
			},
		},
	};
}

export function createResumeState(input: {
	restoredState: OrcControlPlaneState;
	checkpoint?: OrcCheckpointMetadata;
}): OrcControlPlaneState {
	return {
		...input.restoredState,
		phase: input.checkpoint?.phase === "completed" || input.checkpoint?.phase === "cancelled"
			? input.checkpoint.phase
			: "bootstrapping",
		lastUpdatedAt: new Date().toISOString(),
	};
}

export function createResumeLaunchRequest(input: {
	request: ResumeOrcThreadRequest;
	restoredState: OrcControlPlaneState;
	checkpoint?: OrcCheckpointMetadata;
}): LaunchOrcRequest {
	return {
		project: input.restoredState.project,
		prompt: input.checkpoint?.resumeData?.instructions ?? `Resume Orc thread ${input.request.threadId}`,
		resumeThreadId: input.request.threadId,
		resumeCheckpointId: input.request.checkpointId ?? input.checkpoint?.checkpointId,
	};
}
