# Shell View Documentation

## Overview

The **Shell View** is the main TUI (Terminal User Interface) component of the VibeAgent application. It orchestrates the visual rendering of the entire CLI experience, including the chrome (header, menu, status bars), transcript (chat messages), thinking panel, sessions panel, and editor area.

The shell view is **not** a shell terminal—it is a sophisticated terminal UI framework built on top of `@mariozechner/pi-tui`, a custom TypeScript TUI library.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER INFO (Session, Mode, Chat, Thread, CTX usage)            │
├─────────────────────────────────────────────────────────────────┤
│  MENU BAR  [F1] Settings  ◆  [F2] Sessions  ◆  [F3] Orc       │
├─────────────────────────────────────────────────────────────────┤
│  SEPARATOR (animated crawling line)                             │
├────────────────────────────┬────────────────────────────────────┤
│                            │                                    │
│   TRANSCRIPT VIEWPORT      │  SESSIONS PANEL (when visible)     │
│   (scrollable messages)    │  - Grouped by date                │
│                            │  - Session switching               │
│                            │                                    │
├────────────────────────────┴────────────────────────────────────┤
│  SEPARATOR (animated crawling line)                             │
├─────────────────────────────────────────────────────────────────┤
│  WIDGET CONTAINER (above editor - extension widgets)            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  EDITOR AREA (input area with multi-line text editing)          │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  WIDGET CONTAINER (below editor - extension widgets)            │
├─────────────────────────────────────────────────────────────────┤
│  FOOTER CONTENT (custom footer from extensions)                 │
├─────────────────────────────────────────────────────────────────┤
│  STATUS LINE (working message, artifacts, pending count)         │
├─────────────────────────────────────────────────────────────────┤
│  SUMMARY LINE (providers, mode, model, transcript position)      │
├─────────────────────────────────────────────────────────────────┤
│  THINKING TRAY (expandable reasoning panel)                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Shell View Interface (`src/shell-view.ts`)

The `ShellView` interface defines the contract for the TUI shell:

```typescript
export interface ShellView {
  readonly tui: TUI;
  readonly footerData: FooterDataProvider;
  start(): void;
  stop(): void;
  setEditor(component: Component): void;
  setFocus(component: Component | null): void;
  setMessages(components: Component[]): void;
  clearMessages(): void;
  setWidget(key: string, content: WidgetFactory | string[] | undefined, placement?: "aboveEditor" | "belowEditor"): void;
  setHeaderFactory(factory: HeaderFactory | undefined): void;
  setFooterFactory(factory: FooterFactory | undefined): void;
  setTitle(title: string): void;
  refresh(): void;
  toggleSessionsPanel(): void;
  scrollTranscript(lines: number): void;
  scrollTranscriptToTop(): void;
  scrollTranscriptToBottom(): void;
  dispatchMouse(event: MouseEvent): boolean;
  getMenuAnchor(key: string): { row: number; col: number };
}
```

### 2. DefaultShellView (`src/shell-view.ts:41-286`)

The main implementation class. Key responsibilities:

- **Manages TUI lifecycle**: Creates and owns the `TUI` instance
- **Manages layout**: Calculates the transcript viewport rectangle based on terminal dimensions
- **Manages chrome**: Delegates rendering to `ShellExtensionChrome` and `renderShellChrome`
- **Manages transcript**: Delegates to `ShellTranscriptController`
- **Manages thinking**: Delegates to `ShellThinkingSync`
- **Manages sessions**: Delegates to `ShellSessionsController`

#### Constructor Dependencies

```typescript
constructor(
  terminal: Terminal,                              // Raw terminal (ProcessTerminal)
  stateStore: AppStateStore,                       // Global reactive state
  getHostState: () => AgentHostState | undefined, // Host state getter
  getMessages: () => AgentMessage[],              // Messages getter
  getAgentHost: () => AgentHost | undefined,      // Agent host getter
  animationEngine?: AnimationEngine,              // Animation controller
)
```

#### Child Component Hierarchy (added to TUI)

The `DefaultShellView` adds these components to the TUI in order:

