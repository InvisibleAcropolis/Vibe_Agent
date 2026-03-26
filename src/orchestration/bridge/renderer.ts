import { appendFile } from "node:fs/promises";
import type { CuratorSnapshot } from "./curator.js";

export interface CuratorCompactionAlert {
	active: boolean;
	pendingMessages?: number;
	reason?: string;
}

export interface CuratorRenderState {
	snapshots: CuratorSnapshot[];
	compaction?: CuratorCompactionAlert;
}

export interface CuratorDashboardRenderOptions {
	now?: () => number;
	maxAgents?: number;
	maxToolsPerAgent?: number;
}

export interface CuratorDashboardFrame {
	generatedAt: string;
	body: string;
}

export type CuratorDashboardTransport =
	| {
		type: "psmux-send-keys";
		runner: CuratorDashboardCommandRunner;
	}
	| {
		type: "named-pipe";
		pipePath: string;
	};

export interface CuratorDashboardCommandRunner {
	run(command: string, args: string[]): Promise<{ ok: boolean; stderr: string }>;
}

export interface CuratorDashboardOutputOptions {
	dashboardPaneId: string;
	transport: CuratorDashboardTransport;
	forbiddenPaneIds?: string[];
}

const DEFAULT_MAX_AGENTS = 8;
const DEFAULT_MAX_TOOLS_PER_AGENT = 3;

/**
 * Deterministically renders curator snapshots into a stable ASCII dashboard frame.
 * The frame is intentionally free of ANSI color/escape sequences so it is safe to
 * stream through psmux send-keys or named pipes.
 */
export function renderCuratorDashboardFrame(
	state: CuratorRenderState,
	options: CuratorDashboardRenderOptions = {},
): CuratorDashboardFrame {
	const nowMs = options.now?.() ?? Date.now();
	const generatedAt = new Date(nowMs).toISOString();
	const maxAgents = Math.max(1, options.maxAgents ?? DEFAULT_MAX_AGENTS);
	const maxToolsPerAgent = Math.max(1, options.maxToolsPerAgent ?? DEFAULT_MAX_TOOLS_PER_AGENT);
	const snapshots = [...state.snapshots]
		.sort((a, b) => a.agentId.localeCompare(b.agentId) || a.paneId.localeCompare(b.paneId))
		.slice(0, maxAgents);

	const lines: string[] = [];
	lines.push("+---------------- CURATOR DASHBOARD ----------------+");
	lines.push(`| generated: ${generatedAt.padEnd(42, " ")}|`);
	lines.push("+---------------------------------------------------+");

	if (snapshots.length === 0) {
		lines.push("| no active curator snapshots                        |");
	} else {
		for (const snapshot of snapshots) {
			const status = snapshot.status.toUpperCase();
			const turn = snapshot.turnId ?? "-";
			const toolSummary = summarizeTools(snapshot, maxToolsPerAgent);
			const timing = `${snapshot.timing.currentTurnDurationMs}ms turn / ${snapshot.timing.taskDurationMs}ms task`;
			lines.push(`| ${truncate(`agent=${snapshot.agentId} pane=${snapshot.paneId}`, 49).padEnd(49, " ")} |`);
			lines.push(`| ${truncate(`status=${status} turn=${turn}`, 49).padEnd(49, " ")} |`);
			lines.push(`| ${truncate(`tools=${toolSummary}`, 49).padEnd(49, " ")} |`);
			lines.push(`| ${truncate(`timing=${timing}`, 49).padEnd(49, " ")} |`);
			if (snapshot.finishReason) {
				lines.push(`| ${truncate(`finish=${snapshot.finishReason}`, 49).padEnd(49, " ")} |`);
			}
			lines.push("|---------------------------------------------------|");
		}
	}

	const compactionLine = state.compaction?.active
		? `COMPACTION ALERT pending=${state.compaction.pendingMessages ?? 0} reason=${state.compaction.reason ?? "unspecified"}`
		: "compaction=ok";
	lines.push(`| ${truncate(compactionLine, 49).padEnd(49, " ")} |`);
	lines.push("+---------------------------------------------------+");

	return {
		generatedAt,
		body: lines.join("\n"),
	};
}

/**
 * Sends rendered dashboard frames only to the dedicated curator dashboard surface.
 * Any attempt to route frame content to another pane is rejected.
 */
export class CuratorDashboardOutput {
	private readonly dashboardPaneId: string;
	private readonly transport: CuratorDashboardTransport;
	private readonly forbiddenPaneIds: Set<string>;

	constructor(options: CuratorDashboardOutputOptions) {
		this.dashboardPaneId = options.dashboardPaneId.trim();
		if (this.dashboardPaneId.length === 0) {
			throw new Error("A non-empty dashboardPaneId is required for curator output routing.");
		}
		this.transport = options.transport;
		this.forbiddenPaneIds = new Set((options.forbiddenPaneIds ?? []).map((pane) => pane.trim()).filter(Boolean));
	}

	async sendFrame(frame: CuratorDashboardFrame, paneId: string = this.dashboardPaneId): Promise<void> {
		const resolvedPaneId = paneId.trim();
		if (resolvedPaneId !== this.dashboardPaneId) {
			throw new Error(`Curator dashboard output can only target pane '${this.dashboardPaneId}', got '${resolvedPaneId}'.`);
		}
		if (this.forbiddenPaneIds.has(resolvedPaneId)) {
			throw new Error(`Refusing to emit curator output into forbidden pane '${resolvedPaneId}'.`);
		}

		if (this.transport.type === "named-pipe") {
			await appendFile(this.transport.pipePath, `${frame.body}\n`, "utf8");
			return;
		}

		for (const line of frame.body.split("\n")) {
			const result = await this.transport.runner.run("psmux", ["send-keys", "-t", this.dashboardPaneId, line, "Enter"]);
			if (!result.ok) {
				throw new Error(`Unable to route curator dashboard frame to pane '${this.dashboardPaneId}': ${result.stderr || "command failed"}`);
			}
		}
	}
}

function summarizeTools(snapshot: CuratorSnapshot, maxToolsPerAgent: number): string {
	if (snapshot.toolExecutions.length === 0) {
		return "none";
	}
	const pieces = [...snapshot.toolExecutions]
		.sort((a, b) => a.toolCallId.localeCompare(b.toolCallId))
		.slice(0, maxToolsPerAgent)
		.map((tool) => `${tool.toolName ?? tool.toolCallId}:${tool.status}`);
	if (snapshot.toolExecutions.length > maxToolsPerAgent) {
		pieces.push(`+${snapshot.toolExecutions.length - maxToolsPerAgent} more`);
	}
	return pieces.join(",");
}

function truncate(value: string, maxLen: number): string {
	if (value.length <= maxLen) {
		return value;
	}
	return `${value.slice(0, Math.max(0, maxLen - 3))}...`;
}
