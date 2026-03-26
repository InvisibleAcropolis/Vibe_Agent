export type OrcContractModelName = "StructuralBlueprint" | "ReconReport" | "FailureDossier";

export interface OrcContractProvenance {
	agentName?: string;
	timestamp?: string;
	correlationId?: string;
}

export interface OrcContractEnvelope {
	status?: "pass" | "fail" | "pending";
	passed?: boolean;
	metadata?: Record<string, unknown>;
	provenance?: OrcContractProvenance;
}

export interface StructuralBlueprint {
	objective: string;
	scope: string[];
	constraints: string[];
	deliverables: string[];
	riskRegister?: string[];
	envelope?: OrcContractEnvelope;
}

export interface ReconCoordinate {
	absoluteFilePath: string;
	lineStart: number;
	lineEnd: number;
	semanticChangeTarget: string;
}

export interface ReconReport {
	summary: string;
	findings: string[];
	recommendations: string[];
	coordinates: ReconCoordinate[];
	evidenceLinks?: string[];
	envelope?: OrcContractEnvelope;
}

export interface FailureDossier {
	failureCode: string;
	failureSummary: string;
	actionsTaken: string[];
	nextActions?: string[];
	envelope?: OrcContractEnvelope;
}

export interface OrcContractValidationIssue {
	path: string;
	expected: string;
	received: string;
	message: string;
}

export interface OrcContractValidationResult {
	ok: boolean;
	model: OrcContractModelName;
	issues: OrcContractValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asType(value: unknown): string {
	if (Array.isArray(value)) {
		return "array";
	}
	if (value === null) {
		return "null";
	}
	return typeof value;
}

function pushIssue(issues: OrcContractValidationIssue[], path: string, expected: string, received: unknown, message: string): void {
	issues.push({
		path,
		expected,
		received: asType(received),
		message,
	});
}

function validateString(value: unknown, path: string, issues: OrcContractValidationIssue[]): value is string {
	if (typeof value !== "string" || value.trim().length === 0) {
		pushIssue(issues, path, "non-empty string", value, `${path} must be a non-empty string.`);
		return false;
	}
	return true;
}

function validateStringArray(value: unknown, path: string, issues: OrcContractValidationIssue[], allowEmpty = false): value is string[] {
	if (!Array.isArray(value)) {
		pushIssue(issues, path, "string[]", value, `${path} must be an array of strings.`);
		return false;
	}
	if (!allowEmpty && value.length === 0) {
		pushIssue(issues, path, "non-empty string[]", value, `${path} must include at least one entry.`);
		return false;
	}
	for (let index = 0; index < value.length; index += 1) {
		if (typeof value[index] !== "string" || value[index].trim().length === 0) {
			pushIssue(issues, `${path}[${index}]`, "non-empty string", value[index], `${path}[${index}] must be a non-empty string.`);
		}
	}
	return true;
}

function validatePositiveInteger(value: unknown, path: string, issues: OrcContractValidationIssue[]): value is number {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		pushIssue(issues, path, "positive integer", value, `${path} must be a positive integer.`);
		return false;
	}
	return true;
}

function isAbsolutePath(value: string): boolean {
	return value.startsWith("/");
}

function compareReconCoordinate(a: ReconCoordinate, b: ReconCoordinate): number {
	if (a.absoluteFilePath !== b.absoluteFilePath) {
		return a.absoluteFilePath.localeCompare(b.absoluteFilePath);
	}
	if (a.lineStart !== b.lineStart) {
		return a.lineStart - b.lineStart;
	}
	if (a.lineEnd !== b.lineEnd) {
		return a.lineEnd - b.lineEnd;
	}
	return a.semanticChangeTarget.localeCompare(b.semanticChangeTarget);
}

function validateReconCoordinates(value: unknown, path: string, issues: OrcContractValidationIssue[]): value is ReconCoordinate[] {
	if (!Array.isArray(value) || value.length === 0) {
		pushIssue(issues, path, "non-empty ReconCoordinate[]", value, `${path} must include at least one coordinate.`);
		return false;
	}
	let previous: ReconCoordinate | undefined;
	for (let index = 0; index < value.length; index += 1) {
		const entry = value[index];
		const entryPath = `${path}[${index}]`;
		if (!isRecord(entry)) {
			pushIssue(issues, entryPath, "ReconCoordinate", entry, `${entryPath} must be an object.`);
			continue;
		}
		if (!validateString(entry.absoluteFilePath, `${entryPath}.absoluteFilePath`, issues)) {
			continue;
		}
		if (!isAbsolutePath(entry.absoluteFilePath)) {
			pushIssue(
				issues,
				`${entryPath}.absoluteFilePath`,
				"absolute file path",
				entry.absoluteFilePath,
				`${entryPath}.absoluteFilePath must be an absolute path.`,
			);
		}
		const hasStart = validatePositiveInteger(entry.lineStart, `${entryPath}.lineStart`, issues);
		const hasEnd = validatePositiveInteger(entry.lineEnd, `${entryPath}.lineEnd`, issues);
		validateString(entry.semanticChangeTarget, `${entryPath}.semanticChangeTarget`, issues);
		const lineStart = entry.lineStart;
		const lineEnd = entry.lineEnd;
		if (hasStart && hasEnd && typeof lineStart === "number" && typeof lineEnd === "number" && lineEnd < lineStart) {
			pushIssue(
				issues,
				`${entryPath}.lineEnd`,
				">= lineStart",
				lineEnd,
				`${entryPath}.lineEnd must be greater than or equal to lineStart.`,
			);
		}
		if (
			typeof entry.absoluteFilePath === "string"
			&& typeof entry.lineStart === "number"
			&& typeof entry.lineEnd === "number"
			&& typeof entry.semanticChangeTarget === "string"
		) {
			const normalized: ReconCoordinate = {
				absoluteFilePath: entry.absoluteFilePath,
				lineStart: entry.lineStart,
				lineEnd: entry.lineEnd,
				semanticChangeTarget: entry.semanticChangeTarget,
			};
			if (previous && compareReconCoordinate(previous, normalized) >= 0) {
				pushIssue(
					issues,
					entryPath,
					"strictly ascending deterministic coordinate order",
					entry,
					`${path} must be strictly ordered by absoluteFilePath, lineStart, lineEnd, semanticChangeTarget.`,
				);
			}
			previous = normalized;
		}
	}
	return true;
}