1. `customHeaderContainer` - Custom header from extensions
2. `chromeHeaderInfo` - Main header (session info, context bar)
3. `chromeMenuBar` - F1/F2/F3 menu bar
4. `chromeSeparatorTop` - Animated separator
5. `contentArea` - SideBySideContainer (transcript + sessions panel)
6. `chromeSeparatorMid` - Second animated separator
7. `widgetContainerAbove` - Extension widgets above editor
8. `editorContainer` - Editor input area
9. `widgetContainerBelow` - Extension widgets below editor
10. `footerContentContainer` - Custom footer from extensions
11. `chromeStatus` - Status line (working message)
12. `chromeSummary` - Summary line (model, transcript position)
13. `thinkingTray` - Thinking/reasoning panel

#### Key Methods

| Method | Purpose |
|--------|---------|
| `start()` | Initialize TUI and start render loop |
| `stop()` | Clean up all subscriptions and stop TUI |
| `refresh()` | Recalculate layout and re-render chrome |
| `setEditor(component)` | Set the editor input component |
| `setMessages(components)` | Update transcript with new message components |
| `setWidget(key, content, placement)` | Register extension widgets |
| `toggleSessionsPanel()` | Show/hide the sessions panel |

#### Layout Calculation (`refresh()` method)

The layout is recalculated on every refresh:

1. All components render themselves to get their heights
2. `measureShellLayout()` calculates the content area height:
   ```
   contentHeight = terminalRows - sum(all fixed heights)
   ```
3. The transcript rect is computed:
   ```
   transcriptRect = {
     row: 1 + customHeaderHeight + headerHeight + menuHeight + separatorTopHeight,
     col: 1,
     width: leftWidth (terminal width minus sessions panel if visible),
     height: contentHeight
   }
   ```

---

## The Chrome System

### Shell Chrome Renderer (`src/shell/shell-chrome-renderer.ts`)

Renders all the static-looking border/header elements using ANSI styling.

#### `renderShellChrome()` Function

Main entry point that returns all chrome text strings:

```typescript
function renderShellChrome(input: ShellChromeRenderInput): ShellChromeRenderResult
```

**Output:**

| Field | Content |
|-------|---------|
| `headerInfoText` | Box-drawn header with session info, mode, chat, thread, context % |
| `menuBarText` | F1/F2/F3 menu items with trailing fill characters |
| `separatorTopText` | Animated separator line (crawling pattern) |
| `separatorMidText` | Second animated separator |
| `statusText` | Status line with working message, artifact count, pending count |
| `summaryText` | Bottom summary: providers, mode, model, transcript scroll position |
| `wipeChar` | Block fill character for wipe transition (░▒▓█) |
| `sessionBorderColor` | Border color for sessions panel flash |

#### Header Info (`renderHeaderInfo()`)

Displays in a box-drawn frame (`╔═╗║╚═╝`):

- **Session name**: Current session's display name
- **Mode**: Active runtime name (coding/orc)
- **Chat**: Current conversation label
- **Thread**: Git branch name
- **CTX**: Context window usage percentage with bar visualization
- **Host**: psmux runtime label (if applicable)
- **Context title**: Styled banner for context changes
- **Help message**: Warning banner for important messages

#### Status Line (`renderStatusLine()`)

```
╠══ <streaming status> ════════════════════════ <badges> ═══╣
```

Badges include:
- `artifacts:N` - Number of generated artifacts
- `pending:N` - Pending message count

#### Summary Line (`renderSummaryLine()`)

```
╚══ providers:N ◆ mode:SessionMode ◆ ⬡ provider ◆ model:id ◆ transcript:1-20/100 ◆ follow/paused ◆ thinking:level ══ ● idle/compacting/streaming ══╝
```

### Shell Layout (`src/shell/shell-layout.ts`)

Two functions for layout calculation:

#### `measureShellLayout()`

Computes the vertical layout of all shell elements:

```typescript
function measureShellLayout(input: ShellLayoutInput): ShellLayoutResult
```

**Input heights to account for:**
- `customHeaderHeight` - Extension-provided header
- `headerHeight` - Shell chrome header
- `menuHeight` - Menu bar (1 line)
- `separatorTopHeight` - Top separator (1 line)
- `separatorMidHeight` - Middle separator (1 line)
- `widgetAboveHeight` - Widgets above editor
- `editorHeight` - Editor component height
- `widgetBelowHeight` - Widgets below editor
- `footerContentHeight` - Extension footer
- `statusHeight` - Status line (1 line)
- `summaryHeight` - Summary line (1 line)
- `thinkingTrayHeight` - Thinking panel (0-8 lines)

