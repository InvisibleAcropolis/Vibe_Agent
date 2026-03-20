# Vibe Agent TUI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the app from "future-ide-agent" to "Vibe Agent" and deliver a complete TUI visual upgrade: ANSI Shadow logo, new header, persistent Sessions tree panel, removal of all help text banners, and 5 animation effects.

**Architecture:** Single PR touching ~15 files. All new UI state lives in `AnimationState` (animation-engine.ts). The sessions panel is a new Component rendered side-by-side with the chat area via a new `SideBySideContainer`. The logo/header block replaces the existing 3-line chrome header in `shell-view.ts`.

**Tech Stack:** TypeScript, Node.js ESM, `@mariozechner/pi-tui` (Component/Container/Text/TUI), `@mariozechner/pi-agent-core` (AgentMessage), custom ANSI styling via `src/ansi.ts`.

**Spec:** `docs/superpowers/specs/2026-03-20-vibe-agent-tui-redesign-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/components/sessions-panel.ts` | Tree-view sessions browser, tab bar (Sessions/Extensions), keyboard nav |
| Create | `src/components/side-by-side-container.ts` | Horizontal layout: left Component + right Component, joined line-by-line |
| Modify | `src/animation-engine.ts` | Add `focusFlashTicks`, `wipeTransition`, `separatorOffset`, `typewriter` state |
| Modify | `src/ansi.ts` | Add `separatorLine(width, offset, theme)` utility |
| Modify | `src/shell-view.ts` | New 10-line logo header, remove headerContentContainer, add sessions panel wiring, separator rows |
| Modify | `src/app-state-store.ts` | Rename startup message; hook `setStatusMessage` to feed typewriter |
| Rename | `bin/future-ide-agent.js` → `bin/vibe-agent.js` | Entry point |
| Rename | `bin/future-ide-agent-debug.js` → `bin/vibe-agent-debug.js` | Debug entry point |
| Modify | `package.json` | Bin name, scripts, package name |
| Modify | `src/main.ts` | appName string |
| Modify | `src/app.ts` | Class name, configPath, setTitle, remove "Ready for your first task" banner |
| Modify | `src/app-config.ts` | Config filename pattern |
| Modify | `src/app-debugger.ts` | appName |
| Modify | `src/command-controller.ts` | configPath |
| Modify | `src/welcome-controller.ts` | UI text, setup titles |
| Modify | `src/components/help-overlay.ts` | Heading, config filename note |
| Modify | `src/types.ts` | Rename `FutureIdeAgentAppOptions` → `VibeAgentAppOptions` |
| Modify | `test/app.test.ts` | Update `FutureIdeAgentApp` import/reference to `VibeAgentApp` |
| Modify | `README.md` | Update branding throughout |

---

## Task 1: Rebrand — String & File Changes

**Files:**
- Modify: `package.json`
- Rename+Modify: `bin/future-ide-agent.js` → `bin/vibe-agent.js`
- Rename+Modify: `bin/future-ide-agent-debug.js` → `bin/vibe-agent-debug.js`
- Modify: `src/main.ts`
- Modify: `src/app.ts`
- Modify: `src/app-config.ts`
- Modify: `src/app-debugger.ts`
- Modify: `src/command-controller.ts`
- Modify: `src/app-state-store.ts`
- Modify: `src/welcome-controller.ts`
- Modify: `src/components/help-overlay.ts`
- Modify: `src/types.ts`
- Modify: `test/app.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write a test that verifies the app title contains "Vibe Agent"**

In `test/app.test.ts`, find the `FakeHost` class (line ~45) and any test that checks rendered output. Add:

```typescript
// Near the top of app.test.ts, update the import:
import { VibeAgentApp } from "../src/app.js";
// (was: FutureIdeAgentApp)

