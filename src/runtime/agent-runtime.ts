import type { AgentHost } from "../agent-host.js";

export type RuntimeKind = "coding" | "worker" | "tool";

export type RuntimeCapability =
	| "interactive-prompt"
	| "session-management"
	| "model-selection"
	| "artifact-source"
	| "memory-store"
	| "log-source"
	| "background-processing";

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
