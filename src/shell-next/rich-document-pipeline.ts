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

const SAFE_LINK_PROTOCOL = /^(https?:\/\/|mailto:|\/|#)/i;

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
	if (policy.pipeline === "safe-markdown") {
		return {
			...section,
			components: parseSafeMarkdownComponents(section.content, section.id),
		};
	}

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

function sanitizeInlineMarkdown(line: string): string {
	return line
		.replace(/<[^>]+>/g, "")
		.replace(/\{[^}]*\}/g, "")
		.trim();
}

function sanitizeLinkHref(href: string): string | undefined {
	const trimmed = href.trim();
	if (!trimmed) return undefined;
	if (!SAFE_LINK_PROTOCOL.test(trimmed)) return undefined;
	return trimmed;
}

function collectSafeLinkComponents(line: string, sectionId: string, components: RichDocumentComponent[]): void {
	const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
	let match = linkRegex.exec(line);
	while (match) {
		const href = sanitizeLinkHref(match[2] ?? "");
		const text = sanitizeInlineMarkdown(match[1] ?? "");
		if (href && text) {
			components.push({
				id: createComponentId(sectionId, components.length),
				kind: "link",
				text,
				href,
			});
		}
		match = linkRegex.exec(line);
	}
}

export function parseSafeMarkdownComponents(content: string, sectionId: string): RichDocumentComponent[] {
	const components: RichDocumentComponent[] = [];
	const lines = content.split(/\r?\n/);
	const paragraphBuffer: string[] = [];
	let idx = 0;

	const flushParagraph = (): void => {
		if (paragraphBuffer.length === 0) return;
		const text = paragraphBuffer.join(" ").replace(/\s+/g, " ").trim();
		if (text) {
			components.push({
				id: createComponentId(sectionId, components.length),
				kind: "markdown-text",
				text,
			});
		}
		paragraphBuffer.length = 0;
	};

	while (idx < lines.length) {
		const rawLine = lines[idx] ?? "";
		const trimmed = rawLine.trim();

		const codeFence = /^```([a-zA-Z0-9_-]+)?\s*$/.exec(trimmed);
		if (codeFence) {
			flushParagraph();
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

		const blockedMdxSyntax =
			/^import\s+/i.test(trimmed) ||
			/^export\s+/i.test(trimmed) ||
			/^<[A-Z][^>]*\/?>$/.test(trimmed) ||
			/^<\/[A-Z][^>]*>$/.test(trimmed);
		if (blockedMdxSyntax) {
			flushParagraph();
			idx += 1;
			continue;
		}

		if (!trimmed) {
			flushParagraph();
			idx += 1;
			continue;
		}

		const heading = parseHeading(sanitizeInlineMarkdown(rawLine));
		if (heading) {
			flushParagraph();
			components.push({
				id: createComponentId(sectionId, components.length),
				...heading,
			});
			idx += 1;
			continue;
		}

		collectSafeLinkComponents(rawLine, sectionId, components);
		const safeLine = sanitizeInlineMarkdown(rawLine);
		if (safeLine) paragraphBuffer.push(safeLine);
		idx += 1;
	}

	flushParagraph();
	return components;
}
