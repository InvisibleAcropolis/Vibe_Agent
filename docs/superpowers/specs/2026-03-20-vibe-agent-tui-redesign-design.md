# Vibe Agent — TUI Redesign & Rebrand Design Spec

**Date:** 2026-03-20
**Status:** Approved
**Delivery:** Single PR covering all changes

---

## Context

The application was developed under the prototype name "future-ide-agent" and has accumulated placeholder branding, redundant UI elements, and minimal visual polish. This redesign:

1. **Rebrands** the product to its official name: **Vibe Agent**
2. **Replaces** the simple text logo with a proper ASCII art identity
3. **Redesigns** the header to show session context instead of redundant status info
4. **Adds** a Sessions browser panel as a persistent right-side column
5. **Removes** all help/placeholder text banners
6. **Extends** the animation system with 5 new visual effects
7. **Adds** a placeholder Extensions panel tab for future use

---

## Part 1: Rebrand

Replace all `future-ide-agent` and `FutureIDE` references with `vibe-agent` / `Vibe Agent`.

### Files to change

| File | Change |
|------|--------|
| `package.json` | `name`, `bin` key (`future-ide-agent` → `vibe-agent`), `scripts` refs |
| `bin/future-ide-agent.js` | Rename to `bin/vibe-agent.js` |
| `bin/future-ide-agent-debug.js` | Rename to `bin/vibe-agent-debug.js` |
| `src/main.ts` | `appName` string |
| `src/app.ts` | `configPath`, `appName`, `setTitle()` calls |
| `src/app-config.ts` | Config filename pattern (`future-ide-agent-config` → `vibe-agent-config`) |
| `src/app-debugger.ts` | `appName` references |
| `src/command-controller.ts` | `configPath` reference |
| `src/app-state-store.ts` | "Starting FutureIDE Agent…" string |
| `src/welcome-controller.ts` | All UI text and setup titles |
| `src/components/help-overlay.ts` | Help heading + config filename note |
| `src/shell-view.ts` | All logo/branding strings |
| `README.md` | Documentation |

---

## Part 2: Header & Logo

### Replaces
- `chromeHeader` — old single-line `╔══ ⬡ FutureIDE Agent · session [branch] ══╗`
- `chromeLogo` — old `╠══ ▀▀ FUTURE·IDE  ⬡  CONNECTED ● provider ══╣`
- `chromeHelp` — old `╠══ F1 palette · /setup /provider /model · /theme · Ctrl+Q ═╣` **(removed entirely)**
- `headerContentContainer` context banners (STATUS/CONNECTION boxes) **(removed entirely)**

### New header block

8-line bordered logo + info bar rendered in `shell-view.ts`:

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║  ██╗   ██╗██╗██████╗ ███████╗  █████╗  ██████╗ ███████╗███╗   ██╗████████╗  ║
║  ██║   ██║██║██╔══██╗██╔════╝ ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝  ║
║  ╚██╗ ██╔╝██║██████╔╝█████╗   ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║     ║
║   ╚████╔╝ ██║██╔══██╗██╔══╝   ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║     ║
║    ╚═══╝  ╚═╝╚═════╝ ███████╗ ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║     ║
║                       ╚══════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝  ╚═╝     ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Session: <name>  │  Thread: <thread>  │  CTX: <pct>% <bar>                  ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

**Critical:** The ANSI Shadow art must be rendered as full 6-line height. Lines 5–6 are:
- Line 5: V/I/B bottom connectors + E row 5 (`███████╗`) + AGENT row 5
- Line 6: E bottom connector (`╚══════╝`) + AGENT row 6 (`╚═╝  ╚═╝ ╚═════╝…`)

This ensures all letters (especially B) are fully visible and equal height.

### Info bar styling
- Labels (`Session:`, `Thread:`, `CTX:`) — `info` color (dim)
- Session name — `success` color
- Thread name — `accent` color
- CTX percentage — `warning` color when ≥ 70%, `success` when < 70%
- CTX bar — 8-char block bar using `█` (filled) and `░` (empty)
- Border color participates in existing hue-shift animation (see Part 5, effect D)

### Data sources
- Session name: `agentHost.state.sessionName ?? basename(cwd)`
- Thread name: current branch from existing git watcher in `footer-data-provider.ts`
- CTX %: `estimateContextTokens(messages).tokens / model.contextWindow * 100` — use `estimateContextTokens` (exported from `coding-agent/src/core/compaction/compaction.ts`, returns `ContextUsageEstimate { tokens, usageTokens, trailingTokens }`). `model.contextWindow` is available on `agentHost.state.model`.

---

## Part 3: Sessions Panel

### New file: `src/components/sessions-panel.ts`

Implements a `Component` using the existing `@mariozechner/pi-tui` component API.

### Layout integration (`src/shell-view.ts`)

The main layout splits horizontally:
```
╠══════════════════════════════════════════╦════════════════════════════════╣
║  CHAT AREA (fills remaining width)       ║  SESSIONS PANEL (30 cols)      ║
╠══════════════════════════════════════════╩════════════════════════════════╣
```

- Panel is **30 columns** wide (fixed)
- Chat area fills `terminalWidth - 30 - 3` (borders)
- Panel visibility toggled with **F3**; when hidden, chat takes full width

### Panel structure

