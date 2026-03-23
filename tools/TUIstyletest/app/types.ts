import type { Component } from "@mariozechner/pi-tui";
import type { MouseEvent, Rect } from "../../../src/mouse.js";

export type FocusPane = "browser" | "preview" | "controls";

export type PanelListRow = { kind: "group"; label: string } | { kind: "demo"; id: string; title: string; sourceFile: string; kindLabel: string };
export type ActionRow = { id: string; label: string; type: "action" };

export interface MouseAwareComponent extends Component {
	handleMouse?(event: MouseEvent, rect: Rect): boolean;
}
