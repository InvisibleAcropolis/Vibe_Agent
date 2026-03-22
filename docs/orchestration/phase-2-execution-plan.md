# Orc orchestration Phase 2 execution plan

This document breaks Phase 2 into a concrete implementation backlog for engineers building the Orc worker-execution plane, Python↔TypeScript transport, async Global Event Bus (GEB), and TUI telemetry plumbing.

Phase 2 assumes the Phase 1 scaffold documented in `docs/orchestration/phase-1-scaffold.md` already exists. It does **not** declare the phase complete; it is the task inventory and sequencing guide for getting from the current scaffold to a resilient execution plane.

## Phase 2 goal

Flesh out the internals created in Phase 1 so Orc can:

- launch and supervise LangGraph/DeepAgents-backed worker execution from the TypeScript runtime;
- stream strict single-line JSON telemetry from Python to TypeScript over stdout;
- normalize that telemetry into a strongly typed, append-friendly Global Event Bus;
- drive TUI overlays, panes, and future telemetry views without coupling UI components to child-process or LangGraph details; and
- survive malformed events, partial failures, cancelled runs, broken streams, transport disconnects, and noisy parallel worker activity while still rendering friendly operator-facing summaries.

## Mandatory process rule for every Phase 2 task

Every task below must explicitly touch `LANGEXTtracker.md`.

1. **Before implementation starts:** read `LANGEXTtracker.md` to confirm current process state, blockers, and carryover work.
2. **During implementation:** update the relevant Phase 2 ledger row with files touched, status, validation notes, blocker notes, and follow-up TODOs.
3. **Before closing the task:** append a session-log note, refresh risks/blockers if needed, and update the next-session handoff.

## Recommended sequencing

1. Contracts and schemas
2. Python runner and JSONL transport
3. TypeScript transport ingestion and GEB core
4. State reduction and persistence/logging
5. TUI subscribers and operator-facing rendering
6. Failure handling, cancellation, and debug ergonomics
7. Documentation and handoff polish

## Task backlog

### P2-001 — Freeze the Phase 2 control/data-plane contract

Define the full contract between the Orc TypeScript runtime, the Python LangGraph runner, and the TUI-facing event system. This task should convert the design narrative into stable interfaces before transport code is written.

**Scope**
- Extend `src/orchestration/orc-io.ts` with transport-facing request/response/event envelope types.
- Introduce dedicated Phase 2 types for event ids, stream sequence numbers, origin metadata, event categories, severity, and lifecycle statuses.
- Record the canonical event schema for the required `WHO did WHAT HOW at WHEN` shape plus raw payload passthrough fields.
- Define the minimum metadata needed to distinguish agent→user events from agent→computer/tool events.
- Document the state ownership boundary between `OrcControlPlaneState`, transport events, tracker snapshots, and future TUI view models.

**Primary files**
- `src/orchestration/orc-io.ts`
- `src/orchestration/orc-state.ts`
- `docs/orchestration/phase-2-execution-plan.md`
- `LANGEXTtracker.md`

**Done when**
- TypeScript has a stable event-envelope vocabulary for all downstream tasks.
- Design mandate mappings for DM-01, DM-04, and DM-08 can reference this task.

### P2-002 — Define the canonical Global Event Bus schema and reducers

Create the TypeScript-native event taxonomy, normalization rules, and reducer-friendly state slices that will power all live orchestration rendering.

**Scope**
- Add a new orchestration event module, e.g. `src/orchestration/orc-events.ts`, with strictly typed event unions.
- Normalize raw transport payloads into canonical bus events such as process lifecycle, graph lifecycle, agent message, tool call, tool result, worker status, stream warning, transport fault, and checkpoint status.
- Add helpers that classify events into `agent_interacting_with_user` vs `agent_interacting_with_computer` without losing low-level detail.
- Define reducer outputs for operator-friendly summaries: latest activity per agent, active overlays, live wave counts, transport health, and recent errors.
- Document which fields are required vs optional when upstream payloads are incomplete.