// Add this test after existing tests:
test("app title is Vibe Agent", async () => {
  const terminal = new VirtualTerminal(120, 40);
  const app = new VibeAgentApp({ terminal: terminal.terminal });
  const lines = await flush(terminal);
  assert.ok(lines.some(l => l.includes("Vibe Agent")), `Expected 'Vibe Agent' in output, got:\n${lines.join("\n")}`);
  app.stop();
});
```

- [ ] **Step 2: Run test to confirm it fails (VibeAgentApp doesn't exist yet)**

```bash
npm test
```

Expected: compilation error or `VibeAgentApp is not exported`

- [ ] **Step 3: Rename `package.json` fields**

In `package.json`, change:
- `"name": "@futureide/agent"` → `"name": "@vibeagent/agent"`
- `"bin": { "future-ide-agent": "./bin/future-ide-agent.js" }` → `"bin": { "vibe-agent": "./bin/vibe-agent.js" }`
- `"dev": "node ./bin/future-ide-agent.js"` → `"dev": "node ./bin/vibe-agent.js"`
- `"dev:debug": "node ./bin/future-ide-agent-debug.js"` → `"dev:debug": "node ./bin/vibe-agent-debug.js"`
- `"start": "node ./bin/future-ide-agent.js"` → `"start": "node ./bin/vibe-agent.js"`

- [ ] **Step 4: Rename and update the bin files**

Copy `bin/future-ide-agent.js` → `bin/vibe-agent.js` (keep content identical — the file just bootstraps tsx).
Copy `bin/future-ide-agent-debug.js` → `bin/vibe-agent-debug.js`.
Delete the old `bin/future-ide-agent.js` and `bin/future-ide-agent-debug.js`.

- [ ] **Step 5: Update src/app-config.ts**

Find the config filename pattern (contains `"future-ide-agent-config"`). Change to `"vibe-agent-config"`.

- [ ] **Step 6: Update src/app-debugger.ts**

Find all `"future-ide-agent"` and `"FutureIDE"` strings. Replace with `"vibe-agent"` and `"Vibe Agent"` respectively.

- [ ] **Step 7: Update src/command-controller.ts**

Find `configPath` reference containing `"future-ide-agent"`. Change to `"vibe-agent"`.

- [ ] **Step 8: Update src/app-state-store.ts**

Line 50: Change `"Starting FutureIDE Agent..."` → `"Starting Vibe Agent..."`.

- [ ] **Step 9: Update src/main.ts**

Change `appName` string from `"future-ide-agent"` to `"vibe-agent"`.

- [ ] **Step 10: Update src/welcome-controller.ts**

Find all `FutureIDE`, `future-ide-agent`, `FutureIDE Agent` strings. Replace:
- `"FutureIDE Agent"` → `"Vibe Agent"`
- `"future-ide-agent"` → `"vibe-agent"`
- Any setup flow titles mentioning the old name

- [ ] **Step 11: Update src/components/help-overlay.ts**

Line 59: `"FutureIDE Agent - Help"` → `"Vibe Agent - Help"`
Line 69: `"future-ide-agent-config.json"` → `"vibe-agent-config.json"`

- [ ] **Step 12: Update src/types.ts**

Rename `FutureIdeAgentAppOptions` → `VibeAgentAppOptions`.

- [ ] **Step 13: Update src/app.ts**

- Class name: `FutureIdeAgentApp` → `VibeAgentApp`
- JSDoc comment: update "FutureIDE Agent" → "Vibe Agent"
- `appName: "future-ide-agent"` → `appName: "vibe-agent"` (in createAppDebugger call)
- `configPath` containing `"future-ide-agent"` → `"vibe-agent"`
- `setTitle("future-ide-agent")` calls → `setTitle("Vibe Agent")`
- Import: `FutureIdeAgentAppOptions` → `VibeAgentAppOptions`
- Leave `refreshCockpitContext` banner text for now (removed in Task 3)

- [ ] **Step 14: Update test/app.test.ts**

- Change `import { FutureIdeAgentApp }` → `import { VibeAgentApp }`
- Change all `new FutureIdeAgentApp(...)` → `new VibeAgentApp(...)`
- Change `FutureIdeAgentAppOptions` → `VibeAgentAppOptions`

- [ ] **Step 15: Update README.md**

Replace all occurrences of `future-ide-agent`, `FutureIDE Agent`, `FutureIDE` with `vibe-agent`, `Vibe Agent` as appropriate.

- [ ] **Step 16: Run tests**

```bash
npm test
```

Expected: the "Vibe Agent" title test may fail (logo not updated yet — that's Task 2) but TypeScript compilation should succeed and existing tests should pass.

- [ ] **Step 17: Commit**

```bash
git add -A
git commit -m "feat: rebrand future-ide-agent → Vibe Agent

