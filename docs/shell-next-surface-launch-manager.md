# Shell Next Surface Launch Manager

This document describes the shell-next surface launch contract and lifecycle ownership used by `ShellSurfaceDescriptor` and `createSurfaceLaunchManager()`.

## Why this exists

Secondary surfaces (sessions browser, RPC dashboards, event-bus-backed overlays) need a single launch path so shell-next can:

1. Route through typed descriptor metadata.
2. Carry runtime/session scope and initial route payload.
3. Enforce open/focus/close lifecycle behavior.
4. Attach and release transport subscriptions consistently.

## Descriptor contract

`ShellSurfaceDescriptor` now includes:

- `routing.route`: canonical route key consumed by shell launch routing.
- `routing.scope`: launch scope with optional `runtimeId` and `sessionId`.
- `routing.initialPayload`: default route payload when no explicit payload is supplied.
- `lifecycle`: optional `onOpen`, `onFocus`, `onClose` hooks.
- `subscriptions`: optional list of subscription descriptors for `rpc` or `event-bus` surface feeds.

## Manager behavior

`createSurfaceLaunchManager(stateStore, hooks)` centralizes launch flow:

- `registerSurface(descriptor)`: register launchable descriptor by id.
- `launchSurface(id, payload?)`:
  - opens if not active;
  - focuses if already open;
  - emits `onLaunch` with route, scope, payload, and reason;
  - invokes lifecycle hooks;
  - records launched surface id in `AppStateStore` transcript state;
  - starts subscription hooks for RPC/event bus listeners.
- `focusSurface(id)`: explicit focus of an open surface.
- `closeSurface(id)`:
  - runs all subscription unsubscriber handlers;
  - emits `onClose` lifecycle;
  - removes launched surface id from app state.

## Integration point

`createMainShellAdapter()` now routes shell-next `surface-launch` actions through the manager, making it the single launch path for new shell code.

