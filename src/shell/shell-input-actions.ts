/**
 * Canonical shell action contract used by global input handling.
 *
 * Input sources (keyboard, mouse, future command surfaces) should emit one of
 * these actions instead of reaching directly into transcript row geometry or
 * shell implementation details.
 */
export type ShellInputAction =
	| ScrollShellAction
	| FollowToggleShellAction
	| PromptFocusShellAction
	| OpenOverlayShellAction
	| LaunchSurfaceShellAction;

export type ScrollTarget = "page-up" | "page-down" | "top" | "bottom";

export interface ScrollShellAction {
	readonly type: "scroll";
	readonly target: ScrollTarget;
}

export interface FollowToggleShellAction {
	readonly type: "follow-toggle";
}

export interface PromptFocusShellAction {
	readonly type: "prompt-focus";
}

export type OverlayTarget = "command-palette" | "settings" | "sessions" | "orchestration";

export interface OpenOverlayShellAction {
	readonly type: "overlay-open";
	readonly target: OverlayTarget;
}

export type LaunchSurfaceTarget = "sessions-browser";

export interface LaunchSurfaceShellAction {
	readonly type: "surface-launch";
	readonly target: LaunchSurfaceTarget;
}
