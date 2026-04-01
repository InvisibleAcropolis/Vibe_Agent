/** @jsxImportSource @opentui/solid */
import { PassThrough } from "node:stream";
import { RGBA, createCliRenderer, type MouseEvent as OpenTuiMouseEvent } from "@opentui/core";
import { render as renderSolid } from "@opentui/solid";
import type { MouseEvent } from "../src/mouse.js";
import { pointInRect } from "../src/mouse.js";
import { FloatingWindowOverlay } from "../src/shell-opentui/floating-window-overlay.js";
import { FloatingWindowController } from "../src/shell-opentui/floating-window-controller.js";

const FLOATING_MOUSE_SHIELD = RGBA.fromValues(0, 0, 0, 0.01);

function toLegacyMouseEvent(event: OpenTuiMouseEvent): MouseEvent {
	const isHeldDrag = event.type === "drag" || event.isDragging === true;
	const isRelease = event.type === "up" || event.type === "drag-end" || event.type === "drop";
	return {
		row: event.y + 1,
		col: event.x + 1,
		action:
			isRelease
				? "up"
				: isHeldDrag
					? "drag"
					: event.type === "scroll"
						? "scroll"
						: "down",
		button:
			event.type === "scroll"
				? event.scroll?.direction === "up"
					? "wheelUp"
					: "wheelDown"
				: event.button === 0
					? "left"
					: event.button === 1
						? "middle"
						: event.button === 2
							? "right"
							: "none",
		shift: event.modifiers.shift,
		alt: event.modifiers.alt,
		ctrl: event.modifiers.ctrl,
	};
}

const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
const renderer = await createCliRenderer({
	stdin,
	stdout,
	testing: true,
	useMouse: true,
	enableMouseMovement: true,
	autoFocus: true,
	exitOnCtrlC: false,
});

const controller = new FloatingWindowController({
	title: "Floating Window Test",
	description: "Empty floating window used to validate OpenTUI drag and resize behavior.",
	x: 10,
	y: 5,
	width: 48,
	height: 14,
	minWidth: 18,
	minHeight: 8,
});
controller.setTerminalViewport({ width: renderer.width, height: renderer.height });

const hostEvents: string[] = [];

const handleFloatingOverlayMouse = (event: OpenTuiMouseEvent) => {
	hostEvents.push(`${event.type}@${event.x + 1},${event.y + 1}`);
	event.preventDefault();
	event.stopPropagation();
	const translated = toLegacyMouseEvent(event);
	if (translated.action === "down" || controller.isPointerCaptureActive() || pointInRect(translated, controller.getOverlayRect())) {
		controller.handleMouse(translated);
	}
};

await renderSolid(() => (
	<box flexDirection="column" width="100%" height="100%" backgroundColor="#11161d">
		<box flexGrow={1} padding={1}>
			<scrollbox flexGrow={1} border borderStyle="rounded" title="Coding Chat" padding={1} scrollY>
				<text selectable>Background selectable transcript line one</text>
				<text selectable>Background selectable transcript line two</text>
				<text selectable>Background selectable transcript line three</text>
			</scrollbox>
		</box>
		<box
			position="absolute"
			left={0}
			top={0}
			width={renderer.width}
			height={renderer.height}
			backgroundColor={FLOATING_MOUSE_SHIELD}
			zIndex={54}
			onMouseDown={handleFloatingOverlayMouse}
			onMouseDrag={handleFloatingOverlayMouse}
			onMouseUp={handleFloatingOverlayMouse}
			onMouseDragEnd={handleFloatingOverlayMouse}
			onMouseDrop={handleFloatingOverlayMouse}
		>
			<FloatingWindowOverlay controller={controller} revision={0} zIndex={55} />
		</box>
	</box>
), renderer);

await new Promise<void>((resolve) => setTimeout(resolve, 25));

const rendererAny = renderer as unknown as {
	hitTest(x: number, y: number): number;
	processSingleMouseEvent(event: {
		type: "down" | "drag" | "up";
		button: number;
		x: number;
		y: number;
		modifiers: { shift: boolean; alt: boolean; ctrl: boolean };
	}): boolean;
};

const before = { ...controller.getOverlayRect() };
const startX = before.col + 6 - 1;
const startY = before.row + 2 - 1;
const dragX = startX + 8;
const dragY = startY + 4;
const hitBefore = rendererAny.hitTest(startX, startY);

rendererAny.processSingleMouseEvent({
	type: "down",
	button: 0,
	x: startX,
	y: startY,
	modifiers: { shift: false, alt: false, ctrl: false },
});
rendererAny.processSingleMouseEvent({
	type: "drag",
	button: 0,
	x: dragX,
	y: dragY,
	modifiers: { shift: false, alt: false, ctrl: false },
});
rendererAny.processSingleMouseEvent({
	type: "up",
	button: 0,
	x: dragX,
	y: dragY,
	modifiers: { shift: false, alt: false, ctrl: false },
});

const after = { ...controller.getOverlayRect() };

process.stderr.write(`${JSON.stringify({
	hitBefore,
	before,
	after,
	hostEvents,
	moved: before.row !== after.row || before.col !== after.col,
})}\n`);

renderer.destroy();
