import type { RichDocumentRenderModel, RichDocumentSection, RichDocumentSource, RichDocumentSourcePolicy, RichDocumentTrustMetadata } from "./shared-models.js";

export interface RichDocumentLoadInput {
	readonly id: string;
	readonly uri: string;
	readonly mediaType: string;
	readonly title?: string;
	readonly subtitle?: string;
	readonly trust?: "trusted" | "untrusted";
	readonly metadata?: Readonly<Record<string, string>>;
	readonly trustMetadata?: Partial<RichDocumentTrustMetadata>;
	readonly content?: string;
	readonly sections?: readonly RichDocumentSection[];
}

function normalizeTrustMetadata(input: RichDocumentLoadInput): RichDocumentTrustMetadata {
	const trust = input.trustMetadata?.trust ?? input.trust ?? "untrusted";
	const policyVersion = input.trustMetadata?.policyVersion ?? "rich-doc-v1";
	return {
		trust,
		policyVersion,
		evaluatedAt: input.trustMetadata?.evaluatedAt ?? new Date().toISOString(),
		assertedBy: input.trustMetadata?.assertedBy,
		reason: input.trustMetadata?.reason,
	};
}

function isMarkdownLikeMediaType(mediaType: string): boolean {
	return mediaType.includes("markdown") || mediaType.includes("mdx") || mediaType.includes("md");
}

export function resolveRichDocumentSourcePolicy(source: Pick<RichDocumentSource, "mediaType" | "trustMetadata">): RichDocumentSourcePolicy {
	const trust = source.trustMetadata.trust;
	if (trust === "trusted") {
		return {
			pipeline: "mdx-capable",
			renderMode: isMarkdownLikeMediaType(source.mediaType) ? "mdx" : "plain-text",
			allowShellComponents: true,
		};
	}
	if (isMarkdownLikeMediaType(source.mediaType)) {
		return {
			pipeline: "safe-markdown",
			renderMode: "markdown",
			allowShellComponents: false,
		};
	}
	return {
		pipeline: "plain-text",
		renderMode: "plain-text",
		allowShellComponents: false,
	};
}

export function loadRichDocumentModel(input: RichDocumentLoadInput): RichDocumentRenderModel {
	const trustMetadata = normalizeTrustMetadata(input);
	const sourceDraft: RichDocumentSource = {
		id: input.id,
		uri: input.uri,
		mediaType: input.mediaType,
		title: input.title,
		trust: trustMetadata.trust,
		metadata: input.metadata,
		trustMetadata,
		sourcePolicy: {
			pipeline: "plain-text",
			renderMode: "plain-text",
			allowShellComponents: false,
		},
	};
	const sourcePolicy = resolveRichDocumentSourcePolicy(sourceDraft);
	const source: RichDocumentSource = {
		...sourceDraft,
		sourcePolicy,
	};
	const sections = input.sections ?? [
		{
			id: `${input.id}:body`,
			title: input.title,
			content: input.content ?? "",
		},
	];
	return {
		id: input.id,
		source,
		title: input.title ?? input.uri,
		subtitle: input.subtitle,
		sections,
	};
}
