import type { RpcTelemetryEnvelope } from "../../bridge/rpc_launcher.js";
import { createCorrelationContext } from "../../errors/unified-error.js";
import type { GuildSubagentRole, SubagentConfig, SubagentToolsetCapabilities } from "./types.js";

export type SubagentToolDomain =
	| "read"
	| "recon"
	| "lsp"
	| "edit"
	| "lint"
	| "test"
	| "mock"
	| "dependency"
	| "environment"
	| "refactor"
	| "document";

export interface SubagentToolPolicy {
	allowedCapabilities: ReadonlyArray<SubagentToolsetCapabilities>;
	allowedDomains: ReadonlyArray<SubagentToolDomain>;
}

export interface SubagentToolPolicyViolation {
	role: GuildSubagentRole;
	toolName: string;
	detectedDomain?: SubagentToolDomain;
	allowedDomains: ReadonlyArray<SubagentToolDomain>;
	reason: string;
}

export const ORC_SUBAGENT_TOOL_POLICY_MAP: Readonly<Record<GuildSubagentRole, SubagentToolPolicy>> = {
	architect: {
		allowedCapabilities: ["read", "search"],
		allowedDomains: ["read", "recon", "lsp"],
	},
	scout: {
		allowedCapabilities: ["index", "search", "read"],
		allowedDomains: ["read", "recon", "lsp"],
	},
	mechanic: {
		allowedCapabilities: ["write", "execute"],
		allowedDomains: ["edit", "lint"],
	},
	inquisitor: {
		allowedCapabilities: ["write", "execute"],
		allowedDomains: ["test", "mock"],
	},
	warden: {
		allowedCapabilities: ["read", "search", "execute"],
		allowedDomains: ["dependency", "environment"],
	},
	alchemist: {
		allowedCapabilities: ["write", "refactor", "execute"],
		allowedDomains: ["edit", "refactor", "test"],
	},
	scribe: {
		allowedCapabilities: ["read", "write"],
		allowedDomains: ["document", "read"],
	},
	archivist: {
		allowedCapabilities: ["index", "search", "read", "write"],
		allowedDomains: ["document", "read", "recon"],
	},
	vibe_curator: {
		allowedCapabilities: ["read", "write", "refactor"],
		allowedDomains: ["document", "read", "refactor"],
	},
};

const TOOL_DOMAIN_MATCHERS: ReadonlyArray<{ domain: SubagentToolDomain; matches: (toolName: string) => boolean }> = [
	{ domain: "lsp", matches: (tool) => /lsp|symbol|definition|references?/.test(tool) },
	{ domain: "recon", matches: (tool) => /scan|index|search|grep|find|list|glob|recon/.test(tool) },
	{ domain: "read", matches: (tool) => /read|cat|view|open|peek/.test(tool) },
	{ domain: "edit", matches: (tool) => /edit|write|patch|rewrite|replace/.test(tool) },
	{ domain: "lint", matches: (tool) => /lint|format|prettier|eslint|biome/.test(tool) },
	{ domain: "test", matches: (tool) => /test|pytest|jest|vitest|unittest|integration/.test(tool) },
	{ domain: "mock", matches: (tool) => /mock|fixture|stub|fake/.test(tool) },
	{ domain: "dependency", matches: (tool) => /npm|pnpm|yarn|pip|poetry|bundle|cargo|dependency|lockfile/.test(tool) },
	{ domain: "environment", matches: (tool) => /env|dotenv|export|shell|runtime|container|docker/.test(tool) },
	{ domain: "refactor", matches: (tool) => /refactor|rename|extract/.test(tool) },
	{ domain: "document", matches: (tool) => /doc|markdown|changelog|readme/.test(tool) },
];

export function classifyToolDomain(toolName: string): SubagentToolDomain | undefined {
	const normalized = toolName.trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}
	return TOOL_DOMAIN_MATCHERS.find((matcher) => matcher.matches(normalized))?.domain;
}

export function validateSubagentToolPolicyRegistry(
	registry: Readonly<Record<GuildSubagentRole, SubagentConfig>>,
	policyMap: Readonly<Record<GuildSubagentRole, SubagentToolPolicy>> = ORC_SUBAGENT_TOOL_POLICY_MAP,
): void {
	for (const [role, config] of Object.entries(registry) as Array<[GuildSubagentRole, SubagentConfig]>) {
		const policy = policyMap[role];
		if (!policy) {
			throw new Error(`Subagent policy map is missing role '${role}'.`);
		}
		const expected = [...policy.allowedCapabilities].sort();
		const actual = [...config.toolset].sort();
		if (JSON.stringify(expected) !== JSON.stringify(actual)) {
			throw new Error(
				`Subagent policy mismatch for '${role}'. Config toolset [${actual.join(", ")}] does not match policy [${expected.join(", ")}].`,
			);
		}
	}
}

function isToolCallTelemetry(envelope: RpcTelemetryEnvelope): boolean {
	if (envelope.telemetry.kind === "tool_call") {
		return true;
	}
	const payload = envelope.telemetry.payload;
	if (!payload || typeof payload !== "object") {
		return false;
	}
	const category = (payload as { category?: unknown }).category;
	return category === "tool_call";
}

export function extractTelemetryToolName(envelope: RpcTelemetryEnvelope): string | undefined {
	if (!isToolCallTelemetry(envelope)) {
		return undefined;
	}
	const payload = envelope.telemetry.payload;
	if (!payload || typeof payload !== "object") {
		return undefined;
	}
	const candidate = (payload as { toolName?: unknown; name?: unknown; tool?: unknown }).toolName
		?? (payload as { name?: unknown }).name
		?? (payload as { tool?: unknown }).tool;
	return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : undefined;
}

export function evaluateToolPolicyViolation(params: {
	role: GuildSubagentRole;
	toolName: string;
	policyMap?: Readonly<Record<GuildSubagentRole, SubagentToolPolicy>>;
}): SubagentToolPolicyViolation | undefined {
	const policyMap = params.policyMap ?? ORC_SUBAGENT_TOOL_POLICY_MAP;
	const policy = policyMap[params.role];
	if (!policy) {
		return {
			role: params.role,
			toolName: params.toolName,
			allowedDomains: [],
			reason: `No tool policy registered for role '${params.role}'.`,
		};
	}
	const domain = classifyToolDomain(params.toolName);
	if (!domain) {
		return {
			role: params.role,
			toolName: params.toolName,
			allowedDomains: policy.allowedDomains,
			reason: `Tool '${params.toolName}' could not be classified into a known tool domain.`,
		};
	}
	if (policy.allowedDomains.includes(domain)) {
		return undefined;
	}
	return {
		role: params.role,
		toolName: params.toolName,
		detectedDomain: domain,
		allowedDomains: policy.allowedDomains,
		reason: `Tool '${params.toolName}' is domain '${domain}', which is not allowed for ${params.role}.`,
	};
}

export function createPolicyViolationDetail(violation: SubagentToolPolicyViolation): Record<string, unknown> {
	return {
		role: violation.role,
		toolName: violation.toolName,
		detectedDomain: violation.detectedDomain,
		allowedDomains: [...violation.allowedDomains],
		reason: violation.reason,
		correlation: createCorrelationContext({}),
	};
}
