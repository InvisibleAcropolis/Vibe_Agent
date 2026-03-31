import type { HostCommand } from "../agent-host.js";

export type BuiltInCommandMeta = { category: string; order: number; description: string };

export const BUILTIN_COMMAND_META: Record<string, BuiltInCommandMeta> = {
	setup: { category: "Setup", order: 0, description: "Open the full provider and model setup hub." },
	provider: { category: "Setup", order: 1, description: "Choose or reconnect an OAuth provider." },
	login: { category: "Setup", order: 2, description: "Connect an OAuth provider and continue into model setup." },
	logout: { category: "Setup", order: 3, description: "Disconnect a provider and clear invalid defaults." },
	model: { category: "Setup", order: 4, description: "Choose the default model for this app and session." },
	theme: { category: "Setup", order: 5, description: "Switch the visual theme (default/cyberpunk/matrix/synthwave/amber)." },
	settings: { category: "Session", order: 10, description: "Open app settings and session controls." },
	resume: { category: "Session", order: 11, description: "Resume or switch sessions." },
	sessions: { category: "Session", order: 11, description: "Open the grouped sessions browser surface." },
	fork: { category: "Session", order: 12, description: "Fork from a previous user message." },
	tree: { category: "Session", order: 13, description: "Navigate another branch point in this session." },
	stats: { category: "Session", order: 14, description: "Show session statistics and token usage." },
	artifacts: { category: "Session", order: 15, description: "Browse artifacts from the current session." },
	thinking: { category: "Session", order: 16, description: "Pick the reasoning budget for the active model." },
	compact: { category: "Session", order: 17, description: "Compact the current context window." },
	clear: { category: "Session", order: 18, description: "Clear the chat display." },
	"summon-orc": { category: "Session", order: 19, description: "Switch into the dedicated Orc orchestration chat." },
	"orc-resume": { category: "Session", order: 20, description: "Placeholder action for resuming an Orc orchestration thread." },
	"orc-checkpoints": { category: "Session", order: 21, description: "Placeholder action for inspecting Orc checkpoints." },
	"orc-rewind": { category: "Session", order: 22, description: "Placeholder action for rewinding Orc state to a checkpoint." },
	help: { category: "Help", order: 30, description: "Show keybindings and setup guidance." },
	"debug-dump": { category: "Help", order: 31, description: "Write a debug snapshot bundle at the app root." },
};

export function getBuiltInCommands(commands: HostCommand[]): HostCommand[] {
	const commandMap = new Map<string, HostCommand>();
	for (const command of commands) {
		commandMap.set(command.name, command);
	}
	for (const [name, meta] of Object.entries(BUILTIN_COMMAND_META)) {
		commandMap.set(name, {
			name,
			description: meta.description,
			source: "builtin",
		});
	}
	commandMap.set("debug-dump", {
		name: "debug-dump",
		description: "Write a debug snapshot bundle at the app root.",
		source: "builtin",
	});
	return [...commandMap.values()].sort((a, b) => {
		const aMeta = BUILTIN_COMMAND_META[a.name];
		const bMeta = BUILTIN_COMMAND_META[b.name];
		const aOrder = aMeta?.order ?? 10_000;
		const bOrder = bMeta?.order ?? 10_000;
		if (aOrder !== bOrder) {
			return aOrder - bOrder;
		}
		return a.name.localeCompare(b.name);
	});
}