Renames all user-visible strings, config paths, bin names, class names,
and documentation from the prototype name to the official product name."
```

---

## Task 2: ANSI Shadow Logo & Header Block

**Files:**
- Modify: `src/shell-view.ts`

The header transforms from 3 single-line chrome rows to a 10-line bordered ASCII logo block.

**Before (3 rows):**
```
╔══ ⬡ FutureIDE Agent · session [branch] ══╗  (chromeHeader)
╠══ ▀▀ FUTURE·IDE  ⬡  CONNECTED ● provider ══╣  (chromeLogo)
╠══ F1 palette · /setup /provider /model ══╣   (chromeHelp)
```

**After (10 rows — all managed by refreshed `chromeLogo` Text component):**
```
╔═══════════════════════════════════════════════════╗
║  ██╗   ██╗██╗██████╗ ███████╗  █████╗  ██████╗…  ║
║  ██║   ██║██║██╔══██╗██╔════╝ ██╔══██╗██╔════╝…  ║
║  ╚██╗ ██╔╝██║██████╔╝█████╗   ███████║██║  ███╗… ║
║   ╚████╔╝ ██║██╔══██╗██╔══╝   ██╔══██║██║   ██║… ║
║    ╚═══╝  ╚═╝╚═════╝ ███████╗ ██║  ██║╚██████╔╝… ║
║                       ╚══════╝ ╚═╝  ╚═╝ ╚═════╝… ║
╠═══════════════════════════════════════════════════╣
║  Session: <name>  │  Thread: <thread>  │  CTX: %  ║
╚═══════════════════════════════════════════════════╝
```

- [ ] **Step 1: Write a test verifying the logo renders "VIBE AGENT" ASCII art**

In `test/app.test.ts`, add:

```typescript
test("logo renders VIBE AGENT ASCII art", async () => {
  const terminal = new VirtualTerminal(120, 40);
  const app = new VibeAgentApp({ terminal: terminal.terminal });
  const lines = await flush(terminal);
  // The block letter V starts with ██╗   ██╗
  assert.ok(lines.some(l => l.includes("██╗   ██╗")), "Expected block-letter V in logo");
  // The logo should contain ████████╗ (from T in AGENT)
  assert.ok(lines.some(l => l.includes("████████╗")), "Expected block-letter T in logo");
  app.stop();
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test
```

Expected: FAIL — logo lines not found

- [ ] **Step 3: Add the VIBE_AGENT_LOGO constant to shell-view.ts**

At the top of `src/shell-view.ts`, after the existing BRAILLE_FRAMES constant, add:

```typescript
// 6-line ANSI Shadow ASCII art for "VIBE AGENT"
// Both words are 6 rows tall (E in VIBE + all AGENT letters have 6 rows).
// Lines 1-5: VIBE letters close, AGENT letters still have content.
// Line 6: Only E (from VIBE) and all AGENT letters show bottom connectors.
const VIBE_AGENT_LOGO = [
  "██╗   ██╗██╗██████╗ ███████╗  █████╗  ██████╗ ███████╗███╗   ██╗████████╗",
  "██║   ██║██║██╔══██╗██╔════╝ ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝",
  "╚██╗ ██╔╝██║██████╔╝█████╗   ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ",
  " ╚████╔╝ ██║██╔══██╗██╔══╝   ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ",
  "  ╚═══╝  ╚═╝╚═════╝ ███████╗ ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ",
  "                    ╚══════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ",
] as const;
```

- [ ] **Step 4: Add CTX bar helper to shell-view.ts**

After the VIBE_AGENT_LOGO constant, add:

```typescript
function ctxBar(pct: number, width = 8): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}
```

- [ ] **Step 5: Remove `chromeHeader` and `chromeHelp` fields from DefaultShellView**

In `DefaultShellView`:
- Remove `private readonly chromeHeader = new Text("", 0, 0);`
- Remove `private readonly chromeHelp = new Text("", 0, 0);`

In the constructor, remove:
```typescript
this.tui.addChild(this.chromeHeader);
// and
this.tui.addChild(this.chromeHelp);
```

Also remove `this.tui.addChild(this.headerContentContainer);` — we no longer use this container.

- [ ] **Step 6: Rewrite `refreshChrome()` header section**

In `refreshChrome()`, replace the three existing blocks that set `chromeHeader`, `chromeLogo`, `chromeHelp` with a single multi-line logo block set on `chromeLogo`:

```typescript
// Build the 10-line logo + info block
const logoLines: string[] = [];

// Top border
logoLines.push(paintBoxLineTwoParts(`${bc("╔")}`, bc("╗"), cols, "═", bc, agentTheme.headerLine));

// 6 logo lines — each padded to full width inside the box
for (const logoRow of VIBE_AGENT_LOGO) {
  const inner = `${bc("║")}  ${agentTheme.accentStrong(logoRow)}`;
  logoLines.push(paintBoxLineTwoParts(inner, `  ${bc("║")}`, cols, " ", undefined, agentTheme.headerLine));
}

// Separator ╠═══╣
logoLines.push(paintBoxLineTwoParts(`${bc("╠")}`, bc("╣"), cols, "═", bc, agentTheme.headerLine));

// Info bar: Session / Thread / CTX
const sessionName = hostState?.sessionName ?? cwdLabel();
const threadName = this.footerData.getGitBranch() ?? "main";
const msgs = this.getMessages();
const contextWindow = hostState?.model?.contextWindow ?? 200000;
const ctxPct = msgs.length > 0
  ? Math.round(estimateContextTokens(msgs).tokens / contextWindow * 100)
  : 0;
const ctxColor = ctxPct >= 70 ? agentTheme.warning : agentTheme.success;
const infoBar = [
  `${agentTheme.info("Session:")} ${agentTheme.success(sessionName)}`,
  `${agentTheme.info("Thread:")} ${agentTheme.accent(threadName)}`,
  `${agentTheme.info("CTX:")} ${ctxColor(`${ctxPct}%`)} ${ctxColor(ctxBar(ctxPct))}`,
].join(agentTheme.segmentSep());
const infoLeft = `${bc("║")}  ${infoBar}`;
logoLines.push(paintBoxLineTwoParts(infoLeft, `  ${bc("║")}`, cols, " ", undefined, agentTheme.headerLine));

// Bottom border
logoLines.push(paintBoxLineTwoParts(`${bc("╚")}`, bc("╝"), cols, "═", bc, agentTheme.headerLine));

this.chromeLogo.setText(logoLines.join("\n"));
```

**Wiring real CTX %:** Do this in the same step — do not defer. Add a `getMessages` callback to the `DefaultShellView` constructor (alongside `getHostState`):

In `DefaultShellView` constructor signature:
```typescript
constructor(
  terminal: Terminal,
  private readonly stateStore: AppStateStore,
  private readonly getHostState: () => AgentHostState | undefined,
  private readonly getMessages: () => AgentMessage[],  // NEW
  private readonly getAgentHost: () => AgentHost | undefined,
  private readonly animationEngine?: AnimationEngine,
)
```

Add import at top of `shell-view.ts`:
```typescript
import { estimateContextTokens } from "./local-coding-agent.js";
// If not re-exported there, use the direct path:
// import { estimateContextTokens } from "../coding-agent/src/core/compaction/compaction.js";
```

In `src/app.ts`, update the `DefaultShellView` constructor call to pass `() => this.host.getMessages()` as the new `getMessages` argument.

- [ ] **Step 7: Remove `headerContentContainer` entirely**

The STATUS/CONNECTION boxes are gone. Custom header factory support via `headerContentContainer` is also removed (extensions can use `setHeaderFactory` as a replacement for the logo block itself if needed in future).

**a)** Remove the field declaration:
```typescript
// DELETE this line:
private readonly headerContentContainer = new Container();
```

**b)** Remove from constructor (already done in Step 5d via the new child order — confirm it's not added).

**c)** Remove `renderHeaderContent()` entirely and remove its call from `refresh()`:
```typescript
// In refresh(), DELETE this line:
this.renderHeaderContent();
```

**d)** Remove `customHeaderFactory`, `customHeaderComponent`, `setHeaderFactory()`, and `disposeCustomChrome()` only if they are not used elsewhere. Check `src/extension-ui-host.ts` — if extensions call `setHeaderFactory`, keep the method but have it set `chromeLogo` text directly instead of using the removed container.

- [ ] **Step 8: Run tests**

```bash
npm test
```

Expected: logo ASCII art tests pass. Existing tests should still pass.

- [ ] **Step 9: Commit**

```bash
git add src/shell-view.ts test/app.test.ts
git commit -m "feat: replace chrome header with ANSI Shadow VIBE AGENT logo block

Removes the 3-line FutureIDE text header and replaces it with a 10-line
bordered ASCII logo block showing 6-line ANSI Shadow art for 'VIBE AGENT'
plus a session/thread/CTX info bar below it."
```

---

## Task 3: Remove Help Text Banners

**Files:**
- Modify: `src/app.ts` (refreshCockpitContext)
- Modify: `src/shell-view.ts` (renderHeaderContent — already no-op'd in Task 2)

- [ ] **Step 1: Write test confirming "Ready for your first task" is not rendered**

In `test/app.test.ts`, add:

```typescript
test("no help text banners rendered", async () => {
  const terminal = new VirtualTerminal(120, 40);
  const app = new VibeAgentApp({ terminal: terminal.terminal });
  const lines = await flush(terminal);
  const output = lines.join("\n");
  assert.ok(!output.includes("Ready for your first task"), "Should not show first-task banner");
  assert.ok(!output.includes("Type a prompt"), "Should not show 'Type a prompt' help text");
  assert.ok(!output.includes("F1 palette"), "Should not show F1 palette help line");
  app.stop();
});
```

- [ ] **Step 2: Run to confirm test fails**

```bash
npm test
```

Expected: FAIL — "Ready for your first task" still present

- [ ] **Step 3: Remove help banners from refreshCockpitContext in src/app.ts**

Find `refreshCockpitContext()`. Remove the block at the bottom that sets the "Ready for your first task" and "Ready for your next task" context banners when `!hasMessages`.

**Before (remove these lines, approximately lines 657-666):**
```typescript
if (!hasMessages) {
  this.stateStore.setContextBanner(
    "Ready for your first task",
    "Type a prompt, use F1 for the command palette, or run /setup to switch provider and model defaults.",
    "accent",
  );
  return;
}
this.stateStore.setContextBanner(undefined, undefined);
```

**After:**
```typescript
// No default help banner — status is shown in the logo info bar
this.stateStore.setContextBanner(undefined, undefined);
```

Keep all provider/model setup banners (they are actionable warnings, not filler).

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass including the "no help text banners" test.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/shell-view.ts test/app.test.ts
git commit -m "feat: remove help text banners from header content area

Removes 'Ready for your first task', 'Type a prompt', and F1 palette
help line. Session context is now shown in the logo info bar instead."
```

---

## Task 4: Animation Engine Extensions

**Files:**
- Modify: `src/animation-engine.ts`
- Modify: `src/ansi.ts`

Add 5 new animation effects to the existing 80ms tick engine.

- [ ] **Step 1: Add `separatorLine` to src/ansi.ts**

After the `horizontalRule` function (line 171), add:

```typescript
/**
 * A slowly-crawling separator line using alternating ╌ and · characters.
 * offset shifts the repeating pattern by one position every 8 ticks,
 * creating a visible rightward crawl effect.
 */
export function separatorLine(width: number, offset: number, borderColor: string): string {
  // Use a 4-char repeating pattern so the crawl is visible
  const PATTERN = "╌╌·╌";
  let line = "";
  for (let i = 0; i < width; i++) {
    line += PATTERN[(i + offset) % PATTERN.length];
  }
  return style({ fg: borderColor })(line);
}
```

- [ ] **Step 2: Extend AnimationState in src/animation-engine.ts**

```typescript
export interface AnimationState {
  hueOffset: number;
  spinnerFrame: number;
  breathPhase: number;
  glitchActive: boolean;
  tickCount: number;
  // --- New fields ---
  focusFlashTicks: number;      // A: counts down 3→0 on focus change
  focusedComponent: string;     // A: "editor" | "sessions" | "overlay"
  wipeTransition: { active: boolean; frame: number }; // B: 0-3 = fill chars, ≥4 = done
  separatorOffset: number;      // C: increments every 8 ticks for crawling separator
  typewriter: { target: string; displayed: string; ticksSinceChar: number }; // E
}
```

- [ ] **Step 3: Update the initial state in AnimationEngine**

```typescript
private state: AnimationState = {
  hueOffset: 190,
  spinnerFrame: 0,
  breathPhase: 0,
  glitchActive: false,
  tickCount: 0,
  focusFlashTicks: 0,
  focusedComponent: "editor",
  wipeTransition: { active: false, frame: 0 },
  separatorOffset: 0,
  typewriter: { target: "", displayed: "", ticksSinceChar: 0 },
};
```

- [ ] **Step 4: Add public methods for triggering animations**

```typescript
/** A: Trigger selection flash on focus change */
triggerFocusFlash(component: string): void {
  this.state.focusFlashTicks = 3;
  this.state.focusedComponent = component;
}

/** B: Trigger block-fill wipe (call when switching sessions) */
triggerWipeTransition(): void {
  this.state.wipeTransition = { active: true, frame: 0 };
}

/** E: Set typewriter target (call from setStatusMessage hook) */
setTypewriterTarget(message: string): void {
  this.state.typewriter = { target: message, displayed: "", ticksSinceChar: 0 };
}
```

- [ ] **Step 5: Update the `tick()` method**

In the `tick()` private method, after the existing code, add:

```typescript
// A: Focus flash countdown
if (this.state.focusFlashTicks > 0) {
  this.state.focusFlashTicks--;
}

// B: Wipe transition advance
if (this.state.wipeTransition.active) {
  this.state.wipeTransition.frame++;
  if (this.state.wipeTransition.frame >= 4) {
    this.state.wipeTransition = { active: false, frame: 0 };
  }
}

// C: Separator crawl
if (this.state.tickCount % 8 === 0) {
  this.state.separatorOffset = (this.state.separatorOffset + 1) % 100;
}

// E: Typewriter
if (this.state.typewriter.displayed !== this.state.typewriter.target) {
  this.state.typewriter.ticksSinceChar++;
  if (this.state.typewriter.ticksSinceChar >= 2) {
    this.state.typewriter.ticksSinceChar = 0;
    const next = this.state.typewriter.target.slice(0, this.state.typewriter.displayed.length + 1);
    this.state.typewriter = { ...this.state.typewriter, displayed: next };
  }
}
```

- [ ] **Step 6: Write tests for the new animation state**

In `test/app.test.ts`, add:

```typescript
test("AnimationEngine focus flash counts down", async () => {
  // Import AnimationEngine directly for unit testing
  const { AnimationEngine } = await import("../src/animation-engine.js");
  const engine = new AnimationEngine();
  engine.start();
  engine.triggerFocusFlash("sessions");
  assert.strictEqual(engine.getState().focusFlashTicks, 3);
  assert.strictEqual(engine.getState().focusedComponent, "sessions");
  engine.stop();
});

test("AnimationEngine typewriter advances one char per 2 ticks", async () => {
  const { AnimationEngine } = await import("../src/animation-engine.js");
  const engine = new AnimationEngine();
  engine.setTypewriterTarget("AB");
  // Simulate ticks manually via getState after calling tick indirectly
  // (tick is private — test via start/stop with short timeout)
  engine.start();
  await new Promise(r => setTimeout(r, 250)); // ~3 ticks at 80ms each
  const state = engine.getState();
  assert.ok(state.typewriter.displayed.length > 0, "Typewriter should have advanced");
  engine.stop();
});
```

- [ ] **Step 7: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/animation-engine.ts src/ansi.ts test/app.test.ts
git commit -m "feat: extend animation engine with 5 new visual effects

Adds focus flash, block-fill wipe transition, separator crawl offset,
full-chrome hue surge wiring, and typewriter status message state."
```

---

## Task 5: Sessions Panel Component

**Files:**
- Create: `src/components/sessions-panel.ts`

This is a new `Component` that renders a tree view of sessions, a tab bar ([S]/[E]), and supports keyboard navigation.

**Reference pattern:** Study `src/components/help-overlay.ts` — it implements `Focusable` and has `render(width)`, `handleInput(data)`, `buildContent(width)`.

**`SessionInfo` type:** Imported from `"../local-coding-agent.js"`. Check the exact fields at runtime — the key ones are `sessionFile: string`, `sessionName?: string`, and a timestamp for date grouping. Use `sessionFile` as the unique key for `agentHost.switchSession()`.

- [ ] **Step 1: Write a test for sessions-panel rendering**

In `test/app.test.ts`, add:

```typescript
test("sessions panel renders tree with date groups", async () => {
  const { SessionsPanel } = await import("../src/components/sessions-panel.js");
  const mockSessions = [
    { sessionFile: "/tmp/s1.json", sessionName: "my-project", timestamp: Date.now() },
    { sessionFile: "/tmp/s2.json", sessionName: "auth-redesign", timestamp: Date.now() - 86400000 },
  ] as any[];
  const panel = new SessionsPanel({
    getSessions: async () => mockSessions,
    getCurrentSessionFile: () => "/tmp/s1.json",
    onSwitch: async () => {},
    onClose: () => {},
  });
  const lines = panel.render(30);
  const output = lines.join("\n");
  assert.ok(output.includes("SESSIONS"), "Should show SESSIONS heading");
  assert.ok(output.includes("Today"), "Should show Today group");
  assert.ok(output.includes("my-project"), "Should show session name");
});
```

- [ ] **Step 2: Run to confirm it fails (file doesn't exist)**

```bash
npm test
```

Expected: import error

- [ ] **Step 3: Confirm the `SessionInfo` timestamp field before writing `groupByDate`**

Run:
```bash
grep -n "timestamp\|createdAt\|lastModified\|startTime\|\.date\b" src/local-coding-agent.ts
```

Find the exact timestamp field on `SessionInfo`. Common names are `timestamp`, `createdAt`, `lastModified`, or `startTime`. Update the `(s as any).timestamp` cast in `groupByDate` to use the real field name. If no timestamp field exists on the type, fall back to `fs.statSync(s.sessionFile).mtimeMs` (add `import { statSync } from "fs"`).

- [ ] **Step 4: Create src/components/sessions-panel.ts**

```typescript
import { matchesKey, truncateToWidth, visibleWidth, type Focusable } from "@mariozechner/pi-tui";
import { paintLine } from "../ansi.js";
import { agentTheme } from "../theme.js";
import type { SessionInfo } from "../local-coding-agent.js";

type Tab = "sessions" | "extensions";

interface SessionNode {
  session: SessionInfo;
  expanded: boolean;
  threads?: string[]; // thread names fetched lazily from session file entries
}

interface DateGroup {
  label: string;
  nodes: SessionNode[];
  collapsed: boolean;
}

export interface SessionsPanelOptions {
  getSessions: () => Promise<SessionInfo[]>;
  getCurrentSessionFile: () => string | undefined;
  onSwitch: (sessionPath: string) => Promise<void>;
  onClose: () => void;
}

/**
 * Groups sessions by recency relative to now.
 *
 * IMPORTANT: Check the actual `SessionInfo` type definition in
 * `src/local-coding-agent.ts` (re-exported from coding-agent) for the
 * timestamp field name before writing this function. Common candidates:
 * `timestamp`, `createdAt`, `lastModified`, `startTime`. Use the correct
 * field name — if it's missing or zero, the session falls into "Older".
 */
function groupByDate(sessions: SessionInfo[]): DateGroup[] {
  const now = Date.now();
  const DAY = 86400000;
  const WEEK = 7 * DAY;
  const groups: Record<string, SessionInfo[]> = {
    Today: [],
    Yesterday: [],
    "Last Week": [],
    Older: [],
  };
  for (const s of sessions) {
    // Replace `s.timestamp` with the actual field from SessionInfo
    const age = now - ((s as any).timestamp ?? 0);
    if (age < DAY) groups["Today"]!.push(s);
    else if (age < 2 * DAY) groups["Yesterday"]!.push(s);
    else if (age < WEEK) groups["Last Week"]!.push(s);
    else groups["Older"]!.push(s);
  }
  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({
      label,
      nodes: items.map(s => ({ session: s, expanded: false })),
      collapsed: false,
    }));
}

