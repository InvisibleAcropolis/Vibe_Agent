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

## V1 target selection and PSMUX route contract

For the first production launch path, shell-next targets the **sessions browser** (`route: "sessions-browser"`).  
The main shell writes a durable route signal when this surface is opened/focused/closed under PSMUX:

- Signal file: `tracker/secondary-surface-route-<session>.json`
- Writer: `writeSecondarySurfaceRouteSignal()` in `src/shell-next/secondary-surface-router.ts`
- Reader: `readSecondarySurfaceRouteSignal()` in secondary pane host (`src/splash-pane-app.ts`)

Signal payload contract:

- `sessionName`: owning PSMUX session.
- `surfaceId`: shell descriptor id.
- `route`: canonical route key.
- `action`: `open` | `focus` | `close`.
- `reason`: launch reason (`open`/`focus`) when relevant.
- `payload`: optional launch payload.
- `requestedAt`, `token`: monotonic operator/audit markers for replay-safe polling.

This keeps routing ownership in shell-next while allowing a detached/reattached secondary pane to recover the most recent launch state.
