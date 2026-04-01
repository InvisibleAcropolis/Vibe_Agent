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
		<text>
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
	onActivate: () => void;
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

	const handleMouse = (event: OpenTuiMouseEvent) => {
		if (event.type === "down") {
			props.onActivate();
		}
		event.preventDefault();
		event.stopPropagation();
		props.controller.handleMouse(toLegacyMouseEvent(event));
	};

	const interactionLayerZIndex = () => props.zIndex + 2;
	const contentWidth = () => Math.max(0, viewport().width);
	const contentHeight = () => Math.max(0, viewport().height);
	const interiorWidth = () => Math.max(0, rect().width - 2);
	const interiorHeight = () => Math.max(0, rect().height - 2);
	const bottomBandTop = () => Math.max(0, rect().height - 2);
	const bottomBandHeight = () => Math.min(2, rect().height);

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
				position="absolute"
				left={1}
				top={1}
				width={interiorWidth()}
				height={interiorHeight()}
				backgroundColor="transparent"
				zIndex={interactionLayerZIndex() - 1}
				onMouse={handleMouse}
			/>
			<box
				position="absolute"
				left={0}
				top={0}
				width={rect().width}
				height={1}
				backgroundColor="transparent"
				zIndex={interactionLayerZIndex()}
				onMouse={handleMouse}
			/>
			<box
				position="absolute"
				left={0}
				top={bottomBandTop()}
				width={rect().width}
				height={bottomBandHeight()}
				backgroundColor="transparent"
				zIndex={interactionLayerZIndex()}
				onMouse={handleMouse}
			/>
			<box
				position="absolute"
				left={0}
				top={0}
				width={1}
				height={rect().height}
				backgroundColor="transparent"
				zIndex={interactionLayerZIndex()}
				onMouse={handleMouse}
			/>
			<box
				position="absolute"
				left={rect().width - 1}
				top={0}
				width={1}
				height={rect().height}
				backgroundColor="transparent"
				zIndex={interactionLayerZIndex()}
				onMouse={handleMouse}
			/>
			<box
				flexDirection="column"
				width={contentWidth()}
				height={contentHeight()}
				backgroundColor="transparent"
			>
				<For each={rows()}>{(segments) => <RenderSegments segments={segments} />}</For>
			</box>
			<box width={contentWidth()}>
				<text>{`${"─".repeat(Math.max(0, viewport().width))}`}</text>
			</box>
			<box width={contentWidth()}>
				<text>{footer()}</text>
			</box>
		</box>
	);
}
