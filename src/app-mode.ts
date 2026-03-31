export type VibeAppMode = "standard" | "orc";

export const VIBE_APP_MODE_ENV = "VIBE_APP_MODE";
export const VIBE_APP_MODE_ARG_PREFIX = "--app-mode=";

export function normalizeVibeAppMode(value: string | undefined): VibeAppMode {
	return value === "orc" ? "orc" : "standard";
}

export function readVibeAppMode(
	env: NodeJS.ProcessEnv = process.env,
	argv: readonly string[] = process.argv.slice(2),
): VibeAppMode {
	const argValue = argv.find((arg) => arg.startsWith(VIBE_APP_MODE_ARG_PREFIX))?.slice(VIBE_APP_MODE_ARG_PREFIX.length);
	return normalizeVibeAppMode(argValue ?? env[VIBE_APP_MODE_ENV]);
}