export class SessionsPanel implements Focusable {
  private _focused = false;
  private tab: Tab = "sessions";
  private groups: DateGroup[] = [];
  private cursor = 0; // flat cursor index across all visible rows
  private flatItems: Array<{ type: "group"; groupIdx: number } | { type: "session"; groupIdx: number; nodeIdx: number }> = [];

  constructor(private readonly options: SessionsPanelOptions) {
    this.refresh();
  }

  get focused(): boolean { return this._focused; }
  set focused(v: boolean) { this._focused = v; }
  invalidate(): void {}

  async refresh(): Promise<void> {
    const sessions = await this.options.getSessions();
    this.groups = groupByDate(sessions);
    this.rebuildFlatItems();
  }

  private rebuildFlatItems(): void {
    this.flatItems = [];
    for (let gi = 0; gi < this.groups.length; gi++) {
      const g = this.groups[gi]!;
      this.flatItems.push({ type: "group", groupIdx: gi });
      if (!g.collapsed) {
        for (let ni = 0; ni < g.nodes.length; ni++) {
          this.flatItems.push({ type: "session", groupIdx: gi, nodeIdx: ni });
        }
      }
    }
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const bg = agentTheme.panelBg;
    const activeBg = agentTheme.panelBgActive;

    // Tab bar
    const sTab = this.tab === "sessions"
      ? agentTheme.accentStrong("[S]")
      : agentTheme.dim("[S]");
    const eTab = this.tab === "extensions"
      ? agentTheme.accentStrong("[E]")
      : agentTheme.dim("[E]");
    lines.push(paintLine(agentTheme.dim("┌─ ") + agentTheme.accent("SESSIONS") + agentTheme.dim(" ─") + sTab + agentTheme.dim(" ") + eTab + agentTheme.dim(" ─┐"), width, bg));

    if (this.tab === "extensions") {
      lines.push(paintLine(agentTheme.muted("  Extensions coming soon"), width, bg));
      lines.push(paintLine(agentTheme.dim("└" + "─".repeat(Math.max(0, width - 2)) + "┘"), width, bg));
      return lines;
    }

    // Sessions tree
    for (let i = 0; i < this.flatItems.length; i++) {
      const item = this.flatItems[i]!;
      const isCursor = i === this.cursor && this._focused;
      const rowBg = isCursor ? activeBg : bg;

      if (item.type === "group") {
        const g = this.groups[item.groupIdx]!;
        const arrow = g.collapsed ? "▶" : "▼";
        const text = `${agentTheme.dim(arrow)} ${agentTheme.muted(g.label)}`;
        lines.push(paintLine("│ " + text, width, rowBg));
      } else if (item.type === "session") {
        const g = this.groups[item.groupIdx]!;
        const node = g.nodes[item.nodeIdx]!;
        const isCurrent = node.session.sessionFile === this.options.getCurrentSessionFile();
        const name = node.session.sessionName ?? node.session.sessionFile.split("/").pop() ?? "session";
        const nameStyled = isCurrent ? agentTheme.accentStrong(name) : agentTheme.text(name);
        const expandArrow = node.threads !== undefined ? (node.expanded ? "▼" : "▶") : " ";
        const prefix = isCurrent ? agentTheme.accent("●") : agentTheme.dim("○");
        lines.push(paintLine(`│   ${prefix} ${agentTheme.dim(expandArrow)} ${nameStyled}`, width, rowBg));
        // Show threads when expanded
        if (node.expanded && node.threads) {
          for (let ti = 0; ti < node.threads.length; ti++) {
            const thread = node.threads[ti]!;
            const connector = ti === node.threads.length - 1 ? "└─" : "├─";
            lines.push(paintLine(`│       ${agentTheme.dim(connector)} ${agentTheme.success(thread)}`, width, bg));
          }
        }
      } else if (item.type === "thread") {
        // threads are rendered inline above — this type is unused in flatItems
      }
    }

    lines.push(paintLine(agentTheme.dim("└" + "─".repeat(Math.max(0, width - 2)) + "┘"), width, bg));
    return lines;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) { this.options.onClose(); return; }
    if (matchesKey(data, "tab") || data === "\x05") { // Tab or Ctrl+E
      this.tab = this.tab === "sessions" ? "extensions" : "sessions";
      return;
    }
    if (matchesKey(data, "up")) {
      this.cursor = Math.max(0, this.cursor - 1);
      return;
    }
    if (matchesKey(data, "down")) {
      this.cursor = Math.min(this.flatItems.length - 1, this.cursor + 1);
      return;
    }
    if (matchesKey(data, "right") || matchesKey(data, "left")) {
      const item = this.flatItems[this.cursor];
      if (item?.type === "group") {
        this.groups[item.groupIdx]!.collapsed = matchesKey(data, "left");
        this.rebuildFlatItems();
      } else if (item?.type === "session") {
        const node = this.groups[item.groupIdx]!.nodes[item.nodeIdx]!;
        if (matchesKey(data, "right")) {
          node.expanded = true;
          // Lazily fetch threads if not yet loaded
          // Threads in Vibe Agent are named branches — check SessionInfo for a
          // `branches?: string[]` field. If absent, read the session file to extract
          // unique branch/fork labels from the session entry tree.
          // For now, populate with a placeholder until the real API is confirmed:
          if (!node.threads) {
            node.threads = ["main"]; // replace with real branch fetch
          }
        } else {
          node.expanded = false;
        }
        // No need to rebuild flatItems — threads render inline in render()
      }
      return;
    }
    if (matchesKey(data, "enter")) {
      const item = this.flatItems[this.cursor];
      if (item?.type === "session") {
        const sf = this.groups[item.groupIdx]!.nodes[item.nodeIdx]!.session.sessionFile;
        this.options.onSwitch(sf).then(() => this.options.onClose());
      }
      return;
    }
  }
}
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: sessions panel test passes.

