import type { Artifact } from "../types.js";

export interface OpenTuiTextOverlayModel {
	readonly kind: "text";
	readonly title: string;
	readonly description?: string;
	readonly lines: readonly string[];
}

export interface OpenTuiDocumentOverlayItem {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly content: string;
	readonly footer?: readonly string[];
}

export interface OpenTuiDocumentOverlayModel {
	readonly kind: "document";
	readonly title: string;
	readonly description?: string;
	readonly items: readonly OpenTuiDocumentOverlayItem[];
	readonly emptyMessage?: string;
}

export interface OpenTuiFloatingAnimboxOverlayModel {
	readonly kind: "floating-animbox";
	readonly title: string;
	readonly description?: string;
	readonly sourceFile?: string;
	readonly exportName?: string;
	readonly presetId?: string;
	readonly cols?: number;
	readonly rows?: number;
	readonly x?: number;
	readonly y?: number;
}

export type OpenTuiOverlayModel = OpenTuiTextOverlayModel | OpenTuiDocumentOverlayModel | OpenTuiFloatingAnimboxOverlayModel;

export function isOpenTuiOverlayModel(value: unknown): value is OpenTuiOverlayModel {
	if (!value || typeof value !== "object") {
		return false;
	}
	const kind = (value as { kind?: unknown }).kind;
	return kind === "text" || kind === "document" || kind === "floating-animbox";
}

export function toOpenTuiDocumentItems(
	artifacts: readonly Artifact[],
	fallbackDescription: string,
): OpenTuiDocumentOverlayItem[] {
	return artifacts.map((artifact, index) => ({
		id: artifact.id || `artifact-${index + 1}`,
		label: artifact.title || artifact.filePath || `Artifact ${index + 1}`,
		description: artifact.filePath ?? artifact.language ?? fallbackDescription,
		content: artifact.content,
		footer: [
			`Type: ${artifact.type}`,
			artifact.language ? `Language: ${artifact.language}` : undefined,
			artifact.filePath ? `Path: ${artifact.filePath}` : undefined,
		].filter((value): value is string => Boolean(value)),
	}));
}
