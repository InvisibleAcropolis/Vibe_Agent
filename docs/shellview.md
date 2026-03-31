# Shell View & Shell-Next Architecture Guide

This document is the current shell architecture reference for engineers onboarding to the shell migration work.

- **Legacy shell runtime:** `src/shell-view.ts` + `src/shell/**`
- **Shell-next runtime:** `src/shell-next/**`
- **Adapter seam:** `src/shell/main-shell-adapter.ts`

The rest of the app should continue to talk to the `ShellView` abstraction and `MainShellAdapter`, while shell-next owns transcript-first behavior, launch contracts, and modernized secondary surface routing.

---

## 1) Component boundaries and ownership

## 1.1 Main entrypoint boundary (`createMainShellAdapter`)

`createMainShellAdapter()` is the migration seam and defines which implementation is active (`"legacy"` or `"next"`).

Responsibilities:

1. Create the selected shell implementation.
2. Normalize shell input actions (`scroll`, `follow-toggle`, `prompt-focus`, `overlay-open`, `surface-launch`).
3. Forward surface-launch actions to shell-next `SurfaceLaunchManager` when in next mode.

Practical rule: **application code should dispatch `ShellInputAction` through the adapter and avoid calling legacy layout methods directly.**

## 1.2 Legacy shell boundary (stable but maintenance mode)

The legacy stack (`DefaultShellView`, shell chrome renderer, extension chrome, tray logic) still owns:

- current production row-based frame rendering,
- extension header/footer/widget placement,
- sessions split-pane behavior.

It remains supported during migration but is no longer the source of truth for new transcript behavior and secondary-surface launch semantics.

## 1.3 Shell-next boundary (source of truth for new behavior)

Shell-next modules split responsibilities as follows:

- `controller.ts`: constructs state/actions/renderer/chrome/timeline/surface launch manager.
- `actions.ts`: timeline-first input semantics for keyboard and mouse scrolling.
- `transcript-timeline.ts`: transcript viewport state, follow mode, and per-part expansion behavior.
- `surface-launch-manager.ts`: typed launch/focus/close lifecycle and subscription ownership.
- `shared-models.ts`: canonical contracts for transcript items/parts/actions and launch descriptors.

---

## 2) Transcript model contracts

Canonical model types live in `src/shell-next/shared-models.ts`.

## 2.1 `TranscriptItem` contract

A transcript entry is a discriminated union with stable `id`, `timestamp`, `summary`, and `parts`:

- `user`
- `assistant-text`
- `assistant-thinking`
- `tool-call`
- `tool-result`
- `artifact`
- `runtime-status`
- `subagent-event`
- `checkpoint`
- `error`

Required invariants:

1. `id` must be stable across rerenders so expansion, selection, and jump targets remain valid.
2. `summary` must always be present and renderable as a timeline row.
3. `parts` may include collapsible subcontent keyed by stable `part.id`.

## 2.2 `TranscriptPart` contract

Supported part kinds:

- `summary`, `text`, `thinking`, `detail`, `status`, `artifact-link`, `metadata`

Current collapsible behavior in timeline controller:

- `thinking` parts are collapsible.
- `detail` parts are collapsible only for `tool-result` items.

Expansion key format is internal but stable within session state: `"<itemId>::<partId>"`.

## 2.3 Transcript action hooks

`TranscriptAction` and `TranscriptActionHooks` provide typed action affordances for:

- expand
- collapse
- open-overlay
- open-surface

These hooks let renderers and adapters stay model-driven instead of coupling to legacy row geometry.

---

## 3) Follow mode and expansion state behavior

Primary implementation: `src/shell-next/transcript-timeline.ts`.

## 3.1 Follow mode contract

State fields:

- `followMode`: whether viewport should stay at tail.
- `isStreaming`: whether stream append behavior is active.

Behavior:

1. While `isStreaming && followMode`, appended items pin viewport to bottom.
2. Keyboard/mouse upward scroll disengages follow mode.
3. `scrollToBottom()` re-enables follow mode.
4. Offsets are clamped via `maxOffset(total, viewport)` for long-history stability.

## 3.2 Expansion state contract

Timeline expansion is maintained in `partExpansion: Record<string, boolean>` and toggled by `togglePartExpansion(itemId, partId)`.

Anchor preservation behavior:

- The controller captures the top visible row id before toggling.
- After expansion change, it restores scroll to that row when possible.
- This avoids jumpy viewport movement during expand/collapse operations.

## 3.3 App-state compatibility surface

`AppStateStore` keeps migration-compatible transcript behavior in `state.transcript`:

- `followMode`
- `expansionState`
- `selectedTranscriptItemId`
- `launchedSurfaceIds`

Legacy mirrors (`toolOutputExpanded`, `hideThinking`) remain for compatibility but should not be used as primary model state in new shell logic.