**Primary files**
- `src/orchestration/orc-events.ts` (new)
- `src/orchestration/orc-state.ts`
- `src/orchestration/orc-tracker.ts`
- `LANGEXTtracker.md`

**Done when**
- The bus contract is strict enough for TUI subscribers and tolerant enough for partial/malformed upstream events.

### P2-003 — Build the Python LangGraph runner bootstrap and execution envelope

Implement the Python-side background entry point that LangGraph/DeepAgents executions will run through when summoned by the TUI.

**Scope**
- Add a dedicated Python package or script entry point under the orchestration integration area for booting LangGraph and DeepAgents.
- Accept structured launch input from TypeScript (thread id, workspace, security policy, phase intent, checkpoint resume context).
- Emit lifecycle events for process start, graph initialization, checkpoint restore attempt, graph shutdown, and fatal exceptions.
- Ensure stdout is reserved for strict JSONL events and route non-JSON diagnostics to stderr.
- Document the environment contract required for local and future production invocation.

**Primary files**
- New Python orchestration runner module under the Orc integration surface
- `src/orchestration/orc-runtime.ts`
- `docs/orchestration/phase-2-execution-plan.md`
- `LANGEXTtracker.md`

**Done when**
- The Python runner can be spawned as a child process with a deterministic JSONL stdout contract.

### P2-004 — Implement JSONL telemetry emission for LangGraph and DeepAgents activity

Map Python-side graph and subagent activity into strict single-line JSON events that TypeScript can ingest in real time.

**Scope**
- Instrument the Python runner to emit events for graph node transitions, subagent creation, user-facing messages, tool calls, tool results, retries, interrupts, failures, and completion.
- Preserve raw upstream metadata in a namespaced field while still emitting the canonical `who/what/how/when` shape.
- Add transport sequence numbers and per-run correlation ids.
- Guarantee newline-delimited JSON with no pretty-printing and no multiline blobs.
- Define truncation/serialization policy for oversized payloads or binary-ish content.

**Primary files**
- Python runner telemetry module(s)
- Shared event-schema docs
- `LANGEXTtracker.md`

**Done when**
- TypeScript can depend on a strict JSONL telemetry stream even when subagents are active concurrently.

### P2-005 — Add a TypeScript child-process transport adapter for Orc

Create the TypeScript transport that spawns, supervises, and terminates the Python orchestration process.

**Scope**
- Add a dedicated transport adapter, e.g. `src/orchestration/orc-python-transport.ts`, using `child_process.spawn`.
- Stream stdout line-by-line, isolate stderr, and surface process exit information as canonical events.
- Support launch, cancel, shutdown, and resume semantics at the transport boundary.
- Guard against double-spawn, orphaned processes, zombie listeners, and unbounded buffering.
- Expose health metadata to the Orc runtime skeleton for future dashboard use.

**Primary files**
- `src/orchestration/orc-python-transport.ts` (new)
- `src/orchestration/orc-runtime.ts`
- `LANGEXTtracker.md`

**Done when**
- Orc has a reusable TS transport abstraction that can supervise the Python process without leaking process details into UI code.

### P2-006 — Implement incremental JSONL parsing and malformed-stream recovery

Make the transport resilient to chunked stdout delivery, broken lines, invalid JSON, and incomplete stream termination.

**Scope**
- Add an incremental line assembler that safely handles arbitrary chunk boundaries.
- Parse events defensively and emit structured transport warnings for malformed lines rather than crashing the orchestration runtime.
- Retain enough context for debugging (line preview, byte counts, sequence expectations, stderr correlation).
- Distinguish recoverable parse noise from fatal transport corruption.
- Add explicit timeout/idle policies for stalled streams.

**Primary files**
- `src/orchestration/orc-python-transport.ts`
- `src/orchestration/orc-events.ts`
- `LANGEXTtracker.md`

**Done when**
- Partial or malformed output produces observable fault events and graceful degradation instead of a hard crash.

### P2-007 — Implement the asynchronous Global Event Bus core

