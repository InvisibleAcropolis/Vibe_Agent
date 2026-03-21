import { matchesKey, type Focusable } from "@mariozechner/pi-tui";
import { horizontalRule, paintLine } from "../ansi.js";
import type { MouseEvent, Rect } from "../mouse.js";
import { pointInRect } from "../mouse.js";
import { createOverlayPreviewRuntime, sampleArtifacts } from "../style-test-fixtures.js";
import { defineStyleTestDemos } from "../style-test-contract.js";
import { agentTheme } from "../theme.js";
import type { Artifact, MouseAwareOverlay } from "../types.js";

/**
 * Artifact viewer overlay: displays file contents, code blocks, diffs, and other
 * artifacts generated during agent interactions. This provides TUI parity with the
 * WebUI's artifact display panel.
 */
export class ArtifactViewer implements MouseAwareOverlay, Focusable {
	private _focused = false;
	private scrollOffset = 0;
	private selectedIndex = 0;

	constructor(
		private readonly artifacts: Artifact[],
		private readonly onClose: () => void,
	) {}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const lines: string[] = [];
		const top = agentTheme.dim("╭" + "─".repeat(Math.max(0, width - 2)) + "╮");
		const bottom = agentTheme.dim("╰" + "─".repeat(Math.max(0, width - 2)) + "╯");

		lines.push(paintLine(top, width, agentTheme.panelBgActive));
		lines.push(paintLine(agentTheme.accentStrong(" Artifacts"), width, agentTheme.panelBgActive));
		lines.push(paintLine(agentTheme.muted(` ${this.artifacts.length} artifact(s) in this session`), width, agentTheme.panelBgActive));
		lines.push(paintLine(horizontalRule(width - 2, "─", agentTheme.dim), width, agentTheme.panelBgActive));

		if (this.artifacts.length === 0) {
			lines.push(paintLine(agentTheme.dim("  No artifacts yet. Artifacts appear when the agent creates or modifies files."), width, agentTheme.panelBgActive));
			lines.push(paintLine("", width, agentTheme.panelBgActive));
			lines.push(paintLine(agentTheme.dim("  Esc close"), width, agentTheme.panelBgActive));
			return lines;
		}

		for (let i = 0; i < this.artifacts.length; i++) {
			const artifact = this.artifacts[i];
			const isSelected = i === this.selectedIndex;
			const prefix = isSelected ? agentTheme.accent("  > ") : "    ";
			const typeIcon = this.getTypeIcon(artifact.type);
			const titleStyle = isSelected ? agentTheme.accentStrong : agentTheme.text;

			lines.push(paintLine(`${prefix}${typeIcon} ${titleStyle(artifact.title)}`, width, agentTheme.panelBgActive));

			if (artifact.filePath) {
				lines.push(paintLine(`      ${agentTheme.dim(artifact.filePath)}`, width, agentTheme.panelBgActive));
			}

			if (isSelected && artifact.content) {
				lines.push(paintLine(horizontalRule(width - 6, "·", agentTheme.dim), width, agentTheme.panelBgActive));
				const contentLines = artifact.content.split("\n");
				const maxPreviewLines = 12;
				const displayLines = contentLines.slice(this.scrollOffset, this.scrollOffset + maxPreviewLines);

				for (const contentLine of displayLines) {
					const lang = artifact.language;
					const lineText = lang ? agentTheme.text(contentLine) : contentLine;
					lines.push(paintLine(`      ${lineText}`, width, agentTheme.panelBgActive));
				}

				if (contentLines.length > maxPreviewLines) {
					const total = contentLines.length;
					const showing = Math.min(this.scrollOffset + maxPreviewLines, total);
					lines.push(paintLine(
						agentTheme.dim(`      ... ${showing}/${total} lines (scroll for more)`),
						width,
						agentTheme.panelBgActive,
					));
				}
				lines.push(paintLine(horizontalRule(width - 6, "·", agentTheme.dim), width, agentTheme.panelBgActive));
			}
		}

		lines.push(paintLine("", width, agentTheme.panelBgActive));
		lines.push(paintLine(
			agentTheme.dim("  Up/Down navigate  |  Scroll preview  |  Esc close"),
			width,
			agentTheme.panelBgActive,
		));
		lines.push(paintLine(bottom, width, agentTheme.panelBgActive));

		return lines;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "esc")) {
			this.onClose();
			return;
		}
		if (matchesKey(data, "up")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.scrollOffset = 0;
			return;
		}
		if (matchesKey(data, "down")) {
			this.selectedIndex = Math.min(this.artifacts.length - 1, this.selectedIndex + 1);
			this.scrollOffset = 0;
			return;
		}
		if (matchesKey(data, "pageUp") || data === "k") {
			this.scrollOffset = Math.max(0, this.scrollOffset - 5);
			return;
		}
		if (matchesKey(data, "pageDown") || data === "j") {
			this.scrollOffset = Math.max(0, this.scrollOffset + 5);
			return;
		}
	}

	handleMouse(event: MouseEvent, rect: Rect): boolean {
		if (!pointInRect(event, rect)) {
			return false;
		}
		if (event.action === "scroll") {
			if (event.button === "wheelUp") {
				this.scrollOffset = Math.max(0, this.scrollOffset - 3);
			} else {
				this.scrollOffset += 3;
			}
			return true;
		}
		return true;
	}

	private getTypeIcon(type: Artifact["type"]): string {
		switch (type) {
			case "file": return agentTheme.toolLabel("FILE");
			case "code": return agentTheme.artifactLabel("CODE");
			case "diff": return agentTheme.warning("DIFF");
			case "image": return agentTheme.info("IMG ");
			case "html": return agentTheme.accent("HTML");
			case "text": return agentTheme.muted("TEXT");
			default: return agentTheme.dim("????");
		}
	}
}

export const styleTestDemos = defineStyleTestDemos({
	exports: {
		ArtifactViewer: {
			title: "Artifact Viewer Overlay",
			category: "Overlays",
			kind: "overlay",
			description: "Artifact overlay with fixture code and diff output.",
			createRuntime: (_moduleNamespace, _exportName, _exportValue, context) =>
				createOverlayPreviewRuntime(
					"Artifact overlay with fixture code and diff output.",
					"src/components/artifact-viewer.ts",
					() =>
						context.showOverlay(
							"styletest-artifacts",
							new ArtifactViewer(sampleArtifacts(), () => context.closeOverlay("styletest-artifacts")),
							{ width: "80%", maxHeight: "75%", anchor: "center", margin: 1 },
						),
				),
		},
	},
});