**Output:**

```typescript
interface ShellLayoutResult {
  contentHeight: number;  // Available height for transcript
  transcriptRect: Rect;  // {row, col, width, height}
}
```

#### `measureShellMenuAnchor()`

Calculates the screen position for menu item popups:

```typescript
function measureShellMenuAnchor(input: ShellMenuAnchorInput): { row: number; col: number }
```

Returns the row/col where a menu's dropdown should anchor.

---

## Transcript System

### Transcript Viewport (`src/components/transcript-viewport.ts`)

Scrollable viewport for displaying chat messages.

```typescript
export class TranscriptViewport implements Component {
  private components: Component[] = [];
  private viewportHeight = 1;
  private scrollOffset = 0;
  private followTail = true;  // Auto-scroll to bottom
  
  setComponents(components: Component[]): void;
  setViewportHeight(height: number): void;
  scrollBy(lines: number): void;
  scrollToTop(): void;
  scrollToBottom(): void;
  render(width: number): string[];
}
```

**Key behavior:**

- Flattens all message components into lines
- Handles scrolling with `followTail` mode (auto-scroll when at bottom)
- Preserves scroll position when content changes (smart repositioning)
- Returns exactly `viewportHeight` lines (pads with empty lines if needed)

**State tracking:**

```typescript
interface TranscriptViewportState {
  scrollOffset: number;      // Current scroll position
  totalLines: number;        // Total content lines
  contentHeight: number;     // Viewport height
  followTail: boolean;       // Auto-scroll enabled?
}
```

### Shell Transcript Controller (`src/shell/shell-transcript-controller.ts`)

Mediator between `DefaultShellView` and `TranscriptViewport`.

```typescript
export class ShellTranscriptController {
  constructor(private readonly transcriptViewport: TranscriptViewport) {}
  
  setMessages(components: Component[]): void;
  clearMessages(): void;
  setViewportHeight(height: number): void;
  getState(): TranscriptViewportState;
  scrollBy(lines: number): void;
  scrollToTop(): void;
  scrollToBottom(): void;
  dispatchMouse(input: TranscriptMouseInput): boolean;  // Mouse wheel handling
}
```

---

## Thinking Panel

### Thinking Tray (`src/components/thinking-tray.ts`)

Collapsible panel showing the agent's reasoning/thinking process.

```typescript
export class ThinkingTray implements Component {
  setEnabled(enabled: boolean): void;
  setThinkingText(text: string | undefined): void;
  render(width: number): string[];
}
```

**Visual structure:**

```
┌─ Thinking ────────────────────────┐
│ Markdown-rendered thinking text  │
│ (up to 6 lines, min 2)            │
└───────────────────────────────────┘
```

- Uses `Markdown` component for rich text rendering
- Respects `showThinking` state from `AppStateStore`
- Falls back to extracting thinking from agent messages

### Shell Thinking Sync (`src/shell/shell-thinking-sync.ts`)

Synchronizes thinking display with app state:

```typescript
export class ShellThinkingSync {
  sync(): void {
    // Reads state.showThinking and state.activeThinking
    // Updates thinkingTray accordingly
    // Falls back to extracting from messages if no explicit thinking state
  }
}
```

**Priority order for thinking text:**
1. Explicit `activeThinking.text` from state
2. `activeThinking.hasTurnState` flag
3. `activeThinking.hasThinkingEvents` flag
4. Latest thinking text extracted from messages

---

## Sessions Panel

### Sessions Panel (`src/components/sessions-panel.ts`)

Multi-session management UI with tree view:

```typescript
export class SessionsPanel implements Focusable {
  borderColor: string;
  
  async refresh(): Promise<void>;  // Fetch sessions from host
  handleInput(data: string): void;  // Keyboard navigation
  render(width: number): string[];
}
```

**Features:**
- Groups sessions by date: Today, Yesterday, Last Week, Older
- Keyboard navigation (up/down/left/right/enter)
- Tab switching between Sessions and Extensions
- Current session indicator (●)
- Thread expansion for multi-threaded sessions
- Escape to close

### Shell Sessions Controller (`src/shell/shell-sessions-controller.ts`)

Manages sessions panel visibility and integration:

```typescript
export class ShellSessionsController {
  toggle(): void;  // Show/hide sessions panel
  isVisible(): boolean;
  setBorderColor(color: string | undefined): void;
}
```