```
┌─ SESSIONS ──────────── [S] [E] ─┐
│ ▼ Today                         │
│   ▶ my-project                  │  ← active session (accentStrong)
│     ├─ main                     │  ← active thread (accent)
│     ├─ refactor-branch          │
│     └─ experiment               │
│   ▶ auth-redesign               │
│     └─ main                     │
│ ▼ Yesterday                     │
│   ▶ api-planning                │
│ ▶ Last Week                     │
└─────────────────────────────────┘
```

### Tab bar
- `[S]` Sessions (default active)
- `[E]` Extensions — placeholder, renders: `"Extensions coming soon"` in dim text
- `Tab` or `Ctrl+E` cycles tabs

### Keyboard navigation (when panel focused)
| Key | Action |
|-----|--------|
| `↑` / `↓` | Move cursor |
| `→` / `←` | Expand / collapse group or session |
| `Enter` | Switch to selected session/thread; focus returns to editor automatically |
| `Esc` | Return focus to editor |
| `F3` | Toggle panel closed |

### Data source
Calls existing `agentHost.listSessions("all")` — no new data layer required. Groups results by date (today / yesterday / last week / older).

### Border animation
Panel border participates in the global hue-shift (same as the footer chrome — passes `animState` into render).

---

## Part 4: Remove Help Text

The following strings/components are **deleted entirely** — no replacement:

| Location | Text removed |
|----------|-------------|
| `src/shell-view.ts` | "Ready for your next task" context banner |
| `src/shell-view.ts` | "Type a prompt, press F1 for grouped commands…" body |
| `src/app.ts` (`refreshCockpitContext`) | "Ready for your first task" (first-session banner) |
| `src/app.ts` (`refreshCockpitContext`) | "Type a prompt, use F1 for the command palette…" |
| `src/shell-view.ts` | `chromeHelp` line (F1 palette / /setup / Ctrl+Q) |

Provider setup banners ("Connect a provider", "Choose a model") are **kept** — they are actionable warnings, not filler.

---

## Part 5: Animation Extensions

All animation state lives in `src/animation-engine.ts`. All rendering uses `src/ansi.ts` utilities.

### A — Selection Flash

**State added to `AnimationState`:**
```typescript
focusFlashTicks: number  // counts down from 3 on focus change, 0 = resting
focusedComponent: string // "editor" | "sessions" | "overlay"
```

**Behavior:** On focus change, `focusFlashTicks = 3`. During render, focused component border color = lerp(`borderActive`, `border`, `1 - focusFlashTicks/3`). Each tick decrements by 1.

### B — Block-fill Wipe

**State added to `AnimationState`:**
```typescript
wipeTransition: { active: boolean, frame: number }  // frame 0–3 active, ≥4 = done
```

**Behavior:** When `agentHost.switchSession()` fires, set `wipeTransition = { active: true, frame: 0 }`. Chat area renders overlay of wipe characters per frame:
- Frame 0: `░` fill
- Frame 1: `▒` fill
- Frame 2: `▓` fill
- Frame 3: `█` fill
- Frame ≥ 4: `active = false` — render nothing, show new content normally

Each frame lasts 1 tick (80ms). Total filled transition: 4 frames × 80ms = 320ms, then content appears.

### C — Separator Glyphs

**New 1-row components** inserted in `shell-view.ts`:
- Between header block and chat area
- Between chat area and editor

**Rendering:** `╌` repeated to fill width, colored with `border` from theme. Every 8 ticks, pattern offset increments by 1 (creates slow rightward crawl). Implemented in `ansi.ts` as `separatorLine(width, offset, theme)`.

### D — Full-chrome Hue Surge

**Extends existing behavior** in `shell-view.ts`:
- Currently only footer chrome (`chromeSummary`) uses animated border color
- Extend to: logo border, header info bar border, sessions panel border
- Implementation: pass `animState` into logo render function and sessions panel render, identical to how footer already receives it

### E — Typed Status Messages

**State added to `AnimationState`:**
```typescript
typewriter: { target: string, displayed: string, ticksSinceChar: number }
```

**Behavior:** When `appStateStore.setStatusMessage(msg)` is called:
1. Set `typewriter.target = msg`, `typewriter.displayed = ""`, `ticksSinceChar = 0`
2. Every 2 ticks: append one character from target to displayed
3. `chromeStatus` renders `typewriter.displayed` instead of raw `statusMessage`
4. When `displayed === target`: typewriter idles (no-op on ticks)

---

## Verification

1. **Run app:** `npm run dev` — confirm "Vibe Agent" appears in terminal title and logo renders correctly with equal-height VIBE/AGENT block letters
2. **Check sessions panel:** `F3` toggles it; tree expands/collapses; `Enter` on a session switches context
3. **Check animations:**
   - Focus editor then sessions panel — border flash visible
   - Switch sessions — wipe transition plays
   - Start agent task — full-chrome hue surge on all borders
   - Watch status bar — typewriter effect on new messages
   - Separator glyph lines visible between header/chat and chat/editor
4. **Check removals:** No "Ready for your first task" or "Type a prompt" text appears; no F1 help line in chrome
5. **Run tests:** `npm test` — existing test suite must pass (VirtualTerminal tests in `test/app.test.ts`)
6. **Config path:** Confirm config file is now named `vibe-agent-config.json` (check `src/app-config.ts`)
