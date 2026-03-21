import assert from "node:assert";
import { TUIStyleTestApp } from "../tools/TUIstyletest/app.js";
import { VirtualTerminal } from "./helpers/virtual-terminal.js";

async function flush(terminal: VirtualTerminal): Promise<string[]> {
	await new Promise<void>((resolve) => setImmediate(resolve));
	await new Promise<void>((resolve) => setImmediate(resolve));
	return await terminal.flushAndGetViewport();
}

async function main(): Promise<void> {
	const terminal = new VirtualTerminal(130, 40);
	const app = new TUIStyleTestApp({ terminal });
	app.start();

	try {
		let viewport = (await flush(terminal)).join("\n");
		assert.match(viewport, /TUIstyletest/);
		assert.match(viewport, /Base Glyph Cascade/);

		app.selectDemo("style-primitives");
		viewport = (await flush(terminal)).join("\n");
		assert.match(viewport, /Style Primitives/);
		assert.match(viewport, /Demo Surface/);

		app.selectDemo("menu-bar");
		app.updateControlValue("labelA", "Chrome");
		viewport = (await flush(terminal)).join("\n");
		assert.match(viewport, /Chrome/);

		app.selectDemo("sessions-panel");
		viewport = (await flush(terminal)).join("\n");
		assert.match(viewport, /SESSIONS/);

		app.selectDemo("overlay-help");
		app.openCurrentOverlay();
		viewport = (await flush(terminal)).join("\n");
		assert.match(viewport, /Vibe Agent - Help/);
		terminal.sendInput("\u001b");
		viewport = (await flush(terminal)).join("\n");
		assert.doesNotMatch(viewport, /Vibe Agent - Help/);

		app.selectDemo("base-orbit-arc");
		const firstFrame = (await flush(terminal)).join("\n");
		await new Promise((resolve) => setTimeout(resolve, 160));
		const secondFrame = (await flush(terminal)).join("\n");
		assert.notStrictEqual(firstFrame, secondFrame);
	} finally {
		app.stop();
	}
}

void main();
