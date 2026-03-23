import assert from "node:assert";
import { describe, it } from "node:test";
import { MasterTuiApp } from "../src/master-tui-app.js";
import { VirtualTerminal } from "../../test/helpers/virtual-terminal.js";

async function flush(terminal: VirtualTerminal): Promise<string[]> {
	await new Promise<void>((resolve) => process.nextTick(resolve));
	return await terminal.flushAndGetViewport();
}

describe("MasterTuiApp", () => {
	it("boots with the workspace panel rendered", async () => {
		const terminal = new VirtualTerminal(100, 32);
		const app = new MasterTuiApp({ terminal });
		app.start();
		const viewport = await flush(terminal);
		assert.ok(viewport.some((line) => line.includes("FutureIDE MasterTUI")));
		assert.ok(viewport.some((line) => line.includes("Workspace")));
		app.stop();
	});

	it("registers and activates the default panel", () => {
		const app = new MasterTuiApp({ terminal: new VirtualTerminal(90, 28) });
		assert.equal(app.panelManager.listDefinitions().length, 1);
		assert.equal(app.getActivePanelId(), "workspace");
	});

	it("opens and filters command palette actions", async () => {
		const terminal = new VirtualTerminal(100, 32);
		const app = new MasterTuiApp({ terminal });
		app.start();
		terminal.sendInput("\x10");
		await flush(terminal);
		assert.deepStrictEqual(app.getOverlayIds(), ["command-palette"]);
		for (const ch of "help") {
			terminal.sendInput(ch);
			await flush(terminal);
		}
		const rect = app.getOverlayRect("command-palette");
		assert.ok(rect);
		assert.ok(rect!.width > 0 && rect!.height > 0);
		app.stop();
	});

	it("stacks overlays and dismisses them in order", async () => {
		const terminal = new VirtualTerminal(100, 32);
		const app = new MasterTuiApp({ terminal });
		app.start();
		terminal.sendInput("\x10");
		await flush(terminal);
		terminal.sendInput("\x1bOP");
		await flush(terminal);
		assert.deepStrictEqual(app.getOverlayIds(), ["command-palette", "help"]);
		terminal.sendInput("\x1b");
		await flush(terminal);
		assert.deepStrictEqual(app.getOverlayIds(), ["command-palette"]);
		terminal.sendInput("\x1b");
		await flush(terminal);
		assert.deepStrictEqual(app.getOverlayIds(), []);
		app.stop();
	});

	it("keeps layout stable through resize and shows image fallback text", async () => {
		const terminal = new VirtualTerminal(90, 24);
		const app = new MasterTuiApp({ terminal });
		app.start();
		let viewport = await flush(terminal);
		assert.ok(viewport.some((line) => line.includes("[Image: future-ide-demo.png [image/png] 1x1]")));
		terminal.resize(80, 20);
		viewport = await flush(terminal);
		assert.equal(app.getActivePanelId(), "workspace");
		assert.ok(viewport.some((line) => line.includes("FutureIDE MasterTUI")));
		app.stop();
	});


	it("keeps overlay anchor geometry deterministic across terminal resize", async () => {
		const terminal = new VirtualTerminal(100, 32);
		const app = new MasterTuiApp({ terminal });
		app.openHelpOverlay();
		await flush(terminal);
		assert.deepStrictEqual(app.getOverlayRect("help"), { row: 6, col: 16, width: 70, height: 22 });
		terminal.resize(80, 24);
		await flush(terminal);
		assert.deepStrictEqual(app.getOverlayRect("help"), { row: 5, col: 13, width: 56, height: 16 });
		app.stop();
	});

	it("routes mouse wheel to the workspace scroll region", async () => {
		const terminal = new VirtualTerminal(90, 24);
		const app = new MasterTuiApp({ terminal });
		app.start();
		await flush(terminal);
		const before = app.getStatus();
		terminal.sendInput("\x1b[<65;10;6M");
		await flush(terminal);
		assert.equal(app.getActivePanelId(), "workspace");
		assert.equal(app.getStatus(), before);
		app.stop();
	});

	it("clicks through non-matching top overlays to lower overlapping overlays", async () => {
		const terminal = new VirtualTerminal(100, 32);
		const app = new MasterTuiApp({ terminal });
		app.start();
		terminal.sendInput("\x10");
		await flush(terminal);
		terminal.sendInput("\x1bOP");
		await flush(terminal);
		const commandRect = app.getOverlayRect("command-palette");
		const helpRect = app.getOverlayRect("help");
		assert.ok(commandRect);
		assert.ok(helpRect);
		assert.ok(commandRect!.row !== helpRect!.row || commandRect!.col !== helpRect!.col);
		terminal.sendInput(`\x1b[<0;${commandRect!.col + 4};${commandRect!.row + 3}M`);
		await flush(terminal);
		assert.equal(app.getOverlayIds().includes("help"), true);
		app.stop();
	});

	it("stops cleanly from the global quit shortcut", async () => {
		const terminal = new VirtualTerminal(90, 24);
		const app = new MasterTuiApp({ terminal });
		app.start();
		terminal.sendInput("\x11");
		await flush(terminal);
		assert.equal(app.isRunning(), false);
	});
});
