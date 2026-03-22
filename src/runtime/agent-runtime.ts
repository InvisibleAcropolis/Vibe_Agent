import type { AgentHost } from "../agent-host.js";

export type RuntimeKind = "coding" | "orchestration" | "worker" | "tool";

export type RuntimeCapability =
	| "interactive-prompt"
	| "session-management"
	| "model-selection"
	| "artifact-source"
	| "memory-store"
	| "log-source"
	| "background-processing"
	| "planning"
	| "checkpoint-visibility"
	| "orchestration-status";

export interface RuntimeDescriptor {
	id: string;
	kind: RuntimeKind;
	displayName: string;
	capabilities: RuntimeCapability[];
	primary?: boolean;
}

export interface AgentRuntime extends AgentHost {
	readonly descriptor: RuntimeDescriptor;
}
