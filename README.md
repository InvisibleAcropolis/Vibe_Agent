# Vibe Agent

A professional terminal-based AI coding agent that provides a unified TUI (Terminal User Interface) experience. Vibe Agent deprecates the WebUI of the underlying coding-agent package in favor of a complete terminal-based interface using the TUI shell from `@mariozechner/pi-tui`.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [User Interface](#user-interface)
- [Commands](#commands)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Architecture](#architecture)
- [Development Guide](#development-guide)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)

---

## Overview

Vibe Agent is a terminal-based AI coding assistant that provides full feature parity with web-based coding agents while maintaining the efficiency and speed of a terminal interface. Built on top of the `@mariozechner/pi-coding-agent` package, it offers a unified TUI experience for all AI interactions.

### Key Concepts

- **Shell Shape**: The TUI follows a shell pattern with header, body, footer, and overlays
- **Agent Host**: Direct integration with the coding agent's AgentSession for AI interactions
- **Extensions**: Full support for the coding-agent extension system
- **Artifacts**: Files and code created by the agent are tracked as viewable artifacts
- **Sessions**: Conversations are organized into sessions with branching and navigation

---

## Features

- **Full Chat Interface**: Streaming responses with markdown rendering
- **Tool Execution Display**: Visual feedback for read, write, edit, bash, grep, find, and ls operations
- **Artifact Viewer**: Browse files and code created by the agent
- **Session Management**: New, resume, fork, and tree navigation
- **Model Selection**: Switch between models and providers with OAuth support
- **Thinking Levels**: Adjust reasoning budget (off, minimal, low, medium, high, xhigh)
- **Extension Support**: Custom tools, commands, UI components, and event handlers
- **Statistics**: Token usage tracking and session metrics
- **HTML Export**: Export conversations as HTML
- **Debug Snapshots**: Comprehensive debugging system
- **Mouse Support**: Click and scroll in overlays and lists
- **Theming**: Customizable themes for the terminal interface

---

## Installation

### Prerequisites

- Node.js 20.6+
- Terminal with Unicode and 256-color support

### Install from Source

```bash
cd vibe-agent
npm install
npm run build
npm test
```

The supported developer flow is root-only. Install, build, and test from the repository root.
The `coding-agent/` and `tui-shell/` directories are vendored reference code and are not standalone build targets for this fork.

### Global Installation

```bash
npm link
vibe-agent
```

---

## Quick Start

### Starting the Application

```bash
# Start with default settings
npm start

# Development mode with hot reload
npm run dev

# Debug mode
npm run dev:debug
```

### First Run Setup

On first launch, the application will show a welcome screen for provider selection:

1. Select your preferred OAuth provider (Google Antigravity, OpenAI Codex, or others)
2. Complete the OAuth flow
3. Start chatting with the agent

### Setting up API Keys

Instead of OAuth, you can use API keys directly:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_API_KEY=...
```

Then run the application - it will skip the OAuth setup.

---

## User Interface

The interface is organized from top to bottom:

### Header

- **Title Bar**: Shows "Vibe Agent", current session name, and git branch
- **Help Bar**: Quick keybinding hints (F1 for palette, Ctrl+L for model, etc.)
- **Connection Status**: Provider connection indicator (● connected, ○ disconnected)

### Messages Area

- User messages with markdown rendering
- Assistant responses with streaming text and thinking blocks
- Tool execution cards showing arguments and results
- Notifications and error messages

### Editor

- Multi-line text editor at the bottom of the screen
- Border color indicates current thinking level
- File references via `@` symbol
- Path completion with Tab

### Footer

- **Status Line**: Current working message or status
- **Powerline**: Provider | model | thinking:level | session | status indicator
- **Artifacts Badge**: Shows count of generated artifacts

### Overlays

- Command palette for quick access to commands
- Model selector for switching AI models
- Session stats and artifact viewer
- Help and settings panels

---

## Commands

Type `/` in the editor to trigger commands.

### Session Commands

| Command | Description |
|---------|-------------|
| `/new` | Start a new session |
| `/resume` | Browse and resume previous sessions |
| `/fork` | Create new session from current branch |
| `/tree` | Navigate session tree and switch branches |
| `/name <name>` | Set session display name |
| `/compact [prompt]` | Compact context with optional custom instructions |
| `/export [path]` | Export session to HTML file |
| `/stats` | Show session statistics |
| `/artifacts` | View session artifacts |

### Model Commands

| Command | Description |
|---------|-------------|
| `/model` | Open model selector |
| `/thinking` | Open thinking level selector |
| `/login` | OAuth login flow |
| `/logout` | Logout from provider |

### Utility Commands

| Command | Description |
|---------|-------------|
| `/settings` | Open settings menu |
| `/help` | Show help overlay |
| `/clear` | Clear chat display |
| `/debug-dump` | Write debug snapshot |

---

## Keyboard Shortcuts

### Global Shortcuts

| Key | Action |
|-----|--------|
| `F1` | Open command palette |
| `Ctrl+Q` | Quit application |
| `Esc` | Close overlay / abort streaming |
| `Shift+Ctrl+D` | Write debug snapshot |

### Editor Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Submit prompt |
| `Shift+Enter` | New line in editor |
| `Ctrl+C` | Abort streaming / clear editor |
| `Ctrl+D` | Quit (when editor empty) |
| `Ctrl+L` | Open model selector |
| `Shift+Tab` | Cycle thinking level |
| `Ctrl+Shift+Up/Down` | Cycle models forward/backward |
| `Ctrl+E` | Toggle tool output expansion |
| `Ctrl+T` | Toggle thinking visibility |
| `Up/Down` | Navigate editor history |

### Editor Features

- **File References**: Type `@` to fuzzy-search project files
- **Path Completion**: Press Tab to complete file paths
- **Images**: Paste images with Ctrl+V (or Ctrl+Shift+V on Windows)
- **Bash Commands**: Type `!command` to run and send output to LLM, `!!command` to run without sending

---

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│  VibeAgentApp (main.ts)                                     │
│  ├─ ShellView (TUI shell container)                         │
│  │   ├─ Header (chrome + custom header)                     │
│  │   ├─ Messages Area (chat container)                      │
│  │   ├─ Widgets (above/below editor)                        │
│  │   ├─ Editor (CustomEditor)                              │
│  │   └─ Footer (chrome + custom footer)                     │
│  ├─ AgentHost (debug-agent-host.ts)                         │
│  │   └─ Connects to AgentSession                           │
│  ├─ Controllers                                             │
│  │   ├─ CommandController (slash commands, selectors)      │
│  │   ├─ EditorController (text input, keybindings)         │
│  │   ├─ InputController (global input handling)            │
│  │   ├─ OverlayController (modal overlays)                 │
│  │   └─ StartupController (initialization)               │
│  ├─ ExtensionUIHost (extension integration)              │
│  ├─ WelcomeController (onboarding flow)                    │
│  └─ MessageRenderer (render messages to components)      │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User Input**: EditorController handles typing and submission
2. **Command Routing**: CommandController processes slash commands
3. **Agent Communication**: AgentHost sends prompts to AgentSession
4. **Message Rendering**: MessageRenderer converts messages to TUI components
5. **UI Updates**: ShellView displays components, StateStore manages state
6. **Event Loop**: InputController handles global shortcuts and mouse events

### Key Components

#### ShellView

The main container managing the TUI layout with:
- Chrome header and footer with status information
- Message chat container for conversation display
- Editor container for user input
- Widget containers for extension UI
- Focus management and rendering

#### AgentHost Interface

Abstracts agent communication with methods for:
- Starting/stopping sessions
- Sending prompts with streaming behavior
- Managing models, thinking levels, and OAuth
- Session lifecycle (new, resume, fork, tree navigation)
- Statistics and export

#### Controllers

Each controller manages a specific concern:
- **CommandController**: Slash command handling, selector overlays
- **EditorController**: Text editor management, history, keybindings
- **InputController**: Global input routing, mouse events
- **OverlayController**: Modal management (show/hide/focus)
- **StartupController**: Initialization sequence, extension loading

#### State Management

**AppStateStore**: Central reactive state for:
- Status and working messages
- Thinking visibility and tool expansion
- Overlay tracking
- Artifacts collection
- Focus labels

State changes trigger UI refreshes via subscribers.

#### Message Rendering

**MessageRenderer**: Transforms agent messages into TUI components:
- UserMessageComponent for user messages
- AssistantMessageComponent for AI responses
- ToolExecutionComponent for tool calls/results
- Artifact extraction for the artifact panel

---

## Development Guide

### Project Structure

```
vibe-agent/
├── src/
│   ├── main.ts                    # Entry point
│   ├── app.ts                     # Main application class
│   ├── types.ts                   # TypeScript types
│   ├── theme.ts                   # Color theme and styling
│   ├── ansi.ts                    # ANSI styling utilities
│   ├── mouse.ts                   # Mouse event handling
│   ├── agent-host.ts              # Agent host interface
│   ├── app-debugger.ts            # Debug snapshot system
│   ├── app-config.ts              # Configuration management
│   ├── app-state-store.ts         # Reactive state management
│   ├── shell-view.ts              # TUI shell container
│   ├── command-controller.ts      # Command handling
│   ├── editor-controller.ts       # Text editor management
│   ├── input-controller.ts        # Global input handling
│   ├── overlay-controller.ts      # Overlay management
│   ├── overlay-layout.ts          # Overlay positioning
│   ├── extension-ui-host.ts       # Extension integration
│   ├── startup-controller.ts      # Initialization
│   ├── welcome-controller.ts      # Onboarding
│   ├── message-renderer.ts        # Message rendering
│   ├── footer-data-provider.ts    # Footer data
│   ├── mouse-enabled-terminal.ts  # Terminal wrapper
│   ├── index.ts                   # Public exports
│   └── components/                # Overlay components
│       ├── artifact-viewer.ts
│       ├── editor-overlay.ts
│       ├── filter-select-overlay.ts
│       ├── help-overlay.ts
│       ├── session-stats-overlay.ts
│       └── text-prompt-overlay.ts
├── test/
│   └── app.test.ts                # Test suite
├── coding-agent/                  # Underlying agent package
│   └── Vendored source consumed through src/local-coding-agent.ts
├── tui-shell/                     # Vendored upstream shell reference (not built from root)
├── package.json
├── package-lock.json
└── tsconfig.json
```

### Supported Build Flow

Run all development commands from the repository root:

```bash
npm install
npm run build
npm test
```

This fork compiles vendored `coding-agent` code only when it is imported through `src/local-coding-agent.ts`.
Do not treat `coding-agent/` or `tui-shell/` as independently supported packages in this repository.

### Adding New Features

#### Adding a Slash Command

Edit `src/command-controller.ts`:

```typescript
async handleSlashCommand(text: string): Promise<boolean> {
    if (text.startsWith("/mycommand")) {
        // Your command logic
        this.stateStore.setStatusMessage("Command executed!");
        return true;
    }
    return false;
}
```

#### Adding a Keyboard Shortcut

Edit `src/editor-controller.ts` in `configureEditor`:

```typescript
editor.onAction("myAction", () => {
    // Your action logic
});
```

Or add to `src/input-controller.ts` for global shortcuts:

```typescript
if (matchesKey(nextData, "ctrl+x")) {
    // Handle shortcut
    return { consume: true };
}
```

#### Creating a Custom Overlay

Create a new file in `src/components/`:

```typescript
import { matchesKey, type Focusable } from "@mariozechner/pi-tui";
import type { MouseAwareOverlay } from "../types.js";

export class MyOverlay implements MouseAwareOverlay, Focusable {
    private _focused = false;
    
    constructor(private readonly onClose: () => void) {}
    
    get focused(): boolean { return this._focused; }
    set focused(value: boolean) { this._focused = value; }
    
    render(width: number): string[] {
        // Return array of rendered lines
        return ["My overlay content"];
    }
    
    handleInput(data: string): void {
        if (matchesKey(data, "escape")) {
            this.onClose();
        }
    }
    
    handleMouse(event: MouseEvent, rect: Rect): boolean {
        // Handle mouse events
        return true;
    }
}
```

Register in `src/command-controller.ts`:

```typescript
openMyOverlay(): void {
    this.overlayController.showCustomOverlay(
        "my-overlay",
        new MyOverlay(() => this.overlayController.closeOverlay("my-overlay")),
        { width: 72, maxHeight: "80%", anchor: "center", margin: 1 }
    );
}
```

#### Adding to the Extension UI Host

Edit `src/extension-ui-host.ts`:

```typescript
createContext(): ExtensionUIContext {
    return {
        // ... existing context
        myNewMethod: () => {
            // Implementation
        }
    };
}
```

### Testing

Run the test suite:

```bash
npm test
```

Tests use a VirtualTerminal to simulate TUI interactions without requiring an actual terminal.

### Debugging

Enable debug snapshots:

```bash
PI_MONO_APP_DEBUG_BUNDLE=./debug npm run dev
```

This creates snapshot bundles in the debug directory with:
- Terminal state
- Message history
- Host state
- Editor content

Press `Shift+Ctrl+D` to write a manual snapshot.

---

## Configuration

### App Config File

Located at `~/.pi/agent/vibe-agent-config.json`:

```json
{
    "setupComplete": true,
    "selectedProvider": "google-antigravity"
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GOOGLE_API_KEY` | Google AI API key |
| `PI_MONO_APP_DEBUG_BUNDLE` | Debug bundle output directory |

---

## Troubleshooting

### Terminal Display Issues

**Problem**: Garbled output or wrong colors

**Solution**: Ensure your terminal supports:
- Unicode characters
- 256 colors
- Bracketed paste mode

**Problem**: Mouse not working

**Solution**: The app enables mouse support automatically. Some terminals may need:
- iTerm2: Enable "Report mouse clicks"
- tmux: `set -g mouse on`

### OAuth Issues

**Problem**: Login flow fails

**Solutions**:
1. Check browser popup permissions
2. Try manual code entry if callback fails
3. Use API keys instead: `export ANTHROPIC_API_KEY=...`

### Extension Loading

**Problem**: Extensions not loading

**Check**:
1. Extension file path is correct
2. TypeScript compiles without errors
3. Extension exports a default function
4. Check debug logs for loading errors

### Performance

**Problem**: Slow rendering

**Solutions**:
1. Reduce terminal size
2. Clear artifacts with `/clear`
3. Compact session with `/compact`
4. Check `PI_MONO_APP_DEBUG_BUNDLE` is not set in production

---

## License

MIT

## See Also

- [@mariozechner/pi-coding-agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent): Underlying agent framework
- [@mariozechner/pi-tui](https://www.npmjs.com/package/@mariozechner/pi-tui): Terminal UI components
- [@mariozechner/pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai): LLM toolkit
