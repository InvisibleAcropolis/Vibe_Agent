import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { createPlaceholderRuntime } from "../style-test-fixtures.js";
import { defineStyleTestDemos, type StyleTestRuntimeContext } from "../style-test-contract.js";
import { agentTheme, createDynamicTheme } from "../theme.js";
import type { HostedLayoutCapable, HostedSizeRequirements, HostedViewportDimensions } from "../types.js";
import { animPreloadService } from "./animpreload-service.js";
import { FloatWindow, type FloatWindowModel } from "./float_window.js";

export interface FloatingAnimBoxPreset {
	sourceFile: string;
	exportName: string;
	animationPresetId: string;
	cols: number;
	rows: number;
	x: number;
	y: number;
}

export interface FloatingAnimBoxWindowOptions {
	title?: string;
	instanceId?: string;
	active?: boolean;
	zIndex?: number;
	minCols?: number;
	minRows?: number;
	maxCols?: number;
	maxRows?: number;
	onStateChange?: (model: FloatWindowModel) => void;
	onViewportChange?: (viewport: HostedViewportDimensions) => void;
}

export const DEFAULT_FLOATING_ANIMBOX_PRESET: FloatingAnimBoxPreset = {
	sourceFile: "src/components/anim_plasma.ts",
	exportName: "renderPlasma",
	animationPresetId: "default",
	cols: 40,
	rows: 12,
	x: 10,
	y: 5,
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

function padViewportLine(text: string, width: number): string {
	const clipped = sliceVisibleAnsi(text, 0, width);
	const truncated = truncateToWidth(clipped, width, "");
	return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function buildFallbackLines(message: string, preset: FloatingAnimBoxPreset, height: number): string[] {
	const base = [
		agentTheme.warning("Floating Animbox target unavailable"),
		agentTheme.text(message),
		agentTheme.dim(`${preset.sourceFile}#${preset.exportName}`),
		agentTheme.dim(`animation preset: ${preset.animationPresetId}`),
	];
	return [...base, ...Array.from({ length: Math.max(0, height - base.length) }, () => "")];
}

function toWindowWidth(cols: number): number {
	return Math.max(10, cols) + 2;
}

function toWindowHeight(rows: number): number {
	return Math.max(4, rows) + 4;
}

export class FloatingAnimBoxContent implements HostedLayoutCapable {
	private viewport: HostedViewportDimensions;
	private preset: FloatingAnimBoxPreset;

	constructor(
		private readonly context: StyleTestRuntimeContext,
		preset: FloatingAnimBoxPreset,
		private readonly instanceId = "floating-animbox",
		private readonly onViewportChange?: (viewport: HostedViewportDimensions) => void,
	) {
		this.preset = { ...preset };
		this.viewport = { width: Math.max(8, preset.cols), height: Math.max(4, preset.rows) };
	}

	invalidate(): void {}

	getPreset(): FloatingAnimBoxPreset {
		return { ...this.preset, cols: this.viewport.width, rows: this.viewport.height };
	}

	setPreset(preset: FloatingAnimBoxPreset): void {
		this.preset = { ...preset };
	}

	getHostedSizeRequirements(): HostedSizeRequirements {
		return {
			minWidth: 8,
			minHeight: 4,
			preferredWidth: Math.max(8, this.preset.cols),
			preferredHeight: Math.max(4, this.preset.rows),
			maxWidth: 120,
			maxHeight: 40,
		};
	}

	setHostedViewportSize(viewport: HostedViewportDimensions): void {
		this.viewport = {
			width: Math.max(8, viewport.width),
			height: Math.max(4, viewport.height),
		};
		this.onViewportChange?.({ ...this.viewport });
	}

	render(width: number): string[] {
		const cols = Math.max(1, Math.min(width, this.viewport.width));
		const rows = Math.max(1, this.viewport.height);
		const handle = animPreloadService.getOrCreateInstance(
			{
				sourceFile: this.preset.sourceFile,
				exportName: this.preset.exportName,
				presetId: this.preset.animationPresetId,
				instanceId: this.instanceId,
			},
			this.context,
		);

		let contentLines: string[];
		try {
			contentLines = animPreloadService.renderInstance(handle, cols, rows);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			contentLines = buildFallbackLines(message, this.preset, rows);
		}

		const dynamicTheme = createDynamicTheme(this.context.getAnimationState());
		return Array.from({ length: rows }, (_, index) => {
			const line = padViewportLine(contentLines[index] ?? "", cols);
			return index === rows - 1 && rows > 2
				? dynamicTheme.borderAnimated(line)
				: line;
		});
	}
}

export function createFloatingAnimBoxWindow(
	preset: FloatingAnimBoxPreset,
	context: StyleTestRuntimeContext,
	options: FloatingAnimBoxWindowOptions = {},
): FloatWindow {
	const content = new FloatingAnimBoxContent(
		context,
		preset,
		options.instanceId ?? "floating-animbox",
		options.onViewportChange,
	);
	return new FloatWindow({
		title: options.title ?? "Floating Animbox",
		status: `${preset.exportName} · ${preset.animationPresetId}`,
		content,
		initialState: {
			row: preset.y,
			col: preset.x,
			width: toWindowWidth(preset.cols),
			height: toWindowHeight(preset.rows),
			active: options.active ?? true,
			zIndex: options.zIndex ?? 0,
		},
		minWidth: toWindowWidth(options.minCols ?? 8),
		minHeight: toWindowHeight(options.minRows ?? 4),
		maxWidth: toWindowWidth(options.maxCols ?? 120),
		maxHeight: toWindowHeight(options.maxRows ?? 40),
		onStateChange: options.onStateChange,
	});
}

export const styleTestDemos = defineStyleTestDemos({
	autoExports: false,
	exports: {
		floatingAnimBoxReference: {
			title: "Floating Animbox",
			category: "Primitives",
			kind: "placeholder",
			description: "Specialized floating animation window. Open it from TUIstyletest with F9.",
			createRuntime: () =>
				createPlaceholderRuntime(
					"Floating Animbox",
					"Open TUIstyletest and press F9 to launch the floating animbox window and preset designer.",
					"src/components/floating_animbox.ts",
				),
		},
	},
});