- [ ] **Step 6: Commit**

```bash
git add src/components/sessions-panel.ts test/app.test.ts
git commit -m "feat: add SessionsPanel component with tree view and tab bar

New TUI component for browsing sessions organized by date (Today,
Yesterday, Last Week, Older). Keyboard navigation: arrows, Enter to
switch, Esc to close. Extensions tab shows placeholder."
```

---

## Task 6: Side-by-Side Container + Wire Sessions Panel

**Files:**
- Create: `src/components/side-by-side-container.ts`
- Modify: `src/shell-view.ts`

The chat area and sessions panel render side by side. We need a horizontal layout container, then integrate it into `DefaultShellView`.

- [ ] **Step 1: Write a test for SideBySideContainer**

```typescript
test("SideBySideContainer merges two columns", async () => {
  const { SideBySideContainer } = await import("../src/components/side-by-side-container.js");
  const { Text } = await import("@mariozechner/pi-tui");
  const left = new Text("HELLO\nWORLD", 0, 0);
  const right = new Text("AAA\nBBB", 0, 0);
  const container = new SideBySideContainer(left, right, 5, "│");
  const lines = container.render(16);
  // total width = 16, right = 5, separator = 1, left = 10
  assert.ok(lines[0]?.includes("HELLO"), "Left content in first line");
  assert.ok(lines[0]?.includes("AAA"), "Right content in first line");
  assert.ok(lines[0]?.includes("│"), "Separator in first line");
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
npm test
```