Create the decoupled event-dispatch layer that receives normalized transport events and fans them out to TUI subscribers and orchestration reducers.

**Scope**
- Add a typed bus implementation, likely on top of Node `EventEmitter`, with registration/unregistration helpers and fan-out safeguards.
- Preserve event ordering guarantees per run while allowing multiple subscriber classes.
- Separate canonical event publication from any specific TUI overlay or logging consumer.
- Add backpressure-conscious buffering or queue semantics for bursts of subagent/tool activity.
- Document bus lifecycle ownership: creation, reset, disposal, and replay expectations.

**Primary files**
- `src/orchestration/orc-event-bus.ts` (new)
- `src/orchestration/orc-events.ts`
- `LANGEXTtracker.md`

**Done when**
- TUI consumers can subscribe to orchestration events without depending on Python, JSONL parsing, or child-process APIs.

### P2-008 — Add Orc event logging and durable event-history persistence

Persist GEB activity into its own timestamped log so live telemetry remains decoupled from downstream rendering concerns.

**Scope**
- Extend orchestration storage to support append-only event-log files under `~/Vibe_Agent/logs/` or a dedicated Orc subdirectory.
- Write normalized events with timestamps and correlation metadata.
- Define log rotation, file naming, and recovery behavior for long-running sessions.
- Ensure event-log persistence failures do not take down the live bus.
- Document how future tooling can replay logs into the GEB for debugging or postmortem analysis.

**Primary files**
- `src/orchestration/orc-storage.ts`
- `src/orchestration/orc-io.ts`
- New event-log writer module
- `LANGEXTtracker.md`

**Done when**
- Every published orchestration event can also be captured in a durable timestamped log without coupling storage to rendering.

### P2-009 — Wire transport + GEB updates into Orc runtime lifecycle methods

Replace the Phase 1 placeholders so `launch()` and `resumeThread()` supervise live transport and bus wiring rather than immediately throwing.

**Scope**
- Update `OrcRuntimeSkeleton` or replace it with a real runtime implementation that creates transport, tracker, checkpoint, and bus dependencies together.
- Ensure `launch()` returns an initialized control-plane state plus live orchestration handles.
- Ensure `resumeThread()` loads tracker/checkpoint context before reattaching transport listeners.
- Guarantee deterministic cleanup on completion, failure, or user cancellation.
- Surface stable runtime-facing hooks for the command controller and dashboards.

**Primary files**
- `src/orchestration/orc-runtime.ts`
- `src/orchestration/orc-session.ts`
- `src/orchestration/orc-tracker.ts`
- `LANGEXTtracker.md`

**Done when**
- Orc launch/resume paths are real supervision flows rather than scaffolding-only placeholders.

### P2-010 — Add event-driven control-plane state reduction

Translate the live event stream into durable control-plane state updates for tracker snapshots, dashboards, and future resume logic.

**Scope**
- Define reducers that fold canonical events into `OrcControlPlaneState` updates.
- Update wave state, worker results, latest checkpoint info, user-facing messages, and transport health fields from events instead of ad hoc mutation.
- Ensure transient UI-only telemetry and durable orchestration truth remain intentionally separated.
- Clarify how state reduction interacts with Phase 3 checkpoint persistence.
- Add reduction rules for cancellations, retries, and ambiguous completion states.

**Primary files**
- `src/orchestration/orc-state.ts`
- `src/orchestration/orc-tracker.ts`
- `src/orchestration/orc-events.ts`
- `LANGEXTtracker.md`

**Done when**
- Tracker snapshots become the reduced summary of the live event stream rather than manual placeholders.

### P2-011 — Render friendly operator-facing summaries from raw agent telemetry

Create summarization adapters that transform low-level LangGraph/subagent events into stable, human-readable strings and view models.

