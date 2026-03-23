import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { createDynamicTheme } from "../themes/index.js";
import { defineStyleTestDemos, type StyleTestRuntime, type StyleTestRuntimeContext } from "../style-test-contract.js";
import { agentTheme } from "../theme.js";
import { animPreloadService } from "./animpreload-service.js";

export interface AnimBoxOptions {
	cols?: number;
	rows?: number;
	x?: number;
	y?: number;
	sourceFile?: string;
	exportName?: string;
	presetId?: string;
}

const DEFAULTS: Required<AnimBoxOptions> = {
	cols: 24,
	rows: 8,
	x: 0,
	y: 0,
	sourceFile: "src/components/anim_plasma.ts",
	exportName: "renderPlasma",
	presetId: "default",
};

function sliceVisibleAnsi(text: string, start: number, width: number): string {
	if (width <= 0) {
		return "";
	}
	let visibleIndex = 0;
	let inEscape = false;
	let output = "";
	for (let index = 0; index < text.length; index++) {
		const char = text[index] ?? "";
		if (char === "\x1b") {
			inEscape = true;
			if (visibleIndex >= start && visibleIndex < start + width) {
				output += char;
			}
			continue;
		}
		if (inEscape) {
			if (visibleIndex >= start && visibleIndex < start + width) {
				output += char;
			}
			if (char === "m") {
				inEscape = false;
			}
			continue;
		}
		if (visibleIndex >= start && visibleIndex < start + width) {
			output += char;
		}
		visibleIndex++;
		if (visibleIndex >= start + width) {
			break;
		}
	}
	return output;
}

function paintProjectedLine(text: string, x: number, totalWidth: number): string {
	if (totalWidth <= 0) {
		return "";
	}
	const contentWidth = visibleWidth(text);
	if (x >= totalWidth || x + contentWidth <= 0) {
		return " ".repeat(totalWidth);
	}
	const clipLeft = Math.max(0, -x);
	const drawStart = Math.max(0, x);
	const drawWidth = Math.max(0, totalWidth - drawStart);
	const clipped = sliceVisibleAnsi(text, clipLeft, drawWidth);
	const clippedWidth = visibleWidth(clipped);
	return " ".repeat(drawStart) + clipped + " ".repeat(Math.max(0, totalWidth - drawStart - clippedWidth));
}

function padInnerLine(text: string, width: number): string {
	const truncated = truncateToWidth(text, width, "");
	return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function buildFallbackLines(message: string, sourceFile: string, exportName: string, rows: number): string[] {
	const base = [
		agentTheme.warning("Animbox target unavailable"),
		agentTheme.text(message),
		agentTheme.dim(`${sourceFile}#${exportName}`),
	];
	return [...base, ...Array.from({ length: Math.max(0, rows - base.length) }, () => "")];
}

class AnimBoxRuntime implements StyleTestRuntime {
	private readonly instanceId = "animbox-primitive#default";

	constructor(
		private readonly context: StyleTestRuntimeContext,
		private readonly options: Required<AnimBoxOptions>,
	) {}

	render(width: number, height: number): string[] {
		const dynamicTheme = createDynamicTheme(this.context.getTheme(), this.context.getAnimationState());
		const border = dynamicTheme.borderAnimated;
		const { cols, rows, x, y, sourceFile, exportName, presetId } = this.options;
		const handle = animPreloadService.getOrCreateInstance(
			{
				sourceFile,
				exportName,
				presetId,
				instanceId: this.instanceId,
			},
			this.context,
		);

		let contentLines: string[];
		try {
			contentLines = animPreloadService.renderInstance(handle, cols, rows);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			contentLines = buildFallbackLines(message, sourceFile, exportName, rows);
		}

		const bodyLines = Array.from({ length: rows }, (_, index) => {
			const inner = padInnerLine(contentLines[index] ?? "", cols);
			return `${border("│")}${inner}${border("│")}`;
		});
		const boxLines = [
			border(`╭${"─".repeat(cols)}╮`),
			...bodyLines,
			border(`╰${"─".repeat(cols)}╯`),
		];

		return Array.from({ length: height }, (_, rowIndex) => {
			const localRow = rowIndex - y;
			if (localRow < 0 || localRow >= boxLines.length) {
				return " ".repeat(width);
			}
			return paintProjectedLine(boxLines[localRow] ?? "", x, width);
		});
	}
}

export function renderAnimBoxPrimitive(): string {
	return "";
}

export const styleTestDemos = defineStyleTestDemos({
	autoExports: false,
	exports: {
		renderAnimBoxPrimitive: {
			title: "Animbox Primitive",
			category: "Primitives",
			kind: "primitive",
			description: "Live boxed viewport for any anim source/export/preset target.",
			controls: [
				{ id: "cols", label: "Cols", type: "number", defaultValue: DEFAULTS.cols, min: 4, max: 120, step: 1 },
				{ id: "rows", label: "Rows", type: "number", defaultValue: DEFAULTS.rows, min: 4, max: 40, step: 1 },
				{ id: "x", label: "X", type: "number", defaultValue: DEFAULTS.x, min: -20, max: 120, step: 1 },
				{ id: "y", label: "Y", type: "number", defaultValue: DEFAULTS.y, min: -10, max: 40, step: 1 },
				{ id: "sourceFile", label: "Source File", type: "text", defaultValue: DEFAULTS.sourceFile },
				{ id: "exportName", label: "Export Name", type: "text", defaultValue: DEFAULTS.exportName },
				{ id: "presetId", label: "Preset Id", type: "text", defaultValue: DEFAULTS.presetId },
			],
			createRuntime: (_moduleNamespace, _exportName, _exportValue, context, values) =>
				new AnimBoxRuntime(context, {
					cols: Number(values.cols ?? DEFAULTS.cols),
					rows: Number(values.rows ?? DEFAULTS.rows),
					x: Number(values.x ?? DEFAULTS.x),
					y: Number(values.y ?? DEFAULTS.y),
					sourceFile: String(values.sourceFile ?? DEFAULTS.sourceFile),
					exportName: String(values.exportName ?? DEFAULTS.exportName),
					presetId: String(values.presetId ?? DEFAULTS.presetId),
				}),
		},
	},
});