function validateEnvelope(value: unknown, path: string, issues: OrcContractValidationIssue[]): void {
	if (value === undefined) {
		return;
	}
	if (!isRecord(value)) {
		pushIssue(issues, path, "object", value, `${path} must be an object when provided.`);
		return;
	}
	if (value.status !== undefined && !["pass", "fail", "pending"].includes(String(value.status))) {
		pushIssue(issues, `${path}.status`, '"pass" | "fail" | "pending"', value.status, `${path}.status is invalid.`);
	}
	if (value.passed !== undefined && typeof value.passed !== "boolean") {
		pushIssue(issues, `${path}.passed`, "boolean", value.passed, `${path}.passed must be a boolean.`);
	}
	if (value.metadata !== undefined && !isRecord(value.metadata)) {
		pushIssue(issues, `${path}.metadata`, "object", value.metadata, `${path}.metadata must be an object.`);
	}
	if (value.provenance !== undefined) {
		if (!isRecord(value.provenance)) {
			pushIssue(issues, `${path}.provenance`, "object", value.provenance, `${path}.provenance must be an object.`);
		} else {
			if (value.provenance.agentName !== undefined) {
				validateString(value.provenance.agentName, `${path}.provenance.agentName`, issues);
			}
			if (value.provenance.timestamp !== undefined) {
				validateString(value.provenance.timestamp, `${path}.provenance.timestamp`, issues);
			}
			if (value.provenance.correlationId !== undefined) {
				validateString(value.provenance.correlationId, `${path}.provenance.correlationId`, issues);
			}
		}
	}
}

function validateStructuralBlueprint(payload: unknown): OrcContractValidationResult {
	const issues: OrcContractValidationIssue[] = [];
	if (!isRecord(payload)) {
		pushIssue(issues, "payload", "object", payload, "payload must be an object.");
		return { ok: false, model: "StructuralBlueprint", issues };
	}
	validateString(payload.objective, "payload.objective", issues);
	validateStringArray(payload.scope, "payload.scope", issues);
	validateStringArray(payload.constraints, "payload.constraints", issues);
	validateStringArray(payload.deliverables, "payload.deliverables", issues);
	if (payload.riskRegister !== undefined) {
		validateStringArray(payload.riskRegister, "payload.riskRegister", issues, true);
	}
	validateEnvelope(payload.envelope, "payload.envelope", issues);
	return { ok: issues.length === 0, model: "StructuralBlueprint", issues };
}

function validateReconReport(payload: unknown): OrcContractValidationResult {
	const issues: OrcContractValidationIssue[] = [];
	if (!isRecord(payload)) {
		pushIssue(issues, "payload", "object", payload, "payload must be an object.");
		return { ok: false, model: "ReconReport", issues };
	}
	validateString(payload.summary, "payload.summary", issues);
	validateStringArray(payload.findings, "payload.findings", issues);
	validateStringArray(payload.recommendations, "payload.recommendations", issues);
	validateReconCoordinates(payload.coordinates, "payload.coordinates", issues);
	if (payload.evidenceLinks !== undefined) {
		validateStringArray(payload.evidenceLinks, "payload.evidenceLinks", issues, true);
	}
	validateEnvelope(payload.envelope, "payload.envelope", issues);
	return { ok: issues.length === 0, model: "ReconReport", issues };
}

function validateFailureDossier(payload: unknown): OrcContractValidationResult {
	const issues: OrcContractValidationIssue[] = [];
	if (!isRecord(payload)) {
		pushIssue(issues, "payload", "object", payload, "payload must be an object.");
		return { ok: false, model: "FailureDossier", issues };
	}
	validateString(payload.failureCode, "payload.failureCode", issues);
	validateString(payload.failureSummary, "payload.failureSummary", issues);
	validateStringArray(payload.actionsTaken, "payload.actionsTaken", issues);
	if (payload.nextActions !== undefined) {
		validateStringArray(payload.nextActions, "payload.nextActions", issues, true);
	}
	validateEnvelope(payload.envelope, "payload.envelope", issues);
	return { ok: issues.length === 0, model: "FailureDossier", issues };
}

export function validateOrcContractPayload(model: OrcContractModelName, payload: unknown): OrcContractValidationResult {
	switch (model) {
		case "StructuralBlueprint":
			return validateStructuralBlueprint(payload);
		case "ReconReport":
			return validateReconReport(payload);
		case "FailureDossier":
			return validateFailureDossier(payload);
		default: {
			const exhaustiveGuard: never = model;
			return {
				ok: false,
				model,
				issues: [
					{
						path: "model",
						expected: "known contract model",
						received: String(exhaustiveGuard),
						message: `Unknown contract model: ${String(exhaustiveGuard)}`,
					},
				],
			};
		}
	}
}