**Scope**
- Add presentation helpers for messages like “Agent_Mechanic performed web_search” or “Agent_Orc responded to the user”.
- Preserve raw details for drill-down while presenting concise default labels in dashboards and overlays.
- Standardize tone, severity, and wording for success, warning, blocked, and failed states.
- Ensure summaries degrade gracefully when upstream metadata is incomplete.
- Keep presentation logic separate from bus publication and transport parsing.

**Primary files**
- `src/orchestration/orc-tracker.ts`
- New presentation helper module(s)
- `LANGEXTtracker.md`

**Done when**
- The TUI can render human-friendly telemetry without embedding LangGraph-specific event semantics everywhere.

### P2-012 — Introduce a TUI telemetry subscriber layer for dashboards, overlays, and panes

Connect the GEB to the existing multi-pane/multi-overlay TUI architecture through dedicated subscriber adapters.

**Scope**
- Add subscriber glue that maps bus events into TUI state updates rather than letting view components subscribe directly to transport internals.
- Reserve specific overlay/pane responsibilities: orchestration dashboard, subagent activity, transport health, and event log tail.
- Ensure multiple overlays can open/close independently without losing the underlying event stream.
- Prevent rendering churn from noisy event bursts by batching or coalescing updates where appropriate.
- Document view lifecycle behavior when a run completes or the user switches runtimes.

**Primary files**
- TUI orchestration view/controller modules under `src/`
- `src/orchestration/orc-event-bus.ts`
- `src/orchestration/orc-tracker.ts`
- `LANGEXTtracker.md`

**Done when**
- Orc telemetry reaches the TUI through dedicated subscribers that are decoupled from the Python process.

### P2-013 — Add subagent activity surfaces and overlay management rules

Support multiple live subagent displays and activity panes without choking the renderer.

**Scope**
- Define the identity model for subagent overlays/panels keyed by run, wave, and agent id.
- Add open/update/close rules for subagent windows as agents spawn and complete.
- Decide how long completed/failed agents remain visible and how they collapse into summaries.
- Ensure overlay stacking and pane updates remain non-modal and deterministic.
- Document how hidden or backgrounded overlays still receive event updates safely.

**Primary files**
- Relevant TUI overlay/pane modules
- `src/orchestration/orc-events.ts`
- `LANGEXTtracker.md`

**Done when**
- Multiple subagent activity surfaces can coexist and stay in sync with the bus.

### P2-014 — Implement transport and orchestration fault handling

Handle process crashes, broken pipes, startup failures, cancellation, and ambiguous terminal states gracefully.

**Scope**
- Emit canonical events for startup failure, transport disconnect, non-zero exit, SIGTERM/SIGINT shutdown, and user cancellation.
- Ensure the bus, tracker, and TUI all converge on a consistent terminal state.
- Prevent repeated error storms if the Python process dies while listeners remain attached.
- Record operator-visible remediation hints for common failures.
- Document which failures are retryable in Phase 2 vs deferred to Phase 3 recovery workflows.

**Primary files**
- `src/orchestration/orc-python-transport.ts`
- `src/orchestration/orc-runtime.ts`
- `src/orchestration/orc-tracker.ts`
- `LANGEXTtracker.md`

**Done when**
- Broken execution paths terminate predictably and inform both operators and future recovery logic.

### P2-015 — Implement debug/diagnostic instrumentation for outside engineers

Add the minimum durable diagnostics needed for future implementation and support work without polluting the default operator experience.

**Scope**
- Define a debug mode that records richer transport diagnostics, raw-event mirrors, and parser warnings.
- Keep debug outputs opt-in and separate from the friendly default dashboard.
- Document where to find Python stderr, event logs, tracker snapshots, and runtime metadata.
- Provide an engineer-readable troubleshooting section covering malformed JSONL, missing runners, and stalled streams.
- Ensure diagnostics are safe to leave enabled during local development.

**Primary files**
- `docs/orchestration/phase-2-execution-plan.md`
- Debug/logging modules under `src/orchestration/`
- `README.md`
- `LANGEXTtracker.md`

**Done when**
- Outside engineers can inspect transport and event-bus behavior without reverse-engineering the runtime.

