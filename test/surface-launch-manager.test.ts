import { strict as assert } from "node:assert";
import test from "node:test";
import { DefaultAppStateStore } from "../src/app-state-store.js";
import { createSurfaceLaunchManager, type ShellSurfaceLaunchRequest } from "../src/shell-next/surface-launch-manager.js";

test("launch manager opens surfaces with descriptor scope/payload, focuses reopen, and closes with unsubscribe", () => {
	const stateStore = new DefaultAppStateStore();
	const launches: ShellSurfaceLaunchRequest[] = [];
	let opened = 0;
	let focused = 0;
	let closed = 0;
	let unsubscribed = 0;
	let closedSurfaceId: string | undefined;

	const manager = createSurfaceLaunchManager(stateStore, {
		onLaunch: (request) => launches.push(request),
		onClose: (surfaceId) => {
			closedSurfaceId = surfaceId;
		},
	});
	manager.registerSurface({
		id: "rpc-log",
		title: "RPC Log",
		kind: "overlay",
		routing: {
			route: "rpc-log",
			scope: { runtimeId: "runtime-1", sessionId: "session-1" },
			initialPayload: { tab: "latest" },
		},
		lifecycle: {
			onOpen: () => opened++,
			onFocus: () => focused++,
			onClose: () => closed++,
		},
		subscriptions: [
			{
				source: "rpc",
				subscribe: () => () => {
					unsubscribed++;
				},
			},
		],
	});

	manager.launchSurface("rpc-log");
	assert.deepEqual(stateStore.getState().transcript.launchedSurfaceIds, ["rpc-log"]);
	assert.equal(opened, 1);
	assert.equal(launches[0]?.reason, "open");
	assert.equal(launches[0]?.scope.runtimeId, "runtime-1");
	assert.deepEqual(launches[0]?.payload, { tab: "latest" });

	manager.launchSurface("rpc-log", { tab: "errors" });
	assert.equal(focused, 1);
	assert.equal(launches[1]?.reason, "focus");
	assert.deepEqual(launches[1]?.payload, { tab: "errors" });

	manager.closeSurface("rpc-log");
	assert.deepEqual(stateStore.getState().transcript.launchedSurfaceIds, []);
	assert.equal(closed, 1);
	assert.equal(unsubscribed, 1);
	assert.equal(closedSurfaceId, "rpc-log");
});

test("launch manager rediscovers externally reattached surfaces from app state", () => {
	const stateStore = new DefaultAppStateStore();
	stateStore.launchSurface("sessions-browser");
	const launches: ShellSurfaceLaunchRequest[] = [];
	let focused = 0;
	const manager = createSurfaceLaunchManager(stateStore, {
		onLaunch: (request) => launches.push(request),
	});
	manager.registerSurface({
		id: "sessions-browser",
		title: "Sessions Browser",
		kind: "workspace",
		routing: {
			route: "sessions-browser",
			scope: {},
		},
		lifecycle: {
			onFocus: () => focused++,
		},
	});

	const restored = manager.rediscoverOpenSurfaces();
	assert.deepEqual(restored, ["sessions-browser"]);
	assert.deepEqual(manager.getOpenSurfaceIds(), ["sessions-browser"]);
	assert.equal(launches[0]?.reason, "attach");
	assert.equal(focused, 1);
});
