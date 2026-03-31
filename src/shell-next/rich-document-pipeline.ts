import type { RichDocumentComponent, RichDocumentSection, RichDocumentSourcePolicy } from "./shared-models.js";

export const TRUSTED_COMPONENT_ALLOWLIST = new Set<RichDocumentComponent["kind"]>([
	"heading",
	"callout",
	"code",
	"metadata",
	"link",
	"timeline-card",
	"collapsible",
]);

function createComponentId(sectionId: string, index: number): string {
	return `${sectionId}:component:${index + 1}`;
}

function parseHeading(line: string): Omit<RichDocumentComponent, "id"> | undefined {
	const match = /^(#{1,6})\s+(.+)$/.exec(line.trim());
	if (!match) return undefined;
	return {
		kind: "heading",
		level: match[1].length,
		text: match[2].trim(),
	};
}

function parseMetadata(line: string): Omit<RichDocumentComponent, "id"> | undefined {
	const match = /^@([a-zA-Z0-9_.-]+):\s*(.+)$/.exec(line.trim());
	if (!match) return undefined;
	return {
		kind: "metadata",
		key: match[1],
		value: match[2].trim(),
	};
}

function parseLink(line: string): Omit<RichDocumentComponent, "id"> | undefined {
	const match = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(line.trim());
	if (!match) return undefined;
	return {
		kind: "link",
		text: match[1].trim(),
		href: match[2].trim(),
	};
}

function parseCallout(line: string): Omit<RichDocumentComponent, "id"> | undefined {
	const match = /^!\[(note|tip|warn|danger|info)\]\s*(.+)$/.exec(line.trim());
	if (!match) return undefined;
	return {
		kind: "callout",
		variant: match[1],
		text: match[2].trim(),
	};
}

function parseTimelineCard(line: string): Omit<RichDocumentComponent, "id"> | undefined {
	const match = /^\[timeline-card\]\s*([^|]+)\|\s*([^|]+)\|\s*(.+)$/.exec(line.trim());
	if (!match) return undefined;
	return {
		kind: "timeline-card",
		title: match[1].trim(),
		date: match[2].trim(),
		body: match[3].trim(),
	};
}

function parseCollapsible(line: string): Omit<RichDocumentComponent, "id"> | undefined {
	const match = /^\[collapsible\]\s*([^|]+)\|\s*(.+)$/.exec(line.trim());
	if (!match) return undefined;
	return {
		kind: "collapsible",
		title: match[1].trim(),
		content: match[2].trim(),
	};
}

/**
 * Parses supported rich-document primitives from trusted inputs.
 *
 * The parser intentionally ignores unsupported tags/components so the downstream
 * render model only contains allowlisted primitives.
 */
export function parseTrustedRichDocumentComponents(content: string, sectionId: string): RichDocumentComponent[] {
	const components: RichDocumentComponent[] = [];
	const lines = content.split(/\r?\n/);
	let idx = 0;
	while (idx < lines.length) {
		const line = lines[idx] ?? "";
		const codeFence = /^```([a-zA-Z0-9_-]+)?\s*$/.exec(line.trim());
		if (codeFence) {
			const language = codeFence[1]?.trim();
			const bodyLines: string[] = [];
			idx += 1;
			while (idx < lines.length && lines[idx]?.trim() !== "```") {
				bodyLines.push(lines[idx] ?? "");
				idx += 1;
			}
			components.push({
				id: createComponentId(sectionId, components.length),
				kind: "code",
				language,
				code: bodyLines.join("\n").trimEnd(),
			});
			idx += 1;
			continue;
		}

		const parsed =
			parseHeading(line) ??
			parseCallout(line) ??
			parseMetadata(line) ??
			parseLink(line) ??
			parseTimelineCard(line) ??
			parseCollapsible(line);

		if (parsed && TRUSTED_COMPONENT_ALLOWLIST.has(parsed.kind)) {
			components.push({ id: createComponentId(sectionId, components.length), ...parsed });
		}
		idx += 1;
	}

	return components;
}

export function applyRichDocumentPipeline(
	section: RichDocumentSection,
	policy: RichDocumentSourcePolicy,
): RichDocumentSection {
	if (policy.pipeline !== "mdx-capable") {
		return {
			...section,
			components: [],
		};
	}

	return {
		...section,
		components: parseTrustedRichDocumentComponents(section.content, section.id),
	};
}
