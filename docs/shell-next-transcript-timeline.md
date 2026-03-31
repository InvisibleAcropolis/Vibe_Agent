# Shell Next Transcript Timeline (OpenTUI-style)

This document describes the new transcript timeline controller under `src/shell-next/transcript-timeline.ts`.

## What it provides

The controller is the stateful timeline primitive for the new shell. It is intentionally designed around an OpenTUI scrollbox mental model:

- `viewportSize`: number of visible rows.
- `scrollOffset`: top-most row index.
- `followMode`: whether the viewport is pinned to the newest entries.
- `isStreaming`: whether the runtime is actively appending transcript events.

## Follow mode behavior

### Sticky-bottom while streaming

When `isStreaming` is true and `followMode` is enabled, new timeline items append at the bottom and the viewport stays pinned to the tail.

### Automatic disengage on upward scroll

If the operator scrolls up (keyboard or mouse), follow mode automatically switches off. This preserves historical inspection and prevents the viewport from snapping to the tail while messages continue streaming.

### Re-engage follow mode

Follow mode returns when users scroll back to the tail or explicitly jump to bottom.

## Input handling

The action layer (`src/shell-next/actions.ts`) now exposes timeline-first helpers:

- `handleKeyboardScroll(..., "page-up" | "page-down" | "top" | "bottom")`
- `handleMouseScroll(..., "up" | "down", stride?)`

This isolates scroll semantics from future adapter/wiring code.

## Long history support

The controller clamps every offset transition against `maxOffset(totalItems, viewportSize)`, so long sessions remain stable without runaway offsets.

## Test coverage

`test/shell-next-transcript-timeline.test.ts` covers:

1. sticky-bottom follow while streaming;
2. disengage on upward keyboard scroll and no auto-jump while stream continues;
3. mouse-wheel scrolling in long history and follow re-engagement at tail.
