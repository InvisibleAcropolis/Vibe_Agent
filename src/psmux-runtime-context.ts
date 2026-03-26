export const PSMUX_CHILD_FLAG = "--psmux-child";
export const PSMUX_CHILD_ENV = "VIBE_PSMUX_CHILD";
export const PSMUX_ROLE_ENV = "VIBE_PSMUX_ROLE";
export const PSMUX_SESSION_ENV = "VIBE_PSMUX_SESSION";

export type PsmuxRuntimeRole = "primary" | "secondary";

export interface PsmuxRuntimeContext {
	isChild: boolean;
	role?: PsmuxRuntimeRole;
	sessionName?: string;
}

export function readPsmuxRuntimeContext(
	env: NodeJS.ProcessEnv = process.env,
	argv: readonly string[] = process.argv.slice(2),
): PsmuxRuntimeContext {
	const isChild = argv.includes(PSMUX_CHILD_FLAG) || env[PSMUX_CHILD_ENV] === "1";
	const rawRole = env[PSMUX_ROLE_ENV];
	const role = rawRole === "primary" || rawRole === "secondary" ? rawRole : undefined;
	const sessionName = normalizeValue(env[PSMUX_SESSION_ENV]);
	return {
		isChild,
		role,
		sessionName,
	};
}

export function stripPsmuxChildFlag(argv: readonly string[]): string[] {
	return argv.filter((arg) => arg !== PSMUX_CHILD_FLAG);
}

export function formatPsmuxRuntimeLabel(context: PsmuxRuntimeContext): string | undefined {
	if (!context.isChild || !context.sessionName) {
		return undefined;
	}
	return context.role ? `${context.sessionName}/${context.role}` : context.sessionName;
}

function normalizeValue(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}