**Toggle behavior:**
1. First toggle: Creates `SessionsPanel`, attaches to `SideBySideContainer.right`
2. Sets focus to the panel
3. Triggers focus flash animation
4. Second toggle: Removes panel, restores focus to editor

---

## Side-by-Side Container (`src/components/side-by-side-container.ts`)

Split-pane container for transcript + sessions panel:

```typescript
export class SideBySideContainer implements Component {
  wipeChar: string | null;  // For wipe transition fill
  maxHeight: number | null;
  
  constructor(
    public left: Component,      // Transcript viewport
    public right: Component | null,  // Sessions panel
    public rightWidth: number,  // Sessions panel width
  );
}
```

**Wipe transition:**

When `wipeChar` is set (during session switch), the container fills with block characters instead of rendering content:

```typescript
if (this.wipeChar !== null) {
  return Array.from({ length: rows }, () => this.wipeChar!.repeat(width));
}
```

Wipe characters in order: `░` → `▒` → `▓` → `█`

---

## Extension System

### Shell Extension Chrome (`src/shell/shell-extension-chrome.ts`)

Manages extension-provided UI elements:

```typescript
export class ShellExtensionChrome {
  setWidget(key: string, content: WidgetFactory | string[] | undefined, placement: "aboveEditor" | "belowEditor"): void;
  setHeaderFactory(factory: HeaderFactory | undefined): void;
  setFooterFactory(factory: FooterFactory | undefined): void;
  renderWidgets(): void;
  renderFooterContent(): void;
}
```

**Widget factories:**

```typescript
type WidgetFactory = (tui: TUI, theme: Theme) => Component & { dispose?(): void };
type FooterFactory = (tui: TUI, theme: Theme, footerData: FooterDataProvider) => Component & { dispose?(): void };
type HeaderFactory = (tui: TUI, theme: Theme) => Component & { dispose?(): void };
```

**Usage:**
- `setWidget()` - Registers extension widgets above/below editor
- `setHeaderFactory()` - Replaces default header with custom component
- `setFooterFactory()` - Adds custom footer content

---

## Animation System

### Animation Engine (`src/animation-engine.ts`)

Centralized animation controller running at 80ms tick intervals.

```typescript
export interface AnimationState {
  hueOffset: number;           // 0-359, cycling hue for borders
  spinnerFrame: number;        // 0-7, Braille spinner animation
  breathPhase: number;         // 0.0-1.0, sine wave for subtle effects
  glitchActive: boolean;       // Random glitch effect every ~6 seconds
  tickCount: number;           // Global tick counter
  focusFlashTicks: number;     // Focus change flash countdown (3→0)
  focusedComponent: "editor" | "sessions" | "overlay";
  wipeTransition: { active: boolean; frame: number };  // Session switch fill
  separatorOffset: number;      // Crawling separator animation
  typewriter: { target: string; displayed: string; ticksSinceChar: number };
}
```

**Animation features:**

| Feature | Trigger | Behavior |
|---------|---------|----------|
| **Focus flash** | `triggerFocusFlash()` | 3-tick border color flash on focus change |
| **Wipe transition** | `triggerWipeTransition()` | Block fill (░▒▓█) during session switch |
| **Separator crawl** | Every 8 ticks | Animated line pattern in separators |
| **Typewriter** | `setTypewriterTarget()` | Character-by-character status reveal |
| **Hue rotation** | Every tick | Slowly rotating hue for borders (faster during streaming) |
| **Spinner** | Every tick | 8-frame Braille spinner rotation |
| **Glitch** | Every 75 ticks | Random 3-tick glitch effect |

---

## Footer Data Provider (`src/footer-data-provider.ts`)

Provides contextual information for the shell:

```typescript
export class FooterDataProvider {
  getGitBranch(): string | null;      // Current git branch
  getExtensionStatuses(): ReadonlyMap<string, string>;  // Extension statuses
  getAvailableProviderCount(): number;
  getSessionMode(): string;
  getPsmuxRuntimeLabel(): string | undefined;  // psmux session label
  onBranchChange(callback: () => void): () => void;  // Git watcher unsubscribe
}
```

**Features:**
- Caches git branch with file system watcher for live updates
- Tracks extension statuses (used in summary line)
- Reads psmux runtime context for distributed setups

---

## App State Store (`src/app-state-store.ts`)