---

## 4) Extension mapping behavior (legacy API -> shell-next destinations)

During migration, extension APIs are preserved while their render destination can change by shell implementation.

Mapping guidance:

- `setStatus(...)` -> shell-next compact status/meta row fields.
- `setWidget(...)` -> transcript-adjacent cards or prompt-adjacent blocks (instead of fixed legacy row slots where possible).
- `setHeader(...)` / `setFooter(...)` -> compact chrome or surface-specific contextual blocks.
- `custom` / complex workflows -> launchable overlay/surface flows via typed actions and descriptors.

Engineering rule:

1. Preserve extension intent (status, control, detail, launch).
2. Prefer transcript-first or surface-first placement over adding new fixed rows.
3. Keep behavior parity in adapter/action layer, not by exposing legacy container internals.

---

## 5) `ShellSurfaceDescriptor` launch contract

Primary contracts:

- `src/shell-next/shared-models.ts` (`ShellSurfaceDescriptor`)
- `src/shell-next/surface-launch-manager.ts` (`createSurfaceLaunchManager`)

## 5.1 Descriptor fields

`ShellSurfaceDescriptor` requires:

- `id`, `title`, `kind` (`overlay` | `panel` | `workspace`)
- `routing`:
  - `route` (canonical route key)
  - `scope` (`runtimeId?`, `sessionId?`)
  - `initialPayload?`
- optional `lifecycle` hooks: `onOpen`, `onFocus`, `onClose`
- optional `subscriptions` for `rpc` / `event-bus` feeds

## 5.2 Launch manager semantics

`launchSurface(surfaceId, payload?)`:

- unknown `surfaceId` => throws `Unknown shell surface`.
- unopened surface => emits launch `reason: "open"`, runs `onOpen`, persists launched id to app state, activates subscriptions.
- already-open surface => emits launch `reason: "focus"`, runs `onFocus`, does not duplicate persisted ids.

`focusSurface(surfaceId)`:

- unopened `surfaceId` => throws `Cannot focus unopened shell surface`.
- open surface => emits launch with `reason: "focus"`, runs `onFocus`.

`closeSurface(surfaceId)`:

- if open: runs subscription unsubs, runs `onClose`, removes persisted launched id, emits optional close hook.
- if not open: no-op.

`rediscoverOpenSurfaces()`:

- restores subscriptions for ids in `state.transcript.launchedSurfaceIds`.
- emits launch with `reason: "attach"`.
- calls lifecycle `onFocus` so reattached panes rehydrate active UI.

## 5.3 PSMUX v1 routing behavior

For sessions browser launches, shell-next writes a durable route signal under tracker artifacts so detached/reattached secondary panes can recover route state (`open` / `focus` / `close`) without requiring a fresh operator action.

---

## 6) Troubleshooting guide

## 6.1 Follow mode issues

**Symptom:** transcript stops auto-following during stream.

Checks:

1. Confirm `followMode` is still true (up-scroll disables it intentionally).
2. Confirm `isStreaming` is true while stream events append.
3. Verify caller uses `appendItems(...)` and not full replacement that resets expected flow.

Recovery:

- invoke `scrollToBottom()` (or equivalent end-key path) to re-enable follow mode.

## 6.2 Expansion state issues

**Symptom:** thinking/tool sections collapse unexpectedly or jump scroll.

Checks:

1. Verify `item.id` and `part.id` are stable between refreshes.
2. Ensure collapsible kinds are correctly emitted (`thinking`, or `tool-result` + `detail`).
3. Confirm expansion writes use per-part keys (not a global toggle only).

Recovery:

- regenerate normalized transcript with stable ids.
- avoid replacing items with new ids unless a true history reset is intended.

## 6.3 Surface-launch failure handling

**Symptom:** `surface-launch` action does nothing or throws.

Checks:

1. Confirm descriptor was registered via `registerSurface(...)` before launch.
2. Validate route/scope fields in descriptor routing payload.
3. Verify subscription handlers do not throw during activation.
4. If using PSMUX secondary pane, validate route signal writer/reader paths and session names.

Failure handling recommendations:

- Catch manager errors at the action boundary and surface a clear operator status message with failing surface id.
- On subscription failure during open, close partial state and report failure rather than leaving a half-open surface.
- Preserve idempotent close behavior (`closeSurface` remains safe as recovery cleanup).

---

## 7) Test references

Current targeted tests for transcript behavior are in `test/shell-next-transcript-timeline.test.ts` and validate:

1. sticky-bottom follow while streaming;
2. follow disengage on upward scroll;
3. mouse-wheel behavior and follow re-engagement at tail.

For surface launch behavior, add or maintain manager-focused tests around:

- unknown surface failures,
- open/focus lifecycle ordering,
- subscription cleanup on close,
- attach semantics via rediscovery.
