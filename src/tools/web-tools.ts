import { fetch } from "undici";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "../local-coding-agent.js";

const LANGSEARCH_WEB_SEARCH_URL = "https://api.langsearch.com/v1/web-search";
const LANGSEARCH_PROVIDER = "langsearch";
const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 10;
const DEFAULT_WEB_READ_CHARS = 12000;
const MAX_WEB_READ_CHARS = 30000;

const WEB_SEARCH_FRESHNESS_VALUES = ["oneDay", "oneWeek", "oneMonth", "oneYear", "noLimit"] as const;
const WEB_READ_FORMAT_VALUES = ["markdown", "text"] as const;

type WebSearchFreshness = (typeof WEB_SEARCH_FRESHNESS_VALUES)[number];
type WebReadFormat = (typeof WEB_READ_FORMAT_VALUES)[number];

interface LangSearchWebPage {
	name?: unknown;
	url?: unknown;
	snippet?: unknown;
	summary?: unknown;
	datePublished?: unknown;
	dateLastCrawled?: unknown;
}

interface LangSearchResponsePayload {
	code?: unknown;
	msg?: unknown;
	data?: {
		webPages?: {
			value?: unknown;
		};
	};
}

export interface WebSearchResultRecord {
	index: number;
	title: string;
	url: string;
	snippet?: string;
	summary?: string;
	publishedDate?: string;
}

export interface WebSearchToolDetails {
	query: string;
	freshness: WebSearchFreshness;
	count: number;
	includeSummary: boolean;
	results: WebSearchResultRecord[];
}

export interface WebReadToolDetails {
	url: string;
	finalUrl: string;
	contentType: string;
	format: WebReadFormat;
	title?: string;
	truncated: boolean;
	maxChars: number;
	originalLength: number;
	extractedLength: number;
}

export interface WebSearchParams {
	query: string;
	freshness?: WebSearchFreshness;
	count?: number;
	includeSummary?: boolean;
	apiKey?: string;
}

export interface WebReadParams {
	url: string;
	maxChars?: number;
	format?: WebReadFormat;
}

export function createWebTools(): ToolDefinition[] {
	return [createWebSearchTool(), createWebReadTool()];
}

export async function runWebSearch(
	params: WebSearchParams,
	signal?: AbortSignal,
): Promise<{ text: string; details: WebSearchToolDetails }> {
	const query = params.query.trim();
	if (!query) {
		throw new Error("web_search requires a non-empty query.");
	}
	const freshness = normalizeFreshness(params.freshness);
	const count = clampInteger(params.count, DEFAULT_SEARCH_COUNT, 1, MAX_SEARCH_COUNT);
	const includeSummary = params.includeSummary ?? true;
	const apiKey = resolveLangSearchApiKey(params.apiKey);

	const response = await fetch(LANGSEARCH_WEB_SEARCH_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			query,
			freshness,
			summary: includeSummary,
			count,
		}),
		signal,
	});

	const payload = await parseJsonResponse<LangSearchResponsePayload>(response);
	if (!response.ok) {
		const message = typeof payload?.msg === "string" && payload.msg.trim().length > 0 ? payload.msg.trim() : response.statusText;
		throw new Error(`LangSearch request failed (${response.status}): ${message}`);
	}
	if (payload?.code !== 200) {
		const message = typeof payload?.msg === "string" && payload.msg.trim().length > 0 ? payload.msg.trim() : "Unexpected response.";
		throw new Error(`LangSearch request failed: ${message}`);
	}

	const rawPages = Array.isArray(payload?.data?.webPages?.value) ? payload.data.webPages.value : [];
	const results = rawPages
		.map((page, index) => normalizeSearchResult(page as LangSearchWebPage, index + 1, includeSummary))
		.filter((page): page is WebSearchResultRecord => page !== undefined);

	const details: WebSearchToolDetails = {
		query,
		freshness,
		count,
		includeSummary,
		results,
	};

	if (results.length === 0) {
		return {
			text: `No relevant results found for "${query}".`,
			details,
		};
	}

	return {
		text: formatSearchResults(details),
		details,
	};
}