- [ ] **Step 3: Create src/components/side-by-side-container.ts**

```typescript
import { visibleWidth, truncateToWidth, type Component } from "@mariozechner/pi-tui";

/**
 * Renders two components side by side, joined by a separator character.
 * Left component gets (width - rightWidth - separatorWidth) columns.
 * Right component gets rightWidth columns.
 */
export class SideBySideContainer implements Component {
  constructor(
    public left: Component,
    public right: Component | null,
    public rightWidth: number,
    private readonly separator: string = "│",
  ) {}

  invalidate(): void {
    this.left.invalidate();
    this.right?.invalidate();
  }

  render(width: number): string[] {
    if (!this.right) {
      return this.left.render(width);
    }

    const leftWidth = Math.max(0, width - this.rightWidth - 1); // -1 for separator
    const leftLines = this.left.render(leftWidth);
    const rightLines = this.right.render(this.rightWidth);

    const totalRows = Math.max(leftLines.length, rightLines.length);
    const result: string[] = [];

    for (let i = 0; i < totalRows; i++) {
      const l = leftLines[i] ?? " ".repeat(leftWidth);
      const r = rightLines[i] ?? " ".repeat(this.rightWidth);
      // Ensure left is exactly leftWidth visible chars
      const lPadded = l + " ".repeat(Math.max(0, leftWidth - visibleWidth(l)));
      result.push(lPadded + this.separator + r);
    }

    return result;
  }
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npm test
```

