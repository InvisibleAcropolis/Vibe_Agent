import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const VIBE_DURABLE_ROOT = join(homedir(), "Vibe_Agent");

export type VibeDurablePathOptions = {
	durableRoot?: string;
};

export type VibeDurableTree = {
	root: string;
	artifacts: string;
	logs: string;
	memory: string;
	auth: string;
	config: string;
	checkpoints: string;
	tracker: string;
	plans: string;
	sessions: string;
};

function resolveRoot(options?: VibeDurablePathOptions): string {
	return options?.durableRoot ?? VIBE_DURABLE_ROOT;
}

export function getVibeDurableRoot(options?: VibeDurablePathOptions): string {
	return resolveRoot(options);
}

export function getVibeArtifactsDir(options?: VibeDurablePathOptions): string {
	return join(resolveRoot(options), "artifacts");
}

export function getVibeLogsDir(options?: VibeDurablePathOptions): string {
	return join(resolveRoot(options), "logs");
}

export function getVibeMemoryDir(options?: VibeDurablePathOptions): string {
	return join(resolveRoot(options), "memory");
}

/**
 * Reserved for Vibe-owned auth material. pi-mono's legacy auth.json remains under getAgentDir()
 * until we ship an explicit migration, so startup can distinguish inherited state from new storage.
 */
export function getVibeAuthDir(options?: VibeDurablePathOptions): string {
	return join(resolveRoot(options), "auth");
}

export function getVibeConfigDir(options?: VibeDurablePathOptions): string {
	return join(resolveRoot(options), "config");
}

export function getVibeCheckpointsDir(options?: VibeDurablePathOptions): string {
	return join(resolveRoot(options), "checkpoints");
}

export function getVibeTrackerDir(options?: VibeDurablePathOptions): string {
	return join(resolveRoot(options), "tracker");
}

export function getVibePlansDir(options?: VibeDurablePathOptions): string {
	return join(resolveRoot(options), "plans");
}

/**
 * Orc-owned session namespaces now live under ~/Vibe_Agent/sessions. Coding-runtime sessions still
 * remain in pi-mono storage via getAgentDir() until their migration is designed and documented.
 */
export function getVibeSessionsDir(options?: VibeDurablePathOptions): string {
	return join(resolveRoot(options), "sessions");
}

export function getVibeDurableTree(options?: VibeDurablePathOptions): VibeDurableTree {
	return {
		root: getVibeDurableRoot(options),
		artifacts: getVibeArtifactsDir(options),
		logs: getVibeLogsDir(options),
		memory: getVibeMemoryDir(options),
		auth: getVibeAuthDir(options),
		config: getVibeConfigDir(options),
		checkpoints: getVibeCheckpointsDir(options),
		tracker: getVibeTrackerDir(options),
		plans: getVibePlansDir(options),
		sessions: getVibeSessionsDir(options),
	};
}

function mkdirPrivate(dirPath: string): void {
	if (!existsSync(dirPath)) {
		mkdirSync(dirPath, { recursive: true, mode: 0o700 });
	}
	try {
		chmodSync(dirPath, 0o700);
	} catch {
		// Some platforms/filesystems ignore POSIX permissions; best effort only.
	}
}

/**
 * Bootstraps the full Vibe-owned durable tree under ~/Vibe_Agent.
 *
 * Migration note:
 * - Vibe-owned durable catalogs, plans, trackers, checkpoints, and Orc session namespaces belong here.
 * - Inherited pi-mono auth/session state (for example auth.json and coding sessions) intentionally remains
 *   under getAgentDir() so migration stays explicit and reversible.
 */
export function ensureVibeDurableStorage(options?: VibeDurablePathOptions): VibeDurableTree {
	const tree = getVibeDurableTree(options);
	mkdirPrivate(tree.root);
	for (const dirPath of Object.values(tree)) {
		mkdirPrivate(dirPath);
	}
	return tree;
}

export function getVibeConfigPath(filename = "vibe-agent-config.json", options?: VibeDurablePathOptions): string {
	return join(getVibeConfigDir(options), filename);
}

export function getVibeTrackerPath(filename: string, options?: VibeDurablePathOptions): string {
	return join(getVibeTrackerDir(options), filename);
}

export function getVibePlanPath(filename: string, options?: VibeDurablePathOptions): string {
	return join(getVibePlansDir(options), filename);
}

export function getVibeCheckpointPath(filename: string, options?: VibeDurablePathOptions): string {
	return join(getVibeCheckpointsDir(options), filename);
}

export function getVibeArtifactPath(filename: string, options?: VibeDurablePathOptions): string {
	return join(getVibeArtifactsDir(options), filename);
}

export function getVibeLogPath(filename: string, options?: VibeDurablePathOptions): string {
	return join(getVibeLogsDir(options), filename);
}

export function getVibeMemoryPath(filename: string, options?: VibeDurablePathOptions): string {
	return join(getVibeMemoryDir(options), filename);
}

export function ensureParentDir(filePath: string): void {
	mkdirPrivate(dirname(filePath));
}
