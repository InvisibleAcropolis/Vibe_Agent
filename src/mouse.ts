export interface MouseEvent {
	row: number;
	col: number;
	action: "down" | "up" | "drag" | "move" | "scroll";
	button: "left" | "middle" | "right" | "wheelUp" | "wheelDown" | "none";
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

const SGR_MOUSE_REGEX = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

export function parseMouseEvent(data: string): MouseEvent | null {
	const match = SGR_MOUSE_REGEX.exec(data);
	if (!match) {
		return null;
	}
	const code = Number.parseInt(match[1], 10);
	const col = Number.parseInt(match[2], 10);
	const row = Number.parseInt(match[3], 10);
	const release = match[4] === "m";

	const shift = !!(code & 4);
	const alt = !!(code & 8);
	const ctrl = !!(code & 16);

	const buttonBits = code & 3;
	const motion = !!(code & 32);
	const isWheel = !!(code & 64);

	if (isWheel) {
		return {
			row,
			col,
			action: "scroll",
			button: buttonBits === 0 ? "wheelUp" : "wheelDown",
			shift,
			alt,
			ctrl,
		};
	}

	const button = buttonBits === 0 ? "left" : buttonBits === 1 ? "middle" : buttonBits === 2 ? "right" : "none";
	const action = release ? "up" : motion ? "drag" : "down";

	return { row, col, action, button, shift, alt, ctrl };
}

export function pointInRect(event: MouseEvent, rect: Rect): boolean {
	return event.row >= rect.row && event.row < rect.row + rect.height && event.col >= rect.col && event.col < rect.col + rect.width;
}
