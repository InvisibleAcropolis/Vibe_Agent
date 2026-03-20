export type MouseAction = "down" | "up" | "drag" | "move" | "scroll";
export type MouseButton = "left" | "middle" | "right" | "release" | "wheelUp" | "wheelDown" | "unknown";

export interface MouseEvent {
	raw: string;
	action: MouseAction;
	button: MouseButton;
	row: number;
	col: number;
	shift: boolean;
	alt: boolean;
	ctrl: boolean;
}

export interface Rect {
	row: number;
	col: number;
	width: number;
	height: number;
}

const sgrMousePattern = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

export function parseMouseEvent(data: string): MouseEvent | null {
	const match = data.match(sgrMousePattern);
	if (!match) {
		return null;
	}

	const code = Number.parseInt(match[1], 10);
	const col = Number.parseInt(match[2], 10);
	const row = Number.parseInt(match[3], 10);
	const terminator = match[4];

	const shift = (code & 4) !== 0;
	const alt = (code & 8) !== 0;
	const ctrl = (code & 16) !== 0;
	const motion = (code & 32) !== 0;
	const wheel = (code & 64) !== 0;
	const buttonCode = code & 0b11;

	let action: MouseAction;
	let button: MouseButton;

	if (wheel) {
		action = "scroll";
		button = buttonCode === 0 ? "wheelUp" : buttonCode === 1 ? "wheelDown" : "unknown";
	} else if (motion) {
		action = buttonCode === 3 ? "move" : "drag";
		button =
			buttonCode === 0 ? "left" : buttonCode === 1 ? "middle" : buttonCode === 2 ? "right" : "release";
	} else if (terminator === "m") {
		action = "up";
		button = buttonCode === 0 ? "left" : buttonCode === 1 ? "middle" : buttonCode === 2 ? "right" : "release";
	} else {
		action = "down";
		button =
			buttonCode === 0 ? "left" : buttonCode === 1 ? "middle" : buttonCode === 2 ? "right" : "release";
	}

	return {
		raw: data,
		action,
		button,
		row,
		col,
		shift,
		alt,
		ctrl,
	};
}

export function isMouseSequence(data: string): boolean {
	return sgrMousePattern.test(data);
}

export function pointInRect(event: MouseEvent, rect: Rect): boolean {
	return (
		event.row >= rect.row &&
		event.row < rect.row + rect.height &&
		event.col >= rect.col &&
		event.col < rect.col + rect.width
	);
}
