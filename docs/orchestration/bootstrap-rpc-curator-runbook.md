# Orc Orchestration Bootstrap, RPC, Curator, Subagent/Memory, and Incident Runbook

This guide is for outside engineers onboarding to the orchestration runtime quickly. It consolidates install/bootstrap prerequisites, psmux lifecycle commands, RPC framing, event/state contracts, subagent-memory protocol, and incident recovery actions.

> Primary code anchors:
> - `src/orchestration/bootstrap.ps1`
> - `src/orchestration/bridge/*`
> - `src/orchestration/graph/*`
> - `src/orchestration/memory/*`

---

## 1) Bootstrap / install prerequisites

### Host profile
- The bootstrap path currently targets **Windows hosts only** because `psmux` relies on native ConPTY APIs.
- On non-Windows systems, `src/orchestration/bootstrap.ps1` fails fast by design.

### Installer precedence
`src/orchestration/bootstrap.ps1` uses this order:
1. Prefer **WinGet**: `winget install psmux --accept-source-agreements --accept-package-agreements`
2. Fallback to **Cargo**: `cargo install psmux`
3. If neither installer exists, fail with explicit remediation text.

### Post-install verification contract
Bootstrap validates command resolution for all aliases expected from the package:
- `psmux`
- `pmux`
- `tmux`

If any alias is missing, bootstrap fails and instructs operators to refresh PATH / shell session.

### Minimal operator checklist
1. Run from Windows PowerShell/PowerShell 7 on Windows 10+.
2. Execute: `./src/orchestration/bootstrap.ps1`
3. Confirm completion message: `bootstrap.ps1 completed successfully.`
4. Confirm CLI aliases resolve in a new shell (`psmux`, `pmux`, `tmux`).

---

## 2) psmux lifecycle commands (session + pane management)

Runtime psmux orchestration is split across two modules:
- Session lifecycle: `src/orchestration/terminal/session_manager.ts`
- Pane lifecycle + command injection: `src/orchestration/terminal/pane_orchestrator.ts`

### Core session lifecycle (target session: `vibe_core`)
- Existence check:
  - `psmux has-session -t vibe_core`
- Create detached core session:
  - `psmux new-session -d -s vibe_core`
- Attach for interactive recovery:
  - `psmux attach -t vibe_core`
- Shutdown core session:
  - `psmux kill-session -t vibe_core`

### Dead-session recovery semantics
`recoverCoreSession()` behavior:
1. Ensure detached session exists.
2. Attempt `psmux attach -t vibe_core`.
3. If attach fails and session no longer exists, emit `dead_psmux_session`, recreate, and retry attach once.
4. If retry still fails, abort with error.

### Pane lifecycle commands
- Split pane vertically on target session/window:
  - `psmux split-window -v -t vibe_core`
- Split pane horizontally:
  - `psmux split-window -h -t vibe_core`
- Capture active pane id:
  - `psmux display-message -p "#{pane_id}"`
- Inject a command into a pane:
  - `psmux send-keys -t <paneId> "<command>" Enter`

### Curator dashboard output transport
`src/orchestration/bridge/renderer.ts` supports:
- `psmux send-keys` transport (line-by-line into one designated dashboard pane)
- named-pipe transport

The renderer rejects writes to non-dashboard panes by contract.

---

## 3) RPC framing contract (LF-only JSONL)

### Where enforced
- Launcher transport boundary: `src/orchestration/bridge/rpc_launcher.ts`
- Stream parser: `src/orchestration/bridge/stream_parser.ts`

### Stdin command envelope schema
Launcher writes one JSON object per line (`\n` terminated):
- Schema sentinel: `"pi.rpc.command.v1"`
- Fields: `requestId`, `issuedAt`, `target`, `command.kind`, `command.payload`, optional `metadata`

### Stdout telemetry envelope schema
Child processes must emit JSONL envelopes with:
- Schema sentinel: `"pi.rpc.telemetry.v1"`
- Fields: `eventId`, `emittedAt`, `source`, `telemetry.kind`, `telemetry.severity`, `telemetry.payload`

### LF framing rules
`JsonLfStreamParser` contract:
- Parses only **LF-delimited** complete frames.
- Accepts arbitrary chunk boundaries; waits for LF before parsing.
- Ignores blank frames.
- Normalizes trailing CR before JSON parse (CRLF tolerance).
- On stream end, unterminated buffered content is quarantined as `frame_overflow`.

### Quarantine / malformed handling
Malformed frames are not fatal by default:
- Reasons: `json_parse_error`, `validation_failed`, `frame_overflow`
- Launcher emits structured diagnostics (`malformed_jsonl_line`) and continues processing valid frames.

---

## 4) Event schema and curator state transitions

### Curator event schema (`bridge/*`)
Primary event union in `src/orchestration/bridge/curator.ts`:
- `agent_start`
- `turn_start`
- `message_update`
- `tool_execution_update`
- `agent_end`

Shared event metadata:
- `agentId`, `paneId` (required)
- optional: `graphNodeId`, `processPid`, `correlationId`, `timestamp`

### Curator pane state machine
Per `(agentId, paneId)` state transitions:
- Initial: `idle`
- `agent_start` -> `running`
- `agent_end` -> `ended`
- Watchdog expiry while running -> `timed_out`

State behaviors:
- `turn_start` updates turn timers and `lastTurnDurationMs`.
- `message_update` appends `text`, `thinking`, and incremental tool call arguments.
- `tool_execution_update` upserts tool execution status (`queued|running|completed|failed`).
- `agent_end` finalizes timing + finish reason and triggers memory artifact capture.

