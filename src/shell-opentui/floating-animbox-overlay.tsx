/** @jsxImportSource @opentui/solid */
import { type MouseEvent as OpenTuiMouseEvent, vstyles } from "@opentui/core";
import { For, Match, Switch } from "solid-js";
import type { FloatingAnimboxController, FloatingAnimboxTextSegment } from "./floating-animbox-controller.js";
import type { MouseEvent } from "../mouse.js";

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
					: event.type === "move" || event.type === "over" || event.type === "out"
						? "move"
					: event.type === "scroll"
						? "scroll"
						: "down",
		button:
			event.type === "scroll"
				? event.scroll?.direction === "up"
					? "wheelUp"
					: "wheelDown"
				: !isHeldDrag && !isRelease && event.type !== "down"
					? "none"
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

function RenderSegments(props: { segments: FloatingAnimboxTextSegment[] }) {
	return (
		<text selectable={false}>
			<For each={props.segments}>
				{(segment) => (
					<Switch fallback={segment.text}>
						<Match when={segment.fg}>
							{vstyles.fg(segment.fg!, segment.text)}
						</Match>
					</Switch>
				)}
			</For>
		</text>
	);
}

export function FloatingAnimboxOverlay(props: {
	controller: FloatingAnimboxController;
	revision: number;
	zIndex: number;
}) {
	const rect = () => {
		void props.revision;
		return props.controller.getOverlayRect();
	};
	const viewport = () => {
		void props.revision;
		return props.controller.getContentViewport();
	};
	const rows = () => {
		void props.revision;
		return props.controller.getContentRows();
	};
	const footer = () => {
		void props.revision;
		return props.controller.getFooterText();
	};
	const borderColor = () => {
		void props.revision;
		return props.controller.model.active ? "#7fd7ff" : "#3b566c";
	};
	const backgroundColor = () => {
		void props.revision;
		return props.controller.model.active ? "#0d1823" : "#0b1118";
	};

	const contentWidth = () => Math.max(0, viewport().width);
	const contentHeight = () => Math.max(0, viewport().height);

	return (
		<box
			position="absolute"
			left={rect().col - 1}
			top={rect().row - 1}
			width={rect().width}
			height={rect().height}
			border
			borderStyle="rounded"
			borderColor={borderColor()}
			title={props.controller.getTitle()}
			flexDirection="column"
			backgroundColor={backgroundColor()}
			zIndex={props.zIndex}
		>
			<box
				flexDirection="column"
				width={contentWidth()}
				height={contentHeight()}
				backgroundColor="transparent"
			>
				<For each={rows()}>{(segments) => <RenderSegments segments={segments} />}</For>
			</box>
			<box width={contentWidth()}>
				<text selectable={false}>{`${"─".repeat(Math.max(0, viewport().width))}`}</text>
			</box>
			<box width={contentWidth()}>
				<text selectable={false}>{footer()}</text>
			</box>
		</box>
	);
}