Reactive state container for the entire shell:

```typescript
export interface AppShellState {
  statusMessage: string;
  workingMessage?: string;
  helpMessage?: string;
  contextTitle?: string;
  contextTone?: "accent" | "info" | "success" | "warning" | "dim";
  showThinking: boolean;
  toolOutputExpanded: boolean;
  focusLabel: string;
  overlayIds: string[];
  artifacts: Artifact[];
  showArtifactPanel: boolean;
  sessionStatsVisible: boolean;
  activeRuntimeId: string;
  activeRuntimeName: string;
  activeConversationLabel: string;
  activeThinking: ActiveThinkingState;
  permissionPending?: { toolName: string; args: Record<string, unknown>; resolve: (approved: boolean) => void };
}
```

**Publishing/subscribing pattern:**

```typescript
subscribe(listener: AppStateListener): () => void;
// Listener called immediately with current state
// Returns unsubscribe function
```

---

## The pi-tui Framework (`@mariozechner/pi-tui`)

The shell view is built on a custom TUI framework with these characteristics:

### Component Interface

```typescript
interface Component {
  render(width: number): string[];  // Returns lines for given width
  invalidate?(): void;               // Called on theme/structural change
  handleInput?(data: string): void; // Keyboard input when focused
  wantsKeyRelease?: boolean;         // Opt-in to key release events
}
```

### Container

```typescript
class Container implements Component {
  children: Component[];
  addChild(component: Component): void;
  removeChild(component: Component): void;
  clear(): void;
  render(width: number): string[];  // Concatenates all children
}
```

### TUI Class

```typescript
class TUI extends Container {
  terminal: Terminal;
  
  start(): void;
  stop(): void;
  setFocus(component: Component | null): void;
  requestRender(): void;  // Schedules render on next tick
  showOverlay(component: Component, options?: OverlayOptions): OverlayHandle;
  hideOverlay(): void;
}
```

### Differential Rendering

The TUI uses **three rendering strategies**:

1. **First render**: Output all lines without clearing (assumes clean screen)
2. **Resize**: Full clear + re-render on terminal resize
3. **Incremental**: Only re-render changed lines:
   - Compare previous and new line arrays
   - Find `firstChanged` and `lastChanged` indices
   - Use CSI 2026 synchronized output for atomic updates
   - Clear individual changed lines with `ESC[2K`

### Synchronized Output (CSI 2026)

Prevents terminal flicker by wrapping output:

```
\x1b[?2026h  // Begin synchronized output
...content...
\x1b[?2026l  // End synchronized output
```

### Overlay System

Modal overlays with anchor-based positioning:

```typescript
interface OverlayOptions {
  width?: SizeValue;        // "50%" or 40
  maxHeight?: SizeValue;
  anchor?: "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top-center" | "bottom-center" | "left-center" | "right-center";
  offsetX?: number;
  offsetY?: number;
  row?: SizeValue;
  col?: SizeValue;
  margin?: OverlayMargin | number;
  visible?: (termWidth: number, termHeight: number) => boolean;
  nonCapturing?: boolean;   // Don't grab keyboard focus
}
```

---

## Menu Bar System (`src/components/menu-bar.ts`)

### `renderMenuBar()`

Renders the F1/F2/F3 menu bar line:

```
[F1] Settings  ◆  [F2] Sessions  ◆  [F3] Orc ════════════════════════
```

- Uses box-drawing fill character `═` to extend to terminal edge
- Styled with animated border colors
- `◆` separator between items

### `measureMenuBarItems()`

Calculates column positions for menu item popups:

```typescript
function measureMenuBarItems(items: MenuBarItem[]): MenuBarItemLayout[]
// Returns: { key, label, startCol, endCol } for each item
```

Used by `measureShellMenuAnchor()` to position dropdown menus.

### Menu Items (from `shell-constants.ts`)

```typescript
export const SHELL_MENU_ITEMS: MenuBarItem[] = [
  { key: "F1", label: "Settings" },
  { key: "F2", label: "Sessions" },
  { key: "F3", label: "Orc" },
];
```

---

## Theme System

### Agent Theme (`src/theme.ts`)

Dynamic theme with ANSI styling functions:

