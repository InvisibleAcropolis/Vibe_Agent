# Unified Orchestration Error Strategy

This document describes the runtime failure strategy introduced for orchestration components that span terminal session management, subagent process hosting, JSONL parsing, and tool-execution watchdog supervision.

## Covered failure classes

- **Dead psmux session recovery** (`dead_psmux_session`)
  - Triggered when `recoverCoreSession()` cannot attach and the session no longer exists.
  - Recovery behavior: recreate detached session and retry attach once.
- **Crashed subagent process restart** (`crashed_subagent_process`)
  - Triggered when a subagent process exits unexpectedly and restart policy allows retry.
  - Recovery behavior: restart according to `RpcRestartPolicy`.
- **Malformed JSONL line handling** (`malformed_jsonl_line`)
  - Triggered when telemetry parser quarantines malformed or invalid LF-delimited frames.
  - Recovery behavior: quarantine frame and continue stream processing.
- **Stalled tool execution watchdog expiry** (`stalled_tool_watchdog`)
  - Triggered when a running pane exceeds watchdog timeout with no terminal end event.
  - Recovery behavior: mark pane timed out and emit a structured diagnostic.

## Shared structured error shape

All four classes are represented by `UnifiedOrchestrationError`, which standardizes:

- `kind`: stable failure taxonomy.
- `recoveryAction`: one of `retry | restart | quarantine | abort`.
- `context`: correlation metadata:
  - `correlationId`
  - `graphNodeId`
  - `agentId`
  - `paneId`
  - `pid`
  - `runCorrelationId` (if available)
- `detail`: source-specific debug payload.
- `observedAt`: ISO timestamp.

`createCorrelationContext(...)` generates a durable correlation id when one is not provided by the caller.

## Correlation path (graph ↔ agent ↔ pane ↔ pid)

The router now materializes a correlation context at routing-time and stores it into the subagent session:

1. `routeTask(...)` starts/loads an agent runtime.
2. Pane split returns `paneId`.
3. Runtime identity contributes `agentId` and `pid`.
4. Optional `graphNodeId` from the caller is attached.
5. The resulting `correlationId` is persisted in `RoutedSubagentSession`.

On subsequent telemetry binding and watchdog diagnostics, logs include the same contextual identifiers so distributed failures can be stitched together post-hoc.

## Integration points

- `TerminalSessionManager`
  - New `onDiagnostic` callback emits structured dead-session diagnostics.
- `RpcProcessLauncher`
  - New `onDiagnostic` callback emits:
    - malformed frame quarantines,
    - crash-and-restart diagnostics.
- `RpcEventCurator`
  - Accepts optional `graphNodeId`, `processPid`, and `correlationId` on incoming events.
  - Emits `stalled_tool_watchdog` diagnostics when watchdog expires.
- `OrcSubagentRouter`
  - Emits structured binding diagnostics and preserves per-session correlation identifiers.

## Operational guidance

- Prefer searching diagnostics by `context.correlationId` first.
- Use `kind` to drive alert routing:
  - paging-worthy: `crashed_subagent_process`, repeated `stalled_tool_watchdog`,
  - warning-tier: `malformed_jsonl_line` (singletons),
  - environment-tier: `dead_psmux_session`.
- For distributed incident review, correlate:
  - router session binding event,
  - launcher crash/quarantine event,
  - curator watchdog event.
