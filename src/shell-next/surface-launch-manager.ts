import type { AppStateStore } from "../app-state-store.js";
import type {
	ShellSurfaceDescriptor,
	ShellSurfaceRoutingDescriptor,
	ShellSurfaceSubscriptionDescriptor,
} from "./shared-models.js";

export interface SurfaceLaunchScope {
	readonly runtimeId?: string;
	readonly sessionId?: string;
}

export interface ShellSurfaceLaunchRequest {
	readonly surfaceId: string;
	readonly route: ShellSurfaceRoutingDescriptor["route"];
	readonly kind: ShellSurfaceDescriptor["kind"];
	readonly scope: SurfaceLaunchScope;
	readonly payload?: Record<string, unknown>;
	readonly reason: "open" | "focus";
}

export interface SurfaceLaunchManagerHooks {
	onLaunch: (request: ShellSurfaceLaunchRequest) => void;
	onClose?: (surfaceId: string) => void;
}

export interface SurfaceLaunchManager {
	registerSurface(descriptor: ShellSurfaceDescriptor): void;
	launchSurface(surfaceId: string, payload?: Record<string, unknown>): void;
	focusSurface(surfaceId: string): void;
	closeSurface(surfaceId: string): void;
	subscribe(listener: (surfaceIds: readonly string[]) => void): () => void;
	getOpenSurfaceIds(): readonly string[];
}

interface SurfaceRuntimeEntry {
	descriptor: ShellSurfaceDescriptor;
	unsubscribeHandlers: Array<() => void>;
}

export function createSurfaceLaunchManager(stateStore: AppStateStore, hooks: SurfaceLaunchManagerHooks): SurfaceLaunchManager {
	const descriptors = new Map<string, ShellSurfaceDescriptor>();
	const openSurfaces = new Map<string, SurfaceRuntimeEntry>();
	const listeners = new Set<(surfaceIds: readonly string[]) => void>();

	const notify = (): void => {
		const openSurfaceIds = [...openSurfaces.keys()];
		for (const listener of listeners) {
			listener(openSurfaceIds);
		}
	};

	const activateSubscriptions = (surfaceId: string, subscriptions?: readonly ShellSurfaceSubscriptionDescriptor[]): Array<() => void> => {
		if (!subscriptions || subscriptions.length === 0) {
			return [];
		}
		const unsubscribeHandlers: Array<() => void> = [];
		for (const subscription of subscriptions) {
			const unsubscribe = subscription.subscribe({ surfaceId });
			if (typeof unsubscribe === "function") {
				unsubscribeHandlers.push(unsubscribe);
			}
		}
		return unsubscribeHandlers;
	};

	const launch = (descriptor: ShellSurfaceDescriptor, reason: "open" | "focus", payload?: Record<string, unknown>): void => {
		hooks.onLaunch({
			surfaceId: descriptor.id,
			route: descriptor.routing.route,
			kind: descriptor.kind,
			scope: {
				runtimeId: descriptor.routing.scope.runtimeId ?? descriptor.runtimeId,
				sessionId: descriptor.routing.scope.sessionId ?? descriptor.sessionId,
			},
			payload: payload ?? descriptor.routing.initialPayload,
			reason,
		});
	};

	return {
		registerSurface(descriptor) {
			descriptors.set(descriptor.id, descriptor);
		},
		launchSurface(surfaceId, payload) {
			const descriptor = descriptors.get(surfaceId);
			if (!descriptor) {
				throw new Error(`Unknown shell surface: ${surfaceId}`);
			}
			const existing = openSurfaces.get(surfaceId);
			if (existing) {
				launch(descriptor, "focus", payload);
				descriptor.lifecycle?.onFocus?.({ surfaceId, route: descriptor.routing.route });
				return;
			}
			launch(descriptor, "open", payload);
			descriptor.lifecycle?.onOpen?.({ surfaceId, route: descriptor.routing.route });
			stateStore.launchSurface(surfaceId);
			const unsubscribeHandlers = activateSubscriptions(surfaceId, descriptor.subscriptions);
			openSurfaces.set(surfaceId, { descriptor, unsubscribeHandlers });
			notify();
		},
		focusSurface(surfaceId) {
			const entry = openSurfaces.get(surfaceId);
			if (!entry) {
				throw new Error(`Cannot focus unopened shell surface: ${surfaceId}`);
			}
			launch(entry.descriptor, "focus");
			entry.descriptor.lifecycle?.onFocus?.({ surfaceId, route: entry.descriptor.routing.route });
		},
		closeSurface(surfaceId) {
			const entry = openSurfaces.get(surfaceId);
			if (!entry) {
				return;
			}
			for (const unsubscribe of entry.unsubscribeHandlers) {
				unsubscribe();
			}
			entry.descriptor.lifecycle?.onClose?.({ surfaceId, route: entry.descriptor.routing.route });
			openSurfaces.delete(surfaceId);
			stateStore.closeLaunchedSurface(surfaceId);
			hooks.onClose?.(surfaceId);
			notify();
		},
		subscribe(listener) {
			listeners.add(listener);
			listener([...openSurfaces.keys()]);
			return () => listeners.delete(listener);
		},
		getOpenSurfaceIds() {
			return [...openSurfaces.keys()];
		},
	};
}
