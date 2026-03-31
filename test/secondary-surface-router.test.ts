import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import test from "node:test";
import {
	getSecondarySurfaceRouteSignalPath,
	readSecondarySurfaceRouteSignal,
	writeSecondarySurfaceRouteSignal,
} from "../src/shell-next/secondary-surface-router.js";

test("secondary surface route signal persists open/focus/close actions for a session", () => {
	const durableRoot = mkdtempSync(join(tmpdir(), "vibe-secondary-signal-"));
	const sessionName = "vibe_core";
	const path = getSecondarySurfaceRouteSignalPath(sessionName, { durableRoot });
	assert.match(path, /secondary-surface-route-vibe_core\.json$/);

	const openSignal = writeSecondarySurfaceRouteSignal({
		sessionName,
		surfaceId: "sessions-browser",
		route: "sessions-browser",
		action: "open",
		reason: "open",
		payload: { tab: "recent" },
	}, { durableRoot });
	assert.equal(openSignal.action, "open");

	const readOpen = readSecondarySurfaceRouteSignal(sessionName, { durableRoot });
	assert.equal(readOpen?.surfaceId, "sessions-browser");
	assert.equal(readOpen?.reason, "open");
	assert.deepEqual(readOpen?.payload, { tab: "recent" });

	const closeSignal = writeSecondarySurfaceRouteSignal({
		sessionName,
		surfaceId: "sessions-browser",
		route: "sessions-browser",
		action: "close",
	}, { durableRoot });
	assert.equal(closeSignal.action, "close");
	assert.notEqual(closeSignal.token, openSignal.token);

	const readClose = readSecondarySurfaceRouteSignal(sessionName, { durableRoot });
	assert.equal(readClose?.action, "close");
	assert.equal(readClose?.route, "sessions-browser");
});