```typescript
export const agentTheme = {
  // Styling functions that return ANSI-colored strings
  accent: (text: string) => string;
  text: (text: string) => string;
  dim: (text: string) => string;
  muted: (text: string) => string;
  warning: (text: string) => string;
  success: (text: string) => string;
  
  // Segment joining
  segmentSep: () => string;  // Returns " ◆ "
  
  // Special styling
  border: (text: string) => string;
  borderAnimated: (text: string) => string;
  headerLine: (text: string) => string;
  footerLine: (text: string) => string;
  statusStreaming: (text: string) => string;
  statusIdle: (text: string) => string;
  thinkingSegment: (text: string) => string;
  providerSegment: (text: string) => string;
  modelSegment: (text: string) => string;
  artifactLabel: (text: string) => string;
  
  // Banner styles
  bannerAccent: (text: string) => string;
  bannerInfo: (text: string) => string;
  bannerSuccess: (text: string) => string;
  bannerWarning: (text: string) => string;
  bannerDim: (text: string) => string;
  
  // Markdown theme
  markdownTheme: MarkdownTheme;
};
```

### Dynamic Theme (`createDynamicTheme()`)

Creates border color styler that cycles through hues based on animation state:

```typescript
function createDynamicTheme(animationState: AnimationState): (text: string) => string {
  // Returns HSL-colored text based on animationState.hueOffset
}
```

---

## Context Window Estimation (`src/shell/shell-coding-agent-interop.ts`)

```typescript
export function estimateContextUsagePercent(
  messages: AgentMessage[],
  contextWindow: number
): number {
  if (messages.length === 0 || contextWindow <= 0) {
    return 0;
  }
  return Math.round(estimateContextTokens(messages).tokens / contextWindow * 100);
}
```

Displayed in header as:

```
CTX: 45% ████████░░░░░
```

Color changes to `warning` (red) when >= 70%.

---

## Entry Point Flow

```
main.ts
  └── startVibeAgentApp() [run-app.ts]
        └── new VibeAgentApp() [app.ts]
              ├── new ProcessTerminal() [pi-tui terminal.ts]
              ├── new TUI(terminal)
              ├── new DefaultShellView(terminal, stateStore, ...)
              │     ├── new SideBySideContainer(transcriptViewport, null, 30)
              │     ├── new ShellExtensionChrome({...})
              │     ├── new ShellThinkingSync({...})
              │     └── new ShellSessionsController({...})
              ├── new AnimationEngine()
              └── app.start()
                    └── lifecycle.start()
                          └── startupController.initialize()
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/shell-view.ts` | Main ShellView interface and DefaultShellView implementation |
| `src/shell/shell-chrome-renderer.ts` | Renders all chrome elements (header, menu, separators, status, summary) |
| `src/shell/shell-layout.ts` | Layout calculations for shell dimensions |
| `src/shell/shell-extension-chrome.ts` | Manages extension-provided UI (widgets, header, footer) |
| `src/shell/shell-transcript-controller.ts` | Mediator for transcript viewport |
| `src/shell/shell-sessions-controller.ts` | Manages sessions panel visibility |
| `src/shell/shell-thinking-sync.ts` | Syncs thinking display with app state |
| `src/shell/shell-types.ts` | Type definitions for shell interfaces |
| `src/shell/shell-constants.ts` | Constants like menu items, Braille frames |
| `src/shell/shell-coding-agent-interop.ts` | Interop with coding agent (theme, context estimation) |
| `src/components/transcript-viewport.ts` | Scrollable message viewport |
| `src/components/thinking-tray.ts` | Thinking/reasoning panel |
| `src/components/side-by-side-container.ts` | Split-pane container |
| `src/components/sessions-panel.ts` | Sessions tree view panel |
| `src/components/menu-bar.ts` | Menu bar renderer |
| `src/app-state-store.ts` | Reactive state container |
| `src/footer-data-provider.ts` | Contextual footer data |
| `src/animation-engine.ts` | Animation controller |
| `resources/pi-mono-main/packages/tui/src/tui.ts` | pi-tui framework TUI class |
| `resources/pi-mono-main/packages/tui/src/terminal.ts` | pi-tui ProcessTerminal |

---

## Constants

### Braille Spinner Frames

```typescript
const BRAILLE_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
```

### Wipe Transition Characters

```typescript
const WIPE_CHARS = ["░", "▒", "▓", "█"];
// Progressively denser block characters for session switch fill
```

### Context Bar

```typescript
function ctxBar(pct: number, width = 8): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}
```
