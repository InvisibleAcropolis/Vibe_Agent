/** @jsxImportSource @opentui/solid */
import type { FloatingWindowController } from "./floating-window-controller.js";

export function FloatingWindowOverlay(props: {
	controller: FloatingWindowController;
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
	const borderColor = () => {
		void props.revision;
		return props.controller.model.active ? "#7fd7ff" : "#3b566c";
	};
	const backgroundColor = () => {
		void props.revision;
		return props.controller.model.active ? "#101922" : "#0c1117";
	};
	const footer = () => {
		void props.revision;
		return props.controller.getFooterText();
	};

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
				width={viewport().width}
				height={viewport().height}
				backgroundColor={backgroundColor()}
				paddingX={1}
				paddingY={0}
			>
				<box flexGrow={1} justifyContent="center" alignItems="center" flexDirection="column">
					<text selectable={false}>Empty floating window</text>
					<text selectable={false}>{props.controller.getDescription()}</text>
				</box>
				<box>
					<text selectable={false}>{footer()}</text>
				</box>
			</box>
		</box>
	);
}
