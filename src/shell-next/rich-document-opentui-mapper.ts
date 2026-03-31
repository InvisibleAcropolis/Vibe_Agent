import type { RichDocumentComponent, RichDocumentRenderModel } from "./shared-models.js";

export type OpenTuiRichComponentType =
	| "Heading"
	| "Callout"
	| "CodeBlock"
	| "MetadataRow"
	| "Link"
	| "TimelineCard"
	| "Collapsible"
	| "MarkdownText";

export interface OpenTuiRichComponent {
	readonly id: string;
	readonly type: OpenTuiRichComponentType;
	readonly props: Readonly<Record<string, string | number | boolean>>;
}

export interface OpenTuiRichDocumentSection {
	readonly id: string;
	readonly title?: string;
	readonly collapsed?: boolean;
	readonly components: readonly OpenTuiRichComponent[];
}

export interface OpenTuiRichDocumentModel {
	readonly id: string;
	readonly title: string;
	readonly subtitle?: string;
	readonly sourceUri: string;
	readonly sections: readonly OpenTuiRichDocumentSection[];
}

function toOpenTuiComponent(component: RichDocumentComponent): OpenTuiRichComponent {
	switch (component.kind) {
		case "heading":
			return { id: component.id, type: "Heading", props: { level: component.level, text: component.text } };
		case "callout":
			return { id: component.id, type: "Callout", props: { variant: component.variant, text: component.text } };
		case "code":
			return { id: component.id, type: "CodeBlock", props: { language: component.language ?? "", code: component.code } };
		case "metadata":
			return { id: component.id, type: "MetadataRow", props: { key: component.key, value: component.value } };
		case "link":
			return { id: component.id, type: "Link", props: { text: component.text, href: component.href } };
		case "timeline-card":
			return { id: component.id, type: "TimelineCard", props: { title: component.title, date: component.date, body: component.body } };
		case "collapsible":
			return { id: component.id, type: "Collapsible", props: { title: component.title, content: component.content } };
		case "markdown-text":
			return { id: component.id, type: "MarkdownText", props: { text: component.text } };
	}
}

export function mapRichDocumentToOpenTui(model: RichDocumentRenderModel): OpenTuiRichDocumentModel {
	return {
		id: model.id,
		title: model.title,
		subtitle: model.subtitle,
		sourceUri: model.source.uri,
		sections: model.sections.map((section) => ({
			id: section.id,
			title: section.title,
			collapsed: section.collapsed,
			components: (section.components ?? []).map(toOpenTuiComponent),
		})),
	};
}
