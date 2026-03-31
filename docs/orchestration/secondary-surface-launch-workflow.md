# Secondary Surface Launch Workflow (PSMUX v1)

## Scope

This runbook captures the reproducible operator workflow for the v1 shell-next secondary-surface launch path.

- **Chosen v1 target:** sessions browser.
- **Primary route key:** `sessions-browser`.
- **Transport:** shell-next launch manager -> durable route signal -> PSMUX secondary pane reader.
- **Command compatibility:** legacy command/menu entry points remain intact while routing through shell-next surface-manager launches.

## Preconditions

1. Start the app through the standard launcher (`bin/vibe-agent.js`) so the runtime is inside a PSMUX session.
2. Confirm footer/runtime label includes `session/primary` in the main pane.
3. Ensure a secondary pane is present (created by launcher bootstrap).

## Operator flow

1. In primary pane, trigger sessions browser launch (`F2` in shell-next input map).
2. Shell-next dispatches `surface-launch` for `sessions-browser`.
3. `createSurfaceLaunchManager().launchSurface()` emits launch metadata (`reason: open` first, then `focus` for repeat launches).
4. Main app writes `tracker/secondary-surface-route-<session>.json` with action `open` or `focus`.
5. Secondary pane polls route signal and updates its status row to reflect active route.
6. Orchestration entry points (for example `/summon-orc`) can route through the same launch-manager path (`surfaceId: "orc-session"`) while preserving command UX.

## Close and reattach flow

1. Close the surface via `surfaceLaunchManager.closeSurface("sessions-browser")` (programmatic lifecycle close path).
2. Manager emits close callback and app writes signal action `close` for the same route.
3. Detach and reattach the same PSMUX session.
4. On shell rehydration, `rediscoverOpenSurfaces()` restores runtime subscriptions for already-open surfaces persisted in app transcript state.
5. Rediscovered surfaces emit launch metadata with `reason: attach`; route signals continue to map to `focus` action for backwards compatibility with existing consumers.
6. Secondary pane restarts, re-reads the latest route signal, and restores the last known state marker (`open`/`focus`/`close`) without requiring a fresh launch event.

## Diagnostics checkpoints

- Route signal file exists and updates on each launch/focus/close.
- `token` changes per action; `requestedAt` is ISO-8601 UTC.
- Main pane status message confirms launch routing/rediscovery in transcript/meta status semantics (`Launched`, `Refocused`, `Rediscovered`).
- Secondary pane status row reflects latest action for `sessions-browser`.
