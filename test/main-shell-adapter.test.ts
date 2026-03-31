import { strict as assert } from "node:assert";
import test from "node:test";
import { DefaultAppStateStore } from "../src/app-state-store.js";
import { createMainShellAdapter } from "../src/shell/main-shell-adapter.js";
import type { ShellSurfaceLaunchRequest } from "../src/shell-next/surface-launch-manager.js";

const baseOptions = {
	getHostState: () => undefined,
	getMessages: () => [],
	getAgentHost: () => undefined,
};

test("legacy adapter routes surface-launch entry points through the launch manager and preserves overlay actions", () => {
	const stateStore = new DefaultAppStateStore();
	stateStore.launchSurface("sessions-browser");
	const launches: ShellSurfaceLaunchRequest[] = [];
	const overlays: string[] = [];

	const adapter = createMainShellAdapter({
		implementation: "legacy",
		stateStore,
		...baseOptions,
		onSurfaceLaunch: (request) => launches.push(request),
		onOverlayOpen: (target) => overlays.push(target),
	});

	assert.equal(launches[0]?.surfaceId, "sessions-browser");
	assert.equal(launches[0]?.reason, "attach");

	adapter.dispatchShellAction({ type: "surface-launch", target: "sessions-browser" });
	assert.equal(launches[1]?.reason, "focus");

	adapter.dispatchShellAction({ type: "overlay-open", target: "orchestration" });
	assert.deepEqual(overlays, ["orchestration"]);
});

test("next adapter keeps command rediscovery semantics: first launch opens and subsequent launches focus", () => {
	const launches: ShellSurfaceLaunchRequest[] = [];
	const adapter = createMainShellAdapter({
		implementation: "next",
		stateStore: new DefaultAppStateStore(),
		...baseOptions,
		onSurfaceLaunch: (request) => launches.push(request),
	});

	adapter.dispatchShellAction({ type: "surface-launch", target: "orc-session" });
	adapter.dispatchShellAction({ type: "surface-launch", target: "orc-session" });

	assert.equal(launches[0]?.reason, "open");
	assert.equal(launches[1]?.reason, "focus");
});