- [ ] **Step 5: Wire SessionsPanel + SideBySideContainer into DefaultShellView**

In `src/shell-view.ts`:

**a) Add imports:**
```typescript
import { SessionsPanel } from "./components/sessions-panel.js";
import { SideBySideContainer } from "./components/side-by-side-container.js";
```

**b) Add new fields to `DefaultShellView`:**
```typescript
private readonly chromeSeparatorTop = new Text("", 0, 0);
private readonly chromeSeparatorMid = new Text("", 0, 0);
private readonly contentArea = new SideBySideContainer(this.chatContainer, null, 30);
private sessionsPanel: SessionsPanel | null = null;
private sessionsPanelVisible = false;
```

**c) Final constructor signature (merged from Task 2 + Task 6 additions):**

Task 2 added `getMessages`. Task 6 adds `getAgentHost`. The final constructor must include both:

```typescript
constructor(
  terminal: Terminal,
  private readonly stateStore: AppStateStore,
  private readonly getHostState: () => AgentHostState | undefined,
  private readonly getMessages: () => AgentMessage[],    // added in Task 2
  private readonly getAgentHost: () => AgentHost | undefined,  // added in Task 6
  private readonly animationEngine?: AnimationEngine,
) {
```

Update the `DefaultShellView` instantiation in `src/app.ts` to pass all five arguments.

**d) Replace TUI child order in constructor:**

Remove `this.tui.addChild(this.chatContainer)` and `this.tui.addChild(this.headerContentContainer)`.

Replace with:
```typescript
this.tui.addChild(this.chromeLogo);        // 10-line logo block
this.tui.addChild(this.chromeSeparatorTop); // ╌╌╌╌ separator
this.tui.addChild(this.contentArea);        // chat + sessions side by side
this.tui.addChild(this.chromeSeparatorMid); // ╌╌╌╌ separator
this.tui.addChild(this.widgetContainerAbove);
this.tui.addChild(this.editorContainer);
this.tui.addChild(this.widgetContainerBelow);
this.tui.addChild(this.footerContentContainer);
this.tui.addChild(this.chromeStatus);
this.tui.addChild(this.chromeSummary);
```

**e) Add F3 toggle and focus management:**
```typescript
toggleSessionsPanel(): void {
  this.sessionsPanelVisible = !this.sessionsPanelVisible;
  if (this.sessionsPanelVisible) {
    if (!this.sessionsPanel) {
      const host = this.getAgentHost();
      this.sessionsPanel = new SessionsPanel({
        // getAgentHost() is called inside the arrow so it re-evaluates each refresh
        getSessions: () => {
          const h = this.getAgentHost();
          return h ? h.listSessions("all") : Promise.resolve([]);
        },
        getCurrentSessionFile: () => this.getHostState()?.sessionFile,
        onSwitch: async (path) => {
          this.animationEngine?.triggerWipeTransition();
          await this.getAgentHost()?.switchSession(path);
        },
        onClose: () => {
          this.sessionsPanelVisible = false;
          this.contentArea.right = null;
          this.setFocus(null); // returns to editor
          this.tui.requestRender();
        },
      });
    }
    this.sessionsPanel.refresh();
    this.contentArea.right = this.sessionsPanel;
    this.setFocus(this.sessionsPanel as any);
    this.animationEngine?.triggerFocusFlash("sessions");
  } else {
    this.contentArea.right = null;
    this.setFocus(null);
  }
  this.refresh();
  this.tui.requestRender();
}
```

**f) Update `refreshChrome()` to render separator lines:**

`separatorLine` is already imported at the file level from `./ansi.js` (add it to the existing import if not present). Do NOT use dynamic `await import()` — add to the static import at the top of the file:

```typescript
// In the existing import from "./ansi.js", add separatorLine:
import { glitchLine, innerBoxBottom, ..., separatorLine } from "./ansi.js";
```