export async function runWebRead(
	params: WebReadParams,
	signal?: AbortSignal,
): Promise<{ text: string; details: WebReadToolDetails }> {
	const url = normalizeAbsoluteUrl(params.url);
	const maxChars = clampInteger(params.maxChars, DEFAULT_WEB_READ_CHARS, 1000, MAX_WEB_READ_CHARS);
	const format = normalizeFormat(params.format);

	const response = await fetch(url, {
		method: "GET",
		headers: {
			"User-Agent": "VibeAgent/1.0 web_read",
			Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5,*/*;q=0.1",
		},
		signal,
	});

	if (!response.ok) {
		throw new Error(`Unable to read ${url}: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
	}

	const finalUrl = response.url || url;
	const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "unknown";
	if (!isSupportedHtmlContentType(contentType)) {
		const unsupportedText =
			format === "markdown"
				? `Unsupported content type for web_read v1.\n\n- URL: ${finalUrl}\n- Content-Type: ${contentType}\n- Supported: text/html, application/xhtml+xml`
				: `Unsupported content type for web_read v1.\nURL: ${finalUrl}\nContent-Type: ${contentType}\nSupported: text/html, application/xhtml+xml`;
		return {
			text: unsupportedText,
			details: {
				url,
				finalUrl,
				contentType,
				format,
				truncated: false,
				maxChars,
				originalLength: 0,
				extractedLength: 0,
			},
		};
	}

	const html = await response.text();
	const extracted = extractReadableContent(html, finalUrl, format);
	const originalLength = extracted.body.length;
	const truncatedBody = truncateText(extracted.body, maxChars);
	const details: WebReadToolDetails = {
		url,
		finalUrl,
		contentType,
		format,
		title: extracted.title,
		truncated: truncatedBody.truncated,
		maxChars,
		originalLength,
		extractedLength: truncatedBody.text.length,
	};

	return {
		text: formatReadResult({
			url: finalUrl,
			title: extracted.title,
			body: truncatedBody.text,
			format,
			truncated: truncatedBody.truncated,
			contentType,
		}),
		details,
	};
}

function createWebSearchTool(): ToolDefinition {
	return {
		name: "web_search",
		label: "Web Search",
		description: "Search the public web with LangSearch and return cited results with URLs, snippets, and summaries.",
		promptSnippet: "Search the public web via LangSearch and cite numbered results with URLs.",
		promptGuidelines: [
			"Use web_search first when you need public web information, current docs, or recent references.",
			"Prefer citing web_search results by bracketed result number such as [1], with the matching URL.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search query to run against the public web." }),
			freshness: Type.Optional(
				Type.Union(
					WEB_SEARCH_FRESHNESS_VALUES.map((value) => Type.Literal(value)),
					{ description: "Time window for search results." },
				),
			),
			count: Type.Optional(Type.Number({ description: "Number of results to return. Defaults to 5, max 10." })),
			includeSummary: Type.Optional(Type.Boolean({ description: "Whether to request LangSearch summaries. Defaults to true." })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const apiKey = await ctx.modelRegistry.getApiKeyForProvider(LANGSEARCH_PROVIDER);
			const result = await runWebSearch({ ...(params as WebSearchParams), apiKey }, signal);
			return {
				content: [{ type: "text", text: result.text }],
				details: result.details,
			};
		},
	};
}

function createWebReadTool(): ToolDefinition {
	return {
		name: "web_read",
		label: "Web Read",
		description: "Fetch a selected web page over HTTP and return cleaned readable content for deeper review.",
		promptSnippet: "Read a selected URL after search and return cleaned page content.",
		promptGuidelines: [
			"Use web_read only after selecting a relevant URL, usually from web_search.",
			"Do not crawl broadly with web_read; fetch only the pages you need to inspect.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "Absolute HTTP or HTTPS URL to fetch." }),
			maxChars: Type.Optional(
				Type.Number({ description: "Maximum number of characters to return after cleanup. Defaults to 12000, max 30000." }),
			),
			format: Type.Optional(
				Type.Union(
					WEB_READ_FORMAT_VALUES.map((value) => Type.Literal(value)),
					{ description: "Response format. Defaults to markdown." },
				),
			),
		}),
		async execute(_toolCallId, params, signal) {
			const result = await runWebRead(params as WebReadParams, signal);
			return {
				content: [{ type: "text", text: result.text }],
				details: result.details,
			};
		},
	};
}

function resolveLangSearchApiKey(candidate?: string): string {
	const apiKey = candidate?.trim() || process.env.LANGSEARCH_API_KEY?.trim();
	if (!apiKey) {
		throw new Error("No LangSearch API key is configured. Store provider 'langsearch' in auth.json or set LANGSEARCH_API_KEY.");
	}
	return apiKey;
}

function normalizeFreshness(value: WebSearchParams["freshness"]): WebSearchFreshness {
	return WEB_SEARCH_FRESHNESS_VALUES.includes(value ?? "noLimit") ? (value ?? "noLimit") : "noLimit";
}

function normalizeFormat(value: WebReadParams["format"]): WebReadFormat {
	return WEB_READ_FORMAT_VALUES.includes(value ?? "markdown") ? (value ?? "markdown") : "markdown";
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
	if (!Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, Math.floor(value as number)));
}

function normalizeSearchResult(
	page: LangSearchWebPage,
	index: number,
	includeSummary: boolean,
): WebSearchResultRecord | undefined {
	const url = normalizeOptionalUrl(page.url);
	if (!url) {
		return undefined;
	}
	const title = normalizeText(page.name) ?? url;
	const snippet = truncateField(normalizeText(page.snippet), 500);
	const summary = includeSummary ? truncateField(normalizeText(page.summary), 900) : undefined;
	const publishedDate = normalizeText(page.datePublished) ?? normalizeText(page.dateLastCrawled);
	return {
		index,
		title,
		url,
		snippet,
		summary,
		publishedDate,
	};
}

function formatSearchResults(details: WebSearchToolDetails): string {
	const header = [
		`Web results for "${details.query}"`,
		"",
		"Use bracketed result numbers like [1] when citing these sources.",
	];
	const blocks = details.results.map((result) => {
		const lines = [`[${result.index}] ${result.title}`, `URL: ${result.url}`];
		if (result.publishedDate) {
			lines.push(`Published: ${result.publishedDate}`);
		}
		if (result.snippet) {
			lines.push(`Snippet: ${result.snippet}`);
		}
		if (result.summary) {
			lines.push(`Summary: ${result.summary}`);
		}
		return lines.join("\n");
	});
	return [...header, "", ...blocks].join("\n\n").trim();
}

async function parseJsonResponse<T>(response: Response): Promise<T | undefined> {
	const rawBody = await response.text();
	if (!rawBody.trim()) {
		return undefined;
	}
	try {
		return JSON.parse(rawBody) as T;
	} catch {
		if (response.ok) {
			throw new Error("Received a non-JSON response from LangSearch.");
		}
		return undefined;
	}
}

function normalizeAbsoluteUrl(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) {
		throw new Error("web_read requires a non-empty URL.");
	}
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error("Only http and https URLs are supported.");
		}
		return parsed.toString();
	} catch (error) {
		const message = error instanceof Error ? error.message : "Invalid URL.";
		throw new Error(`Invalid URL for web_read: ${message}`);
	}
}

function normalizeOptionalUrl(input: unknown): string | undefined {
	if (typeof input !== "string" || input.trim().length === 0) {
		return undefined;
	}
	try {
		const parsed = new URL(input.trim());
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return undefined;
		}
		return parsed.toString();
	} catch {
		return undefined;
	}
}

function normalizeText(input: unknown): string | undefined {
	if (typeof input !== "string") {
		return undefined;
	}
	const cleaned = collapseWhitespace(decodeHtmlEntities(input));
	return cleaned.length > 0 ? cleaned : undefined;
}

function truncateField(value: string | undefined, maxChars: number): string | undefined {
	if (!value) {
		return undefined;
	}
	return value.length > maxChars ? `${value.slice(0, maxChars - 3).trimEnd()}...` : value;
}

function isSupportedHtmlContentType(contentType: string): boolean {
	return contentType === "text/html" || contentType === "application/xhtml+xml";
}

function extractReadableContent(
	html: string,
	baseUrl: string,
	format: WebReadFormat,
): { title?: string; body: string } {
	const title = extractTitle(html);
	const bodyHtml = extractBody(html);
	const cleanedHtml = bodyHtml
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
		.replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, "")
		.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
		.replace(/<(nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
		.replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, "")
		.replace(/<img\b[^>]*alt=(["'])(.*?)\1[^>]*>/gi, " $2 ")
		.replace(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_match, _quote, href, inner) =>
			formatLink(inner, href, baseUrl, format),
		)
		.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, inner) => formatHeading(inner, Number(level), format))
		.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, inner) => `${format === "markdown" ? "- " : "* "}${inlineText(inner)}\n`)
		.replace(/<(p|div|section|article|main|header|footer|aside|blockquote|pre|table|tr)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, inner) =>
			`${inlineText(inner)}\n\n`,
		)
		.replace(/<br\s*\/?>/gi, "\n");

	const stripped = cleanedHtml.replace(/<[^>]+>/g, " ");
	const decoded = decodeHtmlEntities(stripped);
	const body = collapseReadableText(decoded);
	return {
		title,
		body: body.length > 0 ? body : "No readable text could be extracted from this page.",
	};
}

function extractTitle(html: string): string | undefined {
	const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
	if (!match) {
		return undefined;
	}
	return normalizeText(match[1]);
}

function extractBody(html: string): string {
	const match = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
	return match?.[1] ?? html;
}

function formatHeading(inner: string, level: number, format: WebReadFormat): string {
	const text = inlineText(inner);
	if (!text) {
		return "";
	}
	if (format === "markdown") {
		return `${"#".repeat(Math.max(1, Math.min(level, 6)))} ${text}\n\n`;
	}
	return `${text}\n\n`;
}

function formatLink(inner: string, href: string, baseUrl: string, format: WebReadFormat): string {
	const text = inlineText(inner);
	const resolved = resolveUrl(href, baseUrl);
	if (!resolved) {
		return text;
	}
	if (!text || text === resolved) {
		return resolved;
	}
	if (format === "markdown") {
		return `[${text}](${resolved})`;
	}
	return `${text} (${resolved})`;
}

function resolveUrl(candidate: string, baseUrl: string): string | undefined {
	try {
		const url = new URL(candidate, baseUrl);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return undefined;
		}
		return url.toString();
	} catch {
		return undefined;
	}
}

function inlineText(input: string): string {
	const withoutTags = input.replace(/<[^>]+>/g, " ");
	return collapseWhitespace(decodeHtmlEntities(withoutTags));
}

function collapseWhitespace(input: string): string {
	return input.replace(/\s+/g, " ").trim();
}

function collapseReadableText(input: string): string {
	return input
		.replace(/\r/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.split("\n")
		.map((line) => line.trim())
		.join("\n")
		.trim();
}

function decodeHtmlEntities(input: string): string {
	const namedEntities: Record<string, string> = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: "\"",
		apos: "'",
		nbsp: " ",
		mdash: "-",
		ndash: "-",
		hellip: "...",
		copy: "(c)",
		reg: "(r)",
		trade: "TM",
	};

	return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
		const normalized = entity.toLowerCase();
		if (normalized.startsWith("#x")) {
			const codePoint = Number.parseInt(normalized.slice(2), 16);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
		}
		if (normalized.startsWith("#")) {
			const codePoint = Number.parseInt(normalized.slice(1), 10);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
		}
		return namedEntities[normalized] ?? match;
	});
}

function truncateText(input: string, maxChars: number): { text: string; truncated: boolean } {
	if (input.length <= maxChars) {
		return { text: input, truncated: false };
	}
	const truncated = input.slice(0, Math.max(0, maxChars - 40)).trimEnd();
	return {
		text: `${truncated}\n\n[truncated to ${maxChars} characters]`,
		truncated: true,
	};
}

function formatReadResult(params: {
	url: string;
	title?: string;
	body: string;
	format: WebReadFormat;
	truncated: boolean;
	contentType: string;
}): string {
	if (params.format === "text") {
		const header = [
			params.title ? params.title : "Fetched page",
			`Source: ${params.url}`,
			`Content-Type: ${params.contentType}`,
			params.truncated ? "Note: content truncated." : undefined,
		].filter((value): value is string => Boolean(value));
		return `${header.join("\n")}\n\n${params.body}`.trim();
	}

	const header = [
		params.title ? `# ${params.title}` : "# Fetched page",
		`Source: ${params.url}`,
		`Content-Type: ${params.contentType}`,
		params.truncated ? "Note: content truncated." : undefined,
	].filter((value): value is string => Boolean(value));
	return `${header.join("\n\n")}\n\n${params.body}`.trim();
}