### P2-016 — Wire security and approval events into the GEB contract

Make sure the Phase 1 security-policy abstractions can publish approval-required and blocked-command states through the same event system.

**Scope**
- Map `OrcSecurityEvent` and future command-interceptor results into canonical bus events.
- Distinguish informational security notices from blocking approval states.
- Surface approval-needed events to the TUI without coupling UI components to specific tool implementations.
- Ensure these events are persisted in the timestamped event log.
- Document how security events affect worker-status and run-status summaries.

**Primary files**
- `src/orchestration/orc-security.ts`
- `src/orchestration/orc-events.ts`
- `src/orchestration/orc-tracker.ts`
- `LANGEXTtracker.md`

**Done when**
- Security enforcement outcomes travel through the same decoupled telemetry pipeline as other orchestration events.

### P2-017 — Prepare the tracker/checkpoint bridge for Phase 3 durability work

Lay the non-invasive groundwork needed so Phase 3 checkpointing and rewind features can consume Phase 2 telemetry cleanly.

**Scope**
- Annotate which event types should create checkpoint-worthy state transitions.
- Extend checkpoint metadata shapes only as needed to record transport/run correlation and latest durable event offsets.
- Avoid implementing full rewind/recovery behavior, but document the contract needed for it.
- Ensure tracker snapshots preserve enough reduced state for future resume operations.
- Update the design-compliance mapping in `LANGEXTtracker.md` for DM-05 handoff readiness.

**Primary files**
- `src/orchestration/orc-checkpoints.ts`
- `src/orchestration/orc-tracker.ts`
- `LANGEXTtracker.md`

**Done when**
- Phase 3 durability work has a clean bridge from live Phase 2 telemetry and state reduction.

### P2-018 — Publish Phase 2 engineering documentation and operator handoff notes

Document the finished Phase 2 architecture for future implementers, reviewers, and operators.

**Scope**
- Update `README.md` with the new Phase 2 architecture guide.
- Expand this document into a stable orientation guide once implementation lands.
- Document the Python runner, JSONL transport, GEB, event-log persistence, TUI subscriber pattern, and troubleshooting guidance.
- Add a completion checklist tied back to Phase 2 exit criteria and design mandates.
- Ensure final tracker entries include validation evidence, carryover items, and explicit sign-off.

**Primary files**
- `README.md`
- `docs/orchestration/phase-2-execution-plan.md`
- `LANGEXTtracker.md`

**Done when**
- An outside engineer can trace Phase 2 from summon path to Python transport to GEB to TUI rendering and logs.

## Suggested dependency map

- `P2-001` → prerequisite for `P2-002`, `P2-003`, `P2-005`
- `P2-002` → prerequisite for `P2-006`, `P2-007`, `P2-010`, `P2-011`, `P2-016`
- `P2-003` → prerequisite for `P2-004`, `P2-005`
- `P2-004` + `P2-005` → prerequisite for `P2-006`, `P2-007`, `P2-009`
- `P2-007` + `P2-010` → prerequisite for `P2-012`, `P2-013`, `P2-014`
- `P2-008`, `P2-014`, `P2-016`, `P2-017` can progress once the core event contract exists
- `P2-018` closes the phase after the implementation backlog is complete

## Phase 2 exit checklist

Phase 2 is ready to close only when all of the following are true:

- Orc can launch or resume a LangGraph-backed run through a supervised Python child process.
- Python emits strict JSONL telemetry over stdout and TypeScript ingests it incrementally.
- A typed GEB exists and is the only event source TUI orchestration components subscribe to.
- Event logging is durable, timestamped, and independent from rendering.
- Friendly operator-facing summaries exist for agent/user and agent/computer activity.
- Multiple overlays/panes can react to live telemetry without coupling to transport internals.
- Stream breakage, malformed events, cancellations, and process failures are handled gracefully.
- `LANGEXTtracker.md` contains completed Phase 2 ledger rows, validation notes, risk updates, next-session handoff notes, and sign-off evidence.