Then in `refreshChrome()`, after the logo block:
```typescript
// C: Animated separator glyphs (crawl offset shifts by 1 every 8 ticks)
this.chromeSeparatorTop.setText(separatorLine(cols, animState.separatorOffset, agentTheme.colors.border));
this.chromeSeparatorMid.setText(separatorLine(cols, (animState.separatorOffset + 20) % 100, agentTheme.colors.border));
```

**g) Wire focus flash lerp into sessions panel border color:**

Add a `lerpHexColor` helper after `ctxBar` in `shell-view.ts`:
```typescript
function lerpHexColor(a: string, b: string, t: number): string {
  const ah = parseInt(a.slice(1), 16);
  const bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
  const br = (bh >> 16) & 0xff, bg2 = (bh >> 8) & 0xff, bb = bh & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg2 - ag) * t);
  const b2 = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b2.toString(16).padStart(2, "0")}`;
}
```

Add a `borderColor` public field to `SessionsPanel` (in `sessions-panel.ts`):
```typescript
borderColor: string = agentTheme.colors.border;
```

In `SessionsPanel.render()`, replace the hard-coded `agentTheme.dim("┌─")` and `agentTheme.dim("└─")` box border characters with `style({ fg: this.borderColor })("┌─")` etc., so the flash color propagates to the rendered box.

In `refreshChrome()`, after computing `bc`, set the sessions panel border using the lerp:
```typescript
// A: Focus flash — lerp sessions panel border from borderActive to border over 3 ticks
// t=0 → borderActive (bright), t=1 → border (settled dim)
if (this.sessionsPanel) {
  const flashTicks = animState.focusFlashTicks;
  if (flashTicks > 0 && animState.focusedComponent === "sessions") {
    const t = 1 - flashTicks / 3;
    this.sessionsPanel.borderColor = lerpHexColor(
      agentTheme.colors.borderActive,
      agentTheme.colors.border,
      t,
    );
  } else {
    this.sessionsPanel.borderColor = agentTheme.colors.border;
  }
}
```

**h) Wire typewriter for status line:**

In `refreshChrome()`, replace:
```typescript
const statusText = state.workingMessage ?? state.statusMessage;
```
with:
```typescript
const rawStatus = state.workingMessage ?? state.statusMessage;
// E: Typewriter — use displayed text if typewriter is active for this target
const statusText = (animState.typewriter.target === rawStatus && rawStatus !== "")
  ? animState.typewriter.displayed
  : rawStatus;
```

**i) Wire F3 key in input-controller.ts:**
In `src/input-controller.ts`, find the key handler. Add:
```typescript
if (matchesKey(data, "f3")) {
  shellView.toggleSessionsPanel();
  return;
}
```

- [ ] **Step 6: Wire typewriter in app-state-store.ts**

In `DefaultAppStateStore.setStatusMessage()`, add a callback to notify the animation engine:

```typescript
private onStatusChange?: (message: string) => void;

setOnStatusChange(cb: (message: string) => void): void {
  this.onStatusChange = cb;
}

setStatusMessage(message: string): void {
  this.update({ statusMessage: message });
  this.onStatusChange?.(message);
}
```

In `src/app.ts`, after creating the state store and animation engine, wire them:
```typescript
this.stateStore.setOnStatusChange((msg) => this.animEngine.setTypewriterTarget(msg));
```

- [ ] **Step 7: Run tests**

```bash
npm test
```

Expected: all tests pass including side-by-side container test.

- [ ] **Step 8: Commit**

```bash
git add src/components/side-by-side-container.ts src/components/sessions-panel.ts src/shell-view.ts src/app-state-store.ts src/app.ts src/input-controller.ts test/app.test.ts
git commit -m "feat: add sessions panel and side-by-side layout to shell

Adds F3-togglable sessions browser panel (30 cols) on the right side
of the chat area. Wires wipe transition on session switch, focus flash
on panel open, separator glyph rows, and typewriter status messages."
```

---

## Task 7: End-to-End Verification

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run the app**

```bash
npm run dev
```

Verify visually:
- Terminal title shows "Vibe Agent"
- 10-line header block: top border, 6 logo lines with ANSI Shadow art, separator, info bar, bottom border
- "VIBE AGENT" letters are all equal height (B is not truncated — looks like B not R)
- Info bar shows Session / Thread / CTX
- No "Ready for your first task" or "Type a prompt" text visible anywhere
- No F1 palette help line in chrome
- Bottom status bar unchanged
- F3 opens sessions panel on right; tree shows date groups; `↑`/`↓` navigates; `Enter` switches session; `Esc` closes
- Extensions tab shows "Extensions coming soon"
- Separator glyph lines visible between header and chat, and between chat and editor
- Status messages type in character by character
- Border color hue-shifts on all borders (logo, panel, footer) in sync
- Switch session triggers block-fill wipe

- [ ] **Step 3: Verify config file rename**

```bash
ls ~/.config/vibe-agent* 2>/dev/null || echo "config not created yet — start and /setup to create it"
```

Config should be named `vibe-agent-config.json`, not `future-ide-agent-config.json`.

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: post-verification cleanup"
```

---

## Quick Reference: Key File Locations

| Need | File |
|------|------|
| Logo ASCII constant | `src/shell-view.ts` — `VIBE_AGENT_LOGO` |
| Chrome rendering | `src/shell-view.ts` — `refreshChrome()` |
| Header content (provider banners) | `src/shell-view.ts` — `renderHeaderContent()` |
| Help text removal | `src/app.ts` — `refreshCockpitContext()` |
| Animation state | `src/animation-engine.ts` — `AnimationState` interface |
| Separator line utility | `src/ansi.ts` — `separatorLine()` |
| Sessions panel | `src/components/sessions-panel.ts` |
| Horizontal layout | `src/components/side-by-side-container.ts` |
| CTX % calculation | `coding-agent/src/core/compaction/compaction.ts` — `estimateContextTokens()` |
| Typewriter hook | `src/app-state-store.ts` — `setOnStatusChange()` |
| F3 keybinding | `src/input-controller.ts` |
