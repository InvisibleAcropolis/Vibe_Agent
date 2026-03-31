# Shell Action Keybinding Mapping

This document records the keybinding-to-shell-action contract used by `DefaultInputController`.
The intent is to keep behavior stable while the shell implementation migrates from legacy
`DefaultShellView` assumptions to adapter-dispatched actions.

## Global keybindings (dispatched as shell actions)

| Key | Shell action | Adapter target |
| --- | --- | --- |
| `PageUp` | `scroll` | `page-up` |
| `PageDown` | `scroll` | `page-down` |
| `Home` | `scroll` | `top` |
| `End` | `scroll` | `bottom` |
| `F1` | `overlay-open` | `settings` |
| `F2` | `overlay-open` | `sessions` |
| `F3` | `overlay-open` | `orchestration` |

## Behavior parity notes

- **Command palette:** still opens from editor escape when the prompt is empty.
- **Interrupt:** escape/ctrl+c behavior during streaming is still handled by editor handlers (`onEscape`).
- **Model cycling:** still handled by editor actions (`Ctrl+Shift+Up/Down`).
- **Quit flow:** `Ctrl+Q` (global) and `Ctrl+D` on an empty editor are unchanged.

## Why this contract exists

Historically, global input handling called row/viewport operations directly on `ShellView`.
`MainShellAdapter.dispatchShellAction(...)` now centralizes those operations, allowing shell-next
to interpret the same action union without coupling input code to transcript geometry internals.

