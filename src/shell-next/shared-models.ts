export type TranscriptItemKind =
	| "user"
	| "assistant-text"
	| "assistant-thinking"
	| "tool-call"
	| "tool-result"
	| "artifact"
	| "runtime-status"
	| "subagent-event"
	| "checkpoint"
	| "error";

export type TranscriptPartKind =
	| "summary"
	| "text"
	| "thinking"
	| "detail"
	| "status"
	| "artifact-link"
	| "metadata";

export type TranscriptActionKind = "expand" | "collapse" | "open-overlay" | "open-surface";

export interface TranscriptActionTarget {
	readonly itemId: string;
	readonly partId?: string;
}

export interface TranscriptActionHooks {
	onExpand?: (target: TranscriptActionTarget) => void;
	onCollapse?: (target: TranscriptActionTarget) => void;
	onOpenOverlay?: (target: TranscriptActionTarget) => void;
	onOpenSurface?: (target: TranscriptActionTarget) => void;
}

export interface TranscriptAction {
	readonly id: string;
	readonly kind: TranscriptActionKind;
	readonly label: string;
	readonly disabled?: boolean;
	readonly target: TranscriptActionTarget;
	readonly run: () => void;
}

interface TranscriptNodeBase {
	readonly id: string;
	readonly actions?: readonly TranscriptAction[];
	readonly hooks?: TranscriptActionHooks;
	readonly expanded?: boolean;
}

export interface TranscriptPart extends TranscriptNodeBase {
	readonly kind: TranscriptPartKind;
	readonly title?: string;
	readonly text?: string;
	readonly badges?: readonly string[];
	readonly parts?: readonly TranscriptPart[];
}

interface TranscriptItemBase extends TranscriptNodeBase {
	readonly timestamp: string;
	readonly runtimeId?: string;
	readonly sessionId?: string;
	readonly title?: string;
	readonly summary: string;
	readonly parts: readonly TranscriptPart[];
}

export interface UserTranscriptItem extends TranscriptItemBase {
	readonly kind: "user";
}

export interface AssistantTextTranscriptItem extends TranscriptItemBase {
	readonly kind: "assistant-text";
}

export interface AssistantThinkingTranscriptItem extends TranscriptItemBase {
	readonly kind: "assistant-thinking";
}

export interface ToolCallTranscriptItem extends TranscriptItemBase {
	readonly kind: "tool-call";
	readonly toolName: string;
}

export interface ToolResultTranscriptItem extends TranscriptItemBase {
	readonly kind: "tool-result";
	readonly toolName: string;
	readonly exitCode?: number;
}

export interface ArtifactTranscriptItem extends TranscriptItemBase {
	readonly kind: "artifact";
	readonly artifactId: string;
}

export interface RuntimeStatusTranscriptItem extends TranscriptItemBase {
	readonly kind: "runtime-status";
	readonly status: "idle" | "running" | "busy" | "done" | "failed";
}

export interface SubagentEventTranscriptItem extends TranscriptItemBase {
	readonly kind: "subagent-event";
	readonly subagentId: string;
}

export interface CheckpointTranscriptItem extends TranscriptItemBase {
	readonly kind: "checkpoint";
	readonly checkpointId: string;
}

export interface ErrorTranscriptItem extends TranscriptItemBase {
	readonly kind: "error";
	readonly code?: string;
}

export type TranscriptItem =
	| UserTranscriptItem
	| AssistantTextTranscriptItem
	| AssistantThinkingTranscriptItem
	| ToolCallTranscriptItem
	| ToolResultTranscriptItem
	| ArtifactTranscriptItem
	| RuntimeStatusTranscriptItem
	| SubagentEventTranscriptItem
	| CheckpointTranscriptItem
	| ErrorTranscriptItem;

export interface ShellSurfaceDescriptor {
	readonly id: string;
	readonly title: string;
	readonly kind: "overlay" | "panel" | "workspace";
	readonly runtimeId?: string;
	readonly sessionId?: string;
	readonly open: () => void;
}

export interface RichDocumentSource {
	readonly id: string;
	readonly uri: string;
	readonly mediaType: string;
	readonly title?: string;
	readonly trust: "trusted" | "untrusted";
	readonly metadata?: Readonly<Record<string, string>>;
}

export interface RichDocumentSection {
	readonly id: string;
	readonly title?: string;
	readonly content: string;
	readonly collapsed?: boolean;
	readonly actions?: readonly TranscriptAction[];
}

export interface RichDocumentRenderModel {
	readonly id: string;
	readonly source: RichDocumentSource;
	readonly title: string;
	readonly subtitle?: string;
	readonly sections: readonly RichDocumentSection[];
	readonly surfaces?: readonly ShellSurfaceDescriptor[];
}