### Watchdog behavior
- Default timeout: `45_000ms` (override via curator options).
- Every non-terminal event re-arms watchdog.
- Expiry emits `stalled_tool_watchdog` diagnostic, marks pane `timed_out`, persists snapshot.

### Canonical bus event schema (`graph/*` and reducer-facing contracts)
Normalized event kinds (see `src/orchestration/orc-events/types.ts`):
- `process.lifecycle`, `graph.lifecycle`, `agent.message`, `tool.call`, `tool.result`,
- `worker.status`, `stream.warning`, `transport.fault`, `checkpoint.status`, `security.approval`

Reducer boundary in `src/orchestration/orc-events/control-plane-reducer.ts` projects those events into durable control-plane summaries (phase, active wave, worker results, messages, checkpoint metadata, transport health, terminal state).

---

## 5) Subagent + memory file protocol

### Subagent routing protocol (`graph/*`)
`src/orchestration/graph/subagents/router.ts`:
- Maps task type -> role (`inquisitor` or `alchemist`).
- Starts target RPC agent via launcher.
- Splits a secondary pane and binds `(agentId, paneId, pid, graphNodeId)` to a routed session.
- Stores both role-keyed and instance-keyed session bindings.
- Binds telemetry by `source.instanceId` first, then role/agent fallback.

Session identity object (`RoutedSubagentSession` in `graph/subagents/types.ts`) includes:
- `sessionId`, `correlationId`, `taskId`, `taskType`
- `subagentRole`, `subagentAgentId`, `subagentInstanceId`
- `processPid`, `paneId`, `boundAt`

### Memory record protocol (`memory/*`)
`src/orchestration/memory/types.ts` defines schema version `1` and four record kinds:
1. `subagent_findings`
2. `intermediate_artifacts`
3. `completion_status`
4. `handoff_summary`

Storage implementation in `src/orchestration/memory/orc-memory-store.ts` writes JSON records under:
`<memoryRoot>/<threadId>/<agentId>/<paneId>/`

Default file names:
- `subagent-findings.json`
- `intermediate-artifacts.json`
- `completion-status.json`
- `handoff-summary.json`

### Agent-end memory capture
On `agent_end`, curator writes all four record types, then consumes the bundle to update in-memory global plan state per agent. Consumption marks `completion_status.consumedAt` and refreshes `updatedAt`.

### Concurrency / safety notes
`src/orchestration/memory/fs-safe.ts` provides lock + atomic write helpers:
- directory lock file: `.orc-memory.lock`
- write path uses atomic JSON write semantics

---

## 6) Incident runbook (recovery actions by failure type)

Use this sequence first for any incident:
1. Capture correlation keys: `correlationId`, `agentId`, `paneId`, `pid`, `graphNodeId`.
2. Inspect structured diagnostics from launcher/session manager/curator.
3. Apply failure-specific recovery below.

### A. `dead_psmux_session`
**Symptoms**
- Attach fails in recovery path.
- Session disappeared between has-session and attach.

**Recovery**
1. Recreate detached session (`new-session -d -s vibe_core`).
2. Retry attach exactly once (runtime does this automatically).
3. If still failing: validate `psmux` install and host compatibility via `bootstrap.ps1`.

### B. `crashed_subagent_process`
**Symptoms**
- Subagent exits unexpectedly.
- Launcher emits restart diagnostic.

**Recovery**
1. Let `RpcRestartPolicy` retries complete (default capped restarts).
2. If retries exhausted, inspect stderr + recent telemetry around exit.
3. Relaunch fresh agent process for that role.
4. Escalate if repeated crashes on same workload.

### C. `malformed_jsonl_line`
**Symptoms**
- Quarantine diagnostics from parser/launcher.
- Missing expected telemetry transitions while process still alive.

**Recovery**
1. Treat as stream-integrity warning first; valid frames continue.
2. Verify emitter emits exactly one JSON object per LF-terminated line on stdout.
3. Remove non-JSON stdout contamination (logs/debug prints should go to stderr).
4. Restart process if corruption becomes persistent/high-volume.

### D. `stalled_tool_watchdog`
**Symptoms**
- Pane transitions to `timed_out`.
- No terminal event before watchdog expiry.

**Recovery**
1. Treat run as timed out/aborted.
2. Inspect last bound telemetry and tool execution status for stuck operation.
3. Relaunch agent task from latest known stable checkpoint/thread context.
4. If chronic, raise watchdog tuning / tool timeout issue with owning module.

### E. Transport fault events (`transport.fault`)
Refer to `src/orchestration/orc-events/types.ts` + `transport-policy.ts` codes:
- `transport_startup_failure`, `transport_disconnect`, `transport_broken_pipe`, `transport_non_zero_exit`, `transport_signal_shutdown`, `transport_user_cancellation`, `transport_ambiguous_terminal_state`, etc.

**Phase-2 operational policy (short form)**
- Startup/connectivity/broken-pipe/non-zero-exit -> fail run, inspect diagnostics, relaunch clean process.
- User cancellation -> expected cancelled terminal state.
- Ambiguous terminal state -> reconcile tracker snapshot with event-log before retry.

---

## 7) Fast onboarding map by module path

- Bootstrap/install and host checks: `src/orchestration/bootstrap.ps1`
- Process lifecycle / RPC launcher / parser / curator / dashboard output: `src/orchestration/bridge/*`
- Graph topology + subagent routing contracts: `src/orchestration/graph/*`
- Durable per-agent memory artifacts and schema: `src/orchestration/memory/*`

If you are new to the repo, pair this runbook with:
- `docs/orchestration/phase-1-scaffold.md`
- `docs/orchestration/phase-2-execution-plan.md`
- `docs/unified-error-strategy.md`
