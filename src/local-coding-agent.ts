export { getAgentDir } from "../coding-agent/src/config.js";

export type {
	AgentSessionEvent,
	SessionStats,
} from "../coding-agent/src/core/agent-session.js";
export { type AgentSession } from "../coding-agent/src/core/agent-session.js";

export type {
	ExtensionError,
	ExtensionUIContext,
} from "../coding-agent/src/core/extensions/index.js";

export { KeybindingsManager } from "../coding-agent/src/core/keybindings.js";
export type { AppAction } from "../coding-agent/src/core/keybindings.js";

export {
	type CreateAgentSessionOptions,
	createAgentSession,
} from "../coding-agent/src/core/sdk.js";

export { SessionManager } from "../coding-agent/src/core/session-manager.js";
export type { SessionInfo } from "../coding-agent/src/core/session-manager.js";

export { AuthStorage } from "../coding-agent/src/core/auth-storage.js";
export type { AuthStorageBackend } from "../coding-agent/src/core/auth-storage.js";
export { ModelRegistry } from "../coding-agent/src/core/model-registry.js";

export {
	getAvailableThemesWithPaths,
	getEditorTheme,
	getMarkdownTheme,
	getThemeByName,
	initTheme,
	onThemeChange,
	setTheme,
	theme,
	type Theme,
} from "../coding-agent/src/modes/interactive/theme/theme.js";

export { AssistantMessageComponent } from "../coding-agent/src/modes/interactive/components/assistant-message.js";
export { CustomEditor } from "../coding-agent/src/modes/interactive/components/custom-editor.js";
export { LoginDialogComponent } from "../coding-agent/src/modes/interactive/components/login-dialog.js";
export { OAuthSelectorComponent } from "../coding-agent/src/modes/interactive/components/oauth-selector.js";
export { ToolExecutionComponent } from "../coding-agent/src/modes/interactive/components/tool-execution.js";
export { UserMessageComponent } from "../coding-agent/src/modes/interactive/components/user-message.js";
