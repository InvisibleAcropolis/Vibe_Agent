# Orchestration System

An event-driven, multi-graph AI orchestration framework for deterministic, resumable, security-gated multi-agent execution. It coordinates a guild of 9 specialized subagents through structured contracts, durable checkpointing, and a Python child-process transport layer.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Directory Structure](#directory-structure)
3. [Core Concepts](#core-concepts)
   - [Lifecycle Phases](#lifecycle-phases)
   - [Threads & Checkpoints](#threads--checkpoints)
   - [Orchestration Contracts](#orchestration-contracts)
   - [Control Plane State](#control-plane-state)
4. [The Orchestration Graph](#the-orchestration-graph)
5. [The Agent Graph](#the-agent-graph)
6. [Guild Subagents](#guild-subagents)
7. [Python Transport Layer](#python-transport-layer)
8. [Event System](#event-system)
9. [Memory & Persistence](#memory--persistence)
10. [Security Framework](#security-framework)
11. [RPC Bridge & Curator](#rpc-bridge--curator)
12. [TUI Integration](#tui-integration)
13. [Runtime Coordination](#runtime-coordination)
14. [Configuration & Bootstrap](#configuration--bootstrap)
15. [Public API](#public-api)
16. [Testing](#testing)
17. [Related Documentation](#related-documentation)

---

## Architecture Overview

The orchestration system is organized as a layered stack. Each layer has a single ownership boundary; no layer reaches past its immediate neighbor.

```
┌─────────────────────────────────────────────────────────┐
│                   OrcRuntimeSkeleton                    │  ← Public entry point
│            (orc-runtime.ts + orc-runtime/)              │
├─────────────────────────────────────────────────────────┤
│          Dual-Graph Execution Engine                    │
│  ┌──────────────────┐   ┌─────────────────────────┐    │
│  │  orc-graph.ts    │   │  graph/orc_agent.ts      │    │
│  │  (6-node ORC     │   │  (5-node planning &      │    │
│  │   state machine) │   │   delegation cycle)      │    │
│  └──────────────────┘   └─────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│          Guild Subagents (graph/subagents/)             │
│  architect · scout · mechanic · inquisitor · warden    │
│  alchemist · scribe · archivist · vibe_curator         │
├─────────────────────────────────────────────────────────┤
│          Python Transport (orc-python-transport/)      │
│     stdin JSON ─► Python runner ─► stdout JSONL        │
├─────────────────────────────────────────────────────────┤
│          Event System (orc-event-bus.ts + orc-events/) │
│     Publish ─► Normalize ─► Reduce ─► Persist / TUI   │
├─────────────────────────────────────────────────────────┤
│          Durable State (orc-tracker, orc-checkpoints)  │
│              ~/.vibe/tracker/ · ~/.vibe/ ...            │
└─────────────────────────────────────────────────────────┘
```

### External Integration Points

| Direction | Module | What it provides |
|-----------|--------|-----------------|
| Inbound config | `src/app-config.ts` | `orchestration` block (security policy, concurrency, etc.) |
| Inbound storage paths | `src/durable/durable-paths.ts` | `~/.vibe/` directory helpers |
| Outbound — dashboard | `src/command/command-overlay-service.ts` | `openOrcDashboard()` renders tracker view model |
| Outbound — panel | `src/components/orchestration-status-panel.ts` | Overlay component binding to tracker state |
| Outbound — public API | `src/index.ts` | Memory store, curator, and rendering exports |

---

## Directory Structure

```
src/orchestration/
│
│  ── Core modules ──────────────────────────────────────────────
├── orc-runtime.ts            Entry point. OrcRuntimeSkeleton — launch, resume, dispose, getSession
├── orc-session.ts            OrcSession handle interface and OrcSessionHandle implementation
├── orc-state.ts              OrcControlPlaneState schema, OrcLifecyclePhase, all state types
├── orc-io.ts                 I/O contracts: LaunchOrcRequest/Response, ResumeOrcThreadRequest,
│                              OrcCanonicalEventEnvelope, OrcPythonRunnerSpawnContract
├── orc-graph.ts              6-node ORC state machine (route→dispatch→verify→complete / failed)
├── orc-security.ts           OrcSecurityPolicy, defaults, mergeOrcSecurityPolicy, event helpers
├── orc-tracker.ts            OrcTracker interface, FileSystemOrcTracker, dashboard view model
├── orc-checkpoints.ts        OrcCheckpointStore interface, filesystem implementation, manifests
├── orc-storage.ts            OrcStorage interface — listArtifacts / listLogs
├── orc-event-bus.ts          Global in-memory pub/sub event bus (one per run)
├── orc-event-log.ts          Durable append-only event log to ~/.vibe/logs/orchestration/
├── orc-presentation.ts       presentOrcTrackerSummary() — converts state to UI summaries
├── orc-debug.ts              Debug artifact collection helpers
├── contracts.ts              StructuralBlueprint, ReconReport, FailureDossier — TypeScript definitions
│                              and validateOrcContractPayload() validator
├── contracts.py              Pydantic counterparts for the same three contracts (Python runner side)
├── bootstrap.ps1             Windows psmux installer (ConPTY terminal multiplexer)
│
│  ── orc-runtime/ ──────────────────────────────────────────────
├── orc-runtime/
│   ├── state-bootstrap.ts    buildLaunchInput(), createInitialState(), createResumeState()
│   ├── transport-supervisor.ts OrcRuntimeTransportSupervisor — starts, binds, and publishes transport events
│   ├── session-hooks.ts      createRuntimeSessionHooks() — cancel / shutdown / health / snapshot
│   ├── persistence.ts        OrcRuntimePersistenceCoordinator — debounced tracker snapshots
│   ├── thread-context-factory.ts createThreadContext() — assembles OrcRuntimeThreadContext
│   ├── cleanup.ts            cleanupThread() / cleanupExistingThread() — graceful teardown
│   ├── types.ts              OrcRuntime, OrcRuntimeAdapters, OrcRuntimeThreadContext, OrcSessionFactory
│   └── index.ts              Re-exports for orc-runtime.ts consumers
│
│  ── graph/ ────────────────────────────────────────────────────
├── graph/
│   ├── orc_agent.ts          5-node planning/delegation agent graph (plan→delegate→evaluate→scribe→complete)
│   └── subagents/
│       ├── registry.ts       ORC_GUILD_SUBAGENT_REGISTRY — keyed record of all 9 subagent configs
│       ├── router.ts         OrcSubagentRouter — task-type routing to guild members
│       ├── middleware.ts     subagent_dispatch_guard and middleware chain enforcement
│       ├── tool_policy.ts    Per-subagent tool allowlist enforcement
│       ├── types.ts          SubagentConfig, GuildSubagentRole, OrcTaskType, SpawnSubagentTaskRequest/Result
│       ├── errors.ts         Subagent-specific error types and tool policy violation errors
│       ├── architect.ts      Architect config (read/search/write/scaffold/typegen)
│       ├── scout.ts          Scout config (index/search/read/lsp)
│       ├── mechanic.ts       Mechanic config (write/execute) + verify/retry subgraph
│       ├── inquisitor.ts     Inquisitor config (read/search/lsp) + validation subgraph
│       ├── warden.ts         Warden config (read/lsp) — security and policy enforcement
│       ├── alchemist.ts      Alchemist config — experimentation and transformation
│       ├── scribe.ts         Scribe config (write) — docs, docstrings, README updates
│       ├── archivist.ts      Archivist config (read/search) + context retrieval pipeline
│       ├── vibe_curator.ts   Vibe Curator config — brand/tone alignment
│       └── index.ts          Public exports for router, registry, and types
│
│  ── orc-events/ ───────────────────────────────────────────────
├── orc-events/
│   ├── types.ts              OrcBusEventKind union (10 kinds) and all typed event shapes
│   ├── normalization.ts      Raw transport telemetry → OrcBusEvent normalization
│   ├── control-plane-reducer.ts reduceOrcControlPlaneEvent() — bus events → OrcControlPlaneState
│   ├── bus-reducer.ts        OrcEventReducerState — transient UI-facing reducer
│   ├── security-events.ts    Security event normalization helpers
│   ├── summary.ts            Event summary formatting for UI
│   ├── transport-policy.ts   Fault boundary rules and transport recovery policy
│   └── index.ts              Re-exports
│
│  ── orc-python-transport/ ─────────────────────────────────────
├── orc-python-transport/
│   ├── orc-python-child-process-transport.ts  Spawns Python runner; manages stdin/stdout/stderr
│   ├── spawn-contract.ts     OrcPythonRunnerSpawnContract — process launch descriptor
│   ├── stream_parser.ts      JsonLfStreamParser<T> — LF-delimited JSONL parser with quarantine
│   ├── line-assembler.ts     Low-level byte chunk → complete line assembly
│   ├── protocol-parser.ts    Maps Python telemetry frames → OrcCanonicalEventEnvelope
│   ├── timeout-monitor.ts    Heartbeat watcher — stall detection
│   ├── timeout-policy.ts     Timeout threshold configuration
│   ├── parse-failure-policy.ts Decides log / quarantine / fatal on JSON parse errors
│   ├── policy-results.ts     Result types for parse-failure-policy
│   ├── health-store.ts       OrcPythonTransportHealthStore — tracks transport health summary
│   ├── transport-supervisor.ts Coordinates start/stop lifecycle events for the child process
│   ├── types.ts              OrcPythonTransportHealth, OrcPythonTransportLifecycleEvent
│   └── index.ts              Re-exports
│
│  ── memory/ ───────────────────────────────────────────────────
├── memory/
│   ├── orc-memory-store.ts   OrcMemoryStore implementation — filesystem-backed record storage
│   ├── retrieval-api.ts      retrieveOrcMemory() — structured retrieval interface
│   ├── types.ts              4 record kinds: subagent_findings, intermediate_artifacts,
│   │                          completion_status, handoff_summary
│   ├── fs-safe.ts            Filesystem-safe key name encoding
│   └── index.ts              Re-exports (OrcMemoryStore is part of the public API)
│
│  ── bridge/ ───────────────────────────────────────────────────
├── bridge/
│   ├── curator.ts            RpcEventCurator — per-pane agent state aggregation
│   ├── renderer.ts           renderCuratorDashboardFrame() — ASCII dashboard renderer
│   ├── rpc_launcher.ts       RPC process spawn contracts (RpcCommandEnvelope / RpcTelemetryEnvelope)
│   └── stream_parser.ts      JsonLfStreamParser for RPC telemetry streams
│
│  ── orc-tui-subscriber/ ───────────────────────────────────────
├── orc-tui-subscriber/
│   ├── create-subscriber.ts  createOrcTuiTelemetrySubscriber() — wires event bus → TUI state
│   ├── telemetry-reduction.ts Aggregates events into TuiTelemetryState
│   ├── subagent-surfaces.ts  Per-subagent pane surface lifecycle
│   ├── event-buffer.ts       Buffered event delivery for terminal rendering
│   ├── view-state.ts         OrcTuiViewState — combined TUI presentation state
│   ├── interaction-state.ts  Focus and pending action state
│   ├── types.ts              All TUI state types
│   └── index.ts              Re-exports
│
│  ── errors/ ───────────────────────────────────────────────────
├── errors/
│   └── unified-error.ts      Unified error strategy — correlation context propagation
│
│  ── terminal/ ─────────────────────────────────────────────────
├── terminal/
│   ├── session_manager.ts    Terminal session lifecycle (psmux panes) — ensureCore / recover / shutdown
│   └── pane_orchestrator.ts  TerminalPaneOrchestrator — maps subagents to panes
│
└── python/
    └── orc_runner/           Python child process (orc_langgraph runner, v0.2.0)
        ├── __main__.py       Entry point — reads stdin JSON, emits JSONL to stdout
        └── runner.py         Core runner logic and telemetry emission
```

---

## Core Concepts

### Lifecycle Phases

Every orchestration thread moves through a strict ordered state machine:

```
idle → bootstrapping → planning → dispatching → executing → verifying → checkpointed
                                                                              │
                                                            ┌─────────────────┤
                                                            ▼                 ▼
                                                        completed     failed / cancelled
```

| Phase | Description |
|-------|-------------|
| `idle` | No active run |
| `bootstrapping` | Runtime created, transport about to start |
| `planning` | Agent graph generating plan and todo decomposition |
| `dispatching` | Subagents being assigned work items |
| `executing` | Subagents actively executing tasks |
| `verifying` | Results being validated (Inquisitor/Warden subgraphs) |
| `checkpointed` | Durable snapshot saved; ready to resume or continue |
| `completed` | Successful terminal state |
| `failed` | Error terminal state |
| `cancelled` | User-initiated cancellation |

Source: `orc-state.ts:3`

---

### Threads & Checkpoints

**Thread** — a unique execution context identified by `threadId` (`orc-thread-<uuid>`). A thread persists across multiple runs and checkpoints.

**Checkpoint** — a durable snapshot saved after key phase transitions. Identified by `checkpointId`. Enables resume from a known-good boundary.

**Tracker** — `FileSystemOrcTracker` persists `OrcControlPlaneState` snapshots at:
```
~/.vibe/tracker/[encodeURIComponent(threadId)]--[encodeURIComponent(checkpointId)].json
```

**Checkpoint manifest** — `OrcCheckpointStore` maintains a manifest per thread listing all checkpoint IDs, sequence numbers, and artifact bundle references.

**Resume flow**: `resumeThread()` → loads checkpoint → restores `OrcControlPlaneState` → creates fresh `runCorrelationId` → spawns new Python transport → continues from saved phase.

---

### Orchestration Contracts

Contracts are strictly validated structured payloads that flow between orchestration nodes. Violation of any contract routes the run to the `contract_error` node.

Defined in `contracts.ts` (TypeScript) and `contracts.py` (Pydantic). Validated via `validateOrcContractPayload(model, payload)`.

#### StructuralBlueprint

Output of the **Architect** subagent. Describes the architectural design for a task.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `objective` | `string` | Yes | Goal statement (non-empty) |
| `scope` | `string[]` | Yes | Non-empty list of scope items |
| `constraints` | `string[]` | Yes | Non-empty list of constraints |
| `deliverables` | `string[]` | Yes | Non-empty list of deliverables |
| `riskRegister` | `string[]` | No | Optional list of identified risks |
| `envelope` | `OrcContractEnvelope` | No | Status, provenance metadata |

#### ReconReport

Output of verification/analysis subagents. Describes findings with precise file-line coordinates.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `summary` | `string` | Yes | High-level finding summary |
| `findings` | `string[]` | Yes | Non-empty findings list |
| `recommendations` | `string[]` | Yes | Non-empty recommendations list |
| `coordinates` | `ReconCoordinate[]` | Yes | **Strictly ordered** file/line references |
| `evidenceLinks` | `string[]` | No | Optional evidence links |
| `envelope` | `OrcContractEnvelope` | No | Status, provenance metadata |

`ReconCoordinate` fields: `absoluteFilePath` (must start with `/`), `lineStart` (positive int), `lineEnd` (positive int, `>= lineStart`), `semanticChangeTarget` (non-empty string). Coordinates must be sorted ascending by `absoluteFilePath → lineStart → lineEnd → semanticChangeTarget`.

#### FailureDossier

Output when a subagent workflow fails. Documents what happened and next steps.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `failureCode` | `string` | Yes | Machine-readable failure identifier |
| `failureSummary` | `string` | Yes | Human-readable summary |
| `actionsTaken` | `string[]` | Yes | Non-empty list of remediation actions taken |
| `nextActions` | `string[]` | No | Optional planned next steps |
| `envelope` | `OrcContractEnvelope` | No | Status, provenance metadata |

#### OrcContractEnvelope (shared)

```typescript
interface OrcContractEnvelope {
  status?: "pass" | "fail" | "pending";
  passed?: boolean;
  metadata?: Record<string, unknown>;
  provenance?: {
    agentName?: string;
    timestamp?: string;
    correlationId?: string;
  };
}
```

---

### Control Plane State

`OrcControlPlaneState` (`orc-state.ts:159`) is the central reduced snapshot serialized for durable storage and consumed by the TUI, tracker, and checkpoint system.

```typescript
interface OrcControlPlaneState {
  threadId: string;
  checkpointId?: string;
  phase: OrcLifecyclePhase;
  project: OrcProjectContext;       // projectId, projectRoot, branchName, etc.
  securityPolicy?: OrcSecurityPolicy;
  messages: OrcOrchestratorMessage[];
  securityEvents?: OrcSecurityEvent[];
  activeWave?: OrcActiveExecutionWave;
  workerResults: OrcParallelWorkerResult[];
  verificationErrors: OrcVerificationError[];
  checkpointMetadata: OrcCheckpointMetadataSummary;
  transportHealth: OrcReducedTransportHealth;
  terminalState: OrcTerminalStateSummary;
  lastUpdatedAt: string;
}
```

Ownership rule: transport events are append-only facts; `OrcControlPlaneState` is derived from them by the reducer. The TUI consumes this state — it does not write to it.

---

## The Orchestration Graph

**File**: `orc-graph.ts`

A 6-node directed graph controlling the high-level orchestration lifecycle. Built as a deterministic state machine with middleware support.

```
         ┌─────────────────────────────────┐
         │                                 ▼
       route ──► dispatch ──► verify ──► complete
                    │             │
                    ▼             ▼
             contract_error    failed
```

### Nodes

| Node | Responsibility |
|------|---------------|
| `route` | Selects the target guild member (subagent role) and prepares the handoff contract payload |
| `dispatch` | Executes the selected subagent task; collects the `ReconReport` |
| `verify` | Validates dispatch results; decides: re-route (continue), `complete`, or `failed` |
| `complete` | Finalizes the orchestration run with a completion summary |
| `failed` | Terminal failure state — emits `FailureDossier` |
| `contract_error` | Validation failure branch — catches malformed contracts before they reach workers |

### State: `OrcMasterState`

```typescript
interface OrcMasterState {
  next: OrcGraphNodeId;
  routing: OrcRoutingState;             // Guild member routing history (chain of custody)
  contractPayload: OrcContractPayloadHandoff;  // Structured data passed between nodes
  activeGuildMember: OrcActiveGuildMember;     // Current executor identity
  reconReport?: Record<string, unknown>;
  archivistContext?: OrcArchivistContextInjection;
}
```

### Middleware

The graph supports a deterministic middleware chain. The built-in `subagent_dispatch_guard` runs before every dispatch. Callers can inject additional middleware through the graph factory options.

---

## The Agent Graph

**File**: `graph/orc_agent.ts`

A 5-node planning and delegation cycle. This graph operates at a higher level than the ORC graph — it plans, decomposes work into todos, delegates to subagents, and evaluates results before completing.

```
plan ──► delegate ──► evaluate ──► scribe ──► complete
             ▲            │
             └────────────┘ (continue if not complete)
```

### Nodes

| Node | Responsibility |
|------|---------------|
| `plan` | Generates a plan summary and decomposes it into `OrcTodoItem[]` (mandatory before delegation) |
| `delegate` | Dispatches todos to subagents; requires a durable planning snapshot before proceeding |
| `evaluate` | Assesses results; decides `continue` (re-route to `plan`) or `complete` |
| `scribe` | Final documentation/README updates — **must succeed** before the run can complete |
| `complete` | Emits final summary and transitions to terminal state |

### State: `OrcAgentState`

```typescript
interface OrcAgentState {
  todos: OrcTodoItem[];                   // Mandatory decomposition; enforced before delegation
  iteration: number;                      // Loop counter (max iterations enforced)
  planningSnapshotRevision: number;       // Durable snapshot versioning
}
```

**Invariants enforced by the graph:**
- `delegate` refuses to run unless `plan` has produced at least one todo item
- `evaluate` increments `iteration` and blocks at `maxIterations`
- `scribe` must complete successfully; any scribe failure prevents `complete`

---

## Guild Subagents

**Files**: `graph/subagents/`

Nine specialized subagents, each with a defined role, toolset, and task type contract. All are registered in `registry.ts` under `ORC_GUILD_SUBAGENT_REGISTRY`.

### Registry

| Role | Display Name | Toolset | Task Types | Constraints |
|------|--------------|---------|-----------|-------------|
| `architect` | Architect | read, search, write, scaffold, typegen | read_analysis, general | Structural blueprints only — no implementation, no refactors, no env mutations |
| `scout` | Scout | index, search, read, lsp | semantic_search, read_analysis | Codebase indexing and semantic search only |
| `mechanic` | Mechanic | write, execute | execution, read_analysis, general | Test harnesses, failure triage, verify/retry loop |
| `inquisitor` | Inquisitor | read, search, lsp | read_analysis, semantic_search, general | Code analysis, diagnostics, validation subgraph |
| `warden` | Warden | read, lsp | read_analysis, general | Security and policy enforcement; remediation routing |
| `alchemist` | Alchemist | (custom) | execution, general | Experimentation and transformation tasks |
| `scribe` | Scribe | write | general | Documentation: docs, docstrings, README updates |
| `archivist` | Archivist | read, search | read_analysis, general | Context injection and memory retrieval pipeline |
| `vibe_curator` | Vibe Curator | (custom) | general | Brand/tone alignment and telemetry curation |

### Dispatch Flow

```
OrcSubagentRouter.route(taskType)
      │
      ▼
middleware chain (subagent_dispatch_guard + custom)
      │
      ▼
SpawnSubagentTaskRequest → subagent process
      │
      ▼
RoutedSubagentSession { sessionId, correlationId, pid, paneId }
      │
      ▼
SpawnSubagentTaskResult { output, sessionMetadata }
```

### Tool Policy

`tool_policy.ts` enforces per-subagent tool allowlists at dispatch time. Any tool call that violates the subagent's declared `toolset` raises a `SubagentToolPolicyViolation` error before the call is executed.

---

## Python Transport Layer

**Files**: `orc-python-transport/`

The Python runner is a child process spawned by the TypeScript runtime. Communication uses a strict protocol: JSON via stdin, JSONL via stdout, and human-readable text via stderr.

### Spawn Contract

```typescript
interface OrcPythonRunnerSpawnContract {
  command: string;
  args: string[];
  cwd: string;
  stdinPayload: OrcRunnerLaunchInput;   // serialized as JSON
  stdoutProtocol: "jsonl";
  stderrProtocol: "diagnostic_text";
}
```

### OrcRunnerLaunchInput (stdin)

```python
@dataclass
class OrcRunnerLaunchInput:
  thread_id: str
  project_root: str
  workspace_root: str
  phase_intent: str
  security_policy: SecurityPolicySnapshot
  resume: ResumeContext
  checkpoint_id: str | None
  run_correlation_id: str | None
  graph_name: str = "orc_langgraph"     # default graph implementation
```

### Stream Parsing

`JsonLfStreamParser<T>` (`stream_parser.ts`) handles the stdout JSONL stream:
- Assembles arbitrary UTF-8 byte chunks into complete LF-delimited lines
- Validates each parsed frame against an optional predicate
- Quarantines malformed JSON frames (default: 128 frames max)
- Enforces buffer limits (default: 1 MB) — overflow triggers `transport_stdout_overflow`

Parse failure policy (configurable per deployment):
- `log` — record and continue
- `quarantine` — isolate frame, continue stream
- `fatal` — emit `transport.fault` and terminate

### Health Monitoring

`timeout-monitor.ts` watches for heartbeat stalls. If no heartbeat is received within the configured threshold, a `transport_stall_timeout` fault is emitted.

`health-store.ts` maintains a reduced `OrcPythonTransportHealth` summary including `status`, `consecutiveWarnings`, `consecutiveFaults`, `lastRemediationHint`, and `retryability`.

### Transport Fault Codes

| Code | Meaning |
|------|---------|
| `transport_corrupt_stream` | Unrecoverable JSONL corruption |
| `transport_ready_timeout` | Process did not signal readiness in time |
| `transport_stall_timeout` | No heartbeat received within threshold |
| `transport_stdout_overflow` | Buffer limit exceeded |
| `transport_startup_failure` | Process failed to start |
| `transport_disconnect` | Unexpected disconnect |
| `transport_broken_pipe` | Pipe closed unexpectedly |
| `transport_non_zero_exit` | Non-zero exit code |
| `transport_signal_shutdown` | Terminated by signal |
| `transport_user_cancellation` | Cancelled by user |
| `transport_ambiguous_terminal_state` | Exit state could not be determined |

---

## Event System

**Files**: `orc-event-bus.ts`, `orc-events/`

### Event Bus

`OrcEventBus` (`orc-event-bus.ts`) is an in-memory pub/sub broker. One bus is created per run and lives for the run's duration.

```typescript
interface OrcEventBus {
  subscribe(handler, options): OrcEventBusSubscription;
  publish(event): OrcEventBusPublishReceipt;
  reset(options): void;     // clears queues for next run
  dispose(): void;          // terminal cleanup
  getSnapshot(): OrcEventBusSnapshot;
}
```

Subscribers filter by `runCorrelationId`, `threadId`, and `OrcBusEventKind`. Async handlers are supported with overflow management.

### Event Kinds (10 total)

| Kind | Description |
|------|-------------|
| `process.lifecycle` | Process spawn / ready / exit / restart |
| `graph.lifecycle` | Graph node transitions — declared, running, paused, completed, failed |
| `agent.message` | Agent text output (partial or final streams) |
| `tool.call` | Tool invocation — includes `approvalRequired` flag |
| `tool.result` | Tool completion — succeeded / failed / cancelled / timed_out |
| `worker.status` | Worker queue/run/completion status |
| `stream.warning` | Transport parse warnings (recoverable noise) |
| `transport.fault` | Transport degradation or failure |
| `checkpoint.status` | Checkpoint capture / restore / failure |
| `security.approval` | Approval required for a security event |

Source: `orc-events/types.ts:13`

### Canonical Event Envelope

Every event flowing through the system is wrapped in `OrcCanonicalEventEnvelope<TRawPayload>`:

```typescript
interface OrcCanonicalEventEnvelope<TRawPayload> {
  origin: OrcEventOriginMetadata;      // who emitted this + when
  who: OrcEventActorMetadata;          // actor identity (agent, worker, system)
  what: OrcEventActionDescriptor;      // category, name, severity, status
  how: OrcEventDeliveryDescriptor;     // channel, environment, tool metadata
  when: string;                        // ISO timestamp
  rawPayload?: { namespace: string; payload: TRawPayload };
}
```

### Reducer Flow

```
OrcBusEvent
    │
    ▼
reduceOrcControlPlaneEvent()         ← control-plane-reducer.ts
    │
    ▼
OrcControlPlaneState (updated)
    │
    ├──► OrcTracker.save()           ← durable snapshot
    └──► session.updateState()       ← live session + TUI
```

---

## Memory & Persistence

### Memory Store

**Files**: `memory/`

`OrcMemoryStore` provides structured persistent storage for subagent findings, artifacts, and handoff summaries.

#### Record Kinds

| Kind | Type | Description |
|------|------|-------------|
| `subagent_findings` | `OrcSubagentFindingsRecord` | Items with id, summary, evidence[], confidence (low/medium/high) |
| `intermediate_artifacts` | `OrcIntermediateArtifactsRecord` | Tool outputs, files, commands, notes with timestamps |
| `completion_status` | `OrcCompletionStatusRecord` | Status (completed/failed/cancelled/timed_out) + reason + timestamp |
| `handoff_summary` | `OrcHandoffSummaryRecord` | Summary + nextActions + planDelta (completed/pending items) |

Retrieval: `retrieveOrcMemory(request: OrcMemoryRetrievalRequest)` in `retrieval-api.ts`.

### Durable Storage Layout

All durable state lives under `~/.vibe/`:

| Path | Contents |
|------|---------|
| `~/.vibe/tracker/` | Tracker snapshots (`OrcControlPlaneState` as JSON) |
| `~/.vibe/artifacts/` | Execution artifacts keyed by thread + wave |
| `~/.vibe/logs/orchestration/event-log/` | Append-only durable event logs |
| `~/.vibe/plans/` | Planning artifacts |
| `~/.vibe/roadmaps/` | Roadmap artifacts |
| `~/.vibe/research/` | Research artifacts |
| `~/.vibe/sessions/` | Session metadata |

**Artifact file naming convention**:
```
[project]__[phase]__[task]__[thread]__[wave]__[timestamp]__[kind].[ext]
```

### Checkpoint Store

`OrcCheckpointStore` (`orc-checkpoints.ts`) manages checkpoints per thread:

- `loadManifest(threadId)` — retrieves checkpoint history and latest checkpoint ID
- `loadCheckpoint(query)` — loads specific checkpoint metadata by thread + checkpoint ID
- `listCheckpoints(threadId)` — enumerates all checkpoint IDs for a thread
- `saveCheckpoint(write)` — persists new checkpoint metadata and updates the manifest

Checkpoint metadata (`OrcCheckpointMetadata`) includes sequence number, phase, creation timestamp, state snapshot reference, artifact bundle IDs, rewind target IDs, and optional `resumeData` for phase-specific recovery.

---

## Security Framework

**File**: `orc-security.ts`

### Policy Schema

```typescript
interface OrcSecurityPolicy {
  allowedWorkingDirectories: string[];
  blockedCommandPatterns: string[];
  humanEscalationThresholds: {
    requiresApprovalAfter: number;       // default: 1
    reasons: OrcHumanEscalationReason[];
  };
  maximumConcurrency: number;            // default: 1
  workerSandbox: OrcWorkerSandboxConfig;
  sessionKind: "main-app" | "ephemeral-worker";
}
```

### Defaults

| Setting | Default Value |
|---------|--------------|
| `blockedCommandPatterns` | `["rm -rf /", "sudo rm", "mkfs", "dd if="]` |
| `humanEscalationThresholds.requiresApprovalAfter` | `1` |
| `humanEscalationThresholds.reasons` | `["destructive-command", "privileged-tool"]` |
| `maximumConcurrency` | `1` |
| `sessionKind` | `"main-app"` |

### Escalation Reasons

| Reason | Description |
|--------|-------------|
| `filesystem-write` | Writes to protected filesystem paths |
| `destructive-command` | Commands matching blocked patterns |
| `network-access` | Outbound network calls |
| `privileged-tool` | Tools requiring elevated permissions |

### Security Events

Three event kinds flow through the system when policy is triggered:

| Kind | `blocksExecution` | Action |
|------|------------------|--------|
| `informational-notice` | false | Logged; execution continues |
| `approval-required` | true | Execution pauses; operator action required |
| `blocked-command` | true | Command rejected; `FailureDossier` emitted |

Policy can be overridden per-launch via `LaunchOrcRequest.securityPolicyOverrides`. `mergeOrcSecurityPolicy(base, overrides)` applies overrides without mutating the base policy.

---

## RPC Bridge & Curator

**Files**: `bridge/`

### RpcEventCurator

`RpcEventCurator` (`curator.ts`) aggregates per-pane agent state across multiple subagent processes. It tracks telemetry signals and produces a `CuratorSnapshot` reflecting the live state of all active agent panes.

Signal mapping: `curator-signal-mapping.md` documents the deterministic `CuratorTelemetrySignal → CuratorTelemetrySignalStage` transitions.

### RPC Process Contracts

Commands flow from TypeScript to subagent processes as `RpcCommandEnvelope<TPayload>`:

```typescript
interface RpcCommandEnvelope<TPayload> {
  schema: "pi.rpc.command.v1";
  requestId: string;
  issuedAt: string;
  target: RpcAgentProcessIdentity;
  command: {
    kind: "initialize" | "execute" | "cancel" | "shutdown";
    payload: TPayload;
  };
}
```

Telemetry flows back as `RpcTelemetryEnvelope<TPayload>`:

```typescript
interface RpcTelemetryEnvelope<TPayload> {
  schema: "pi.rpc.telemetry.v1";
  eventId: string;
  emittedAt: string;
  source: RpcAgentProcessIdentity;
  telemetry: {
    kind: "ready" | "progress" | "result" | "fault" | "heartbeat";
    severity: "debug" | "info" | "warning" | "error";
    payload: TPayload;
  };
}
```

### Dashboard Renderer

`renderCuratorDashboardFrame()` (`renderer.ts`) produces `CuratorDashboardFrame` — an ASCII-rendered snapshot of all active agent panes, suitable for terminal display. Exported publicly via `src/index.ts`.

---

## TUI Integration

**Files**: `orc-tui-subscriber/`, `orc-tracker.ts`

### Subscription Architecture

```
OrcEventBus
    │ subscribe()
    ▼
createOrcTuiTelemetrySubscriber()
    │
    ├──► telemetry-reduction.ts   → OrcTuiTelemetryState (event counts, summaries)
    ├──► subagent-surfaces.ts     → per-subagent pane surface lifecycle
    └──► event-buffer.ts          → buffered delivery for terminal render loop
```

### TUI State Types

| Type | Description |
|------|-------------|
| `OrcTuiTelemetryState` | Aggregated event counts and latest activity summaries |
| `OrcTuiSubagentSurfaceState` | Per-subagent UI surface (pane ID, status, last message) |
| `OrcTuiOverlayState` | Approval/error overlays (blocking interactions) |
| `OrcTuiInternalState` | Focus state and pending user actions |

### Dashboard View Model

`createOrcTrackerDashboardViewModel()` (`orc-tracker.ts`) converts `OrcControlPlaneState` into a UI-ready `OrcTrackerDashboardViewModel`:

```typescript
interface OrcTrackerDashboardViewModel {
  hasActiveGraph: boolean;
  title: string;
  fields: {
    activePhase: OrcTelemetryField;
    activeThread: OrcTelemetryField;
    currentWave: OrcTelemetryField;
    completedTasks: OrcTelemetryField;
    blockedTasks: OrcTelemetryField;
    latestCheckpoint: OrcTelemetryField;
    trackerSignOffStatus: OrcTelemetryField;  // not-started | in-progress | blocked | ready | signed-off
  };
  highlights: string[];
}
```

### Entry Point (UI → Orchestration)

```
F3 key
  └──► InputController
         └──► CommandController.openOrchestrationOverlay()
                └──► CommandOverlayService.openOrcDashboard()
                       └──► new OrchestrationStatusPanel(
                                  createOrcTrackerDashboardViewModel()
                            )
```

---

## Runtime Coordination

**Files**: `orc-runtime/`, `orc-runtime.ts`

### OrcRuntimeSkeleton Public API

The main entry point for all orchestration operations (`orc-runtime.ts:59`):

| Method | Description |
|--------|-------------|
| `launch(request)` | Starts a new orchestration run. Returns `threadId`, `checkpointId`, initial `state` |
| `resumeThread(request)` | Resumes from a saved checkpoint. Restores state + spawns fresh transport |
| `loadTrackerState(request)` | Reads `OrcControlPlaneState` from tracker (live or persisted) |
| `enumerateArtifacts(request)` | Lists artifacts and/or logs for a thread + checkpoint |
| `getSession(threadId)` | Returns the live `OrcSession` handle for an active thread |
| `getTransportHealth(threadId)` | Returns current `OrcPythonTransportHealth` for an active thread |
| `dispose()` | Gracefully shuts down all active threads |

### Internal Coordination Modules

| Module | Responsibility |
|--------|---------------|
| `state-bootstrap.ts` | Builds launch input, creates initial state, creates resume state from checkpoint |
| `transport-supervisor.ts` | Starts transport (`startTransport()`), binds event listeners (`bindTransport()`), mediates event bus publication |
| `session-hooks.ts` | Provides `cancel`, `shutdown`, `getTransportHealth`, `getEventBusSnapshot` to session consumers |
| `persistence.ts` | `OrcRuntimePersistenceCoordinator` — decides when to snapshot; debounces rapid state changes |
| `thread-context-factory.ts` | `createThreadContext()` — assembles the full `OrcRuntimeThreadContext` |
| `cleanup.ts` | `cleanupThread()` — cancels transport, removes from active map, shuts down TUI subscriber, persists final state |

### Launch Sequence

```
launch(request)
  │
  ├── generate threadId + runCorrelationId
  ├── mergeOrcSecurityPolicy(base, overrides)
  ├── createInitialState(...)
  ├── prepareLaunchContext(...)
  │     ├── cleanupExistingThread (if replacing)
  │     ├── createThreadContext(...)
  │     ├── attachRuntimeHooks(...)
  │     └── persist initial tracker state
  └── launchTransport(...)
        ├── ensureTerminalSession("launch")   ← psmux pane
        └── startTransport(context, launchInput, "launch")
              └── spawns Python child process
```

---

## Configuration & Bootstrap

### AppConfig Orchestration Block

Defined in `src/app-config.ts`. All fields are optional — defaults come from `createDefaultOrcSecurityPolicy()`.

```typescript
orchestration?: {
  sessionKind?: "main-app" | "ephemeral-worker";
  allowedWorkingDirectories?: string[];
  maximumConcurrency?: number;
  humanEscalationThresholds?: {
    requiresApprovalAfter?: number;
    reasons?: OrcHumanEscalationReason[];
  };
  workerSandbox?: {
    workspaceRoot?: string;
    durableRoot?: string;
    writeAllowedPaths?: string[];
    blockedCommandPatterns?: string[];
  };
  debug?: { ... };
}
```

### Python Runner Defaults

| Setting | Default |
|---------|---------|
| `graph_name` | `"orc_langgraph"` |
| Runner version | `0.2.0` |
| stdout protocol | `jsonl` |
| stderr protocol | `diagnostic_text` |
| Max string length in telemetry | 400 chars |
| Max collection items in telemetry | 20 |
| Max JSON depth in telemetry | 6 |

### bootstrap.ps1 (Windows)

Installs `psmux` — the Windows ConPTY terminal multiplexer used for subagent pane management.

```powershell
# Primary: WinGet
winget install psmux

# Fallback: Cargo
cargo install psmux
```

`psmux` is optional. If unavailable, transport launch still proceeds — terminal pane features are simply disabled. See `orc-runtime.ts:266` (`ensureTerminalSession`) for the fallback guard.

---

## Public API

These symbols are exported from `src/index.ts` for use by external packages:

### Memory

| Export | Kind | Description |
|--------|------|-------------|
| `OrcMemoryStore` | class | Main memory store implementation |
| `ORC_MEMORY_SCHEMA_VERSION` | constant | Schema version string |
| `OrcCompletionStatusRecord` | type | Completion status record shape |
| `OrcGlobalPlanState` | type | Global plan state shape |
| `OrcHandoffSummaryRecord` | type | Handoff summary record shape |
| `OrcIntermediateArtifactItem` | type | Single artifact item shape |
| `OrcIntermediateArtifactsRecord` | type | Artifacts record shape |
| `OrcMemoryArtifactBundle` | type | Artifact bundle shape |
| `OrcMemoryRecordBase` | type | Base record interface |
| `OrcMemoryRecordKind` | type | Union of record kind strings |
| `OrcSubagentFindingItem` | type | Single finding item shape |
| `OrcSubagentFindingsRecord` | type | Findings record shape |

### Curator

| Export | Kind | Description |
|--------|------|-------------|
| `RpcEventCurator` | class | Per-pane agent state aggregator |
| `parseCuratorRpcEvent()` | function | Parses a raw RPC telemetry frame into a `CuratorRpcEvent` |
| `CuratorRpcEvent` | type | Discriminated union of curator event types |
| `CuratorRpcEventType` | type | Event type string union |
| `CuratorSnapshot` | type | Point-in-time curator state snapshot |
| `CuratorTelemetrySignal` | type | Normalized signal shape |
| `CuratorTelemetrySignalElement` | type | Individual signal element |
| `CuratorTelemetrySignalStage` | type | Signal lifecycle stage |

### Rendering

| Export | Kind | Description |
|--------|------|-------------|
| `renderCuratorDashboardFrame()` | function | Produces an ASCII dashboard frame |
| `CuratorDashboardOutput` | class | Stateful dashboard output manager |
| `CuratorCompactionAlert` | type | Compaction alert shape |
| `CuratorDashboardCommandRunner` | type | Command runner interface for dashboard |
| `CuratorDashboardFrame` | type | Rendered frame shape |
| `CuratorDashboardOutputOptions` | type | Output configuration |
| `CuratorDashboardRenderOptions` | type | Render configuration |
| `CuratorDashboardTransport` | type | Transport interface for dashboard |
| `CuratorRenderState` | type | Aggregated render state |

---

## Testing

### End-to-End Test

**File**: `test/orchestration-custody.e2e.test.ts`

Tests the full chain-of-custody routing path from subagent dispatch through the ORC graph. Imports:
- `RpcEventCurator` — curator event tracking
- `TerminalPaneOrchestrator` — terminal pane contract
- Subagent subgraphs: Archivist, Inquisitor, Mechanic
- `OrcAgentGraph` and state types
- `OrcSubagentRouter` — verifies tool policy violation handling

No unit test suite exists for individual orchestration modules. The system relies on E2E integration tests that exercise real subagent dispatch paths.

---

## Related Documentation

Detailed operational and design references live in `docs/orchestration/`:

| File | Description |
|------|-------------|
| `phase-1-scaffold.md` | Foundational contracts orientation — entry points, module layout, Phase 1 design decisions |
| `phase-2-execution-plan.md` | Phase 2 operational reference — Python runner contracts, JSONL transport, event normalization, TUI subscriber pattern, fault handling, durable/transient boundaries |
| `external-engineer-custody-runbook.md` | Operational procedures for handling orchestration issues and incidents |
| `bootstrap-rpc-curator-runbook.md` | Setup and initialization procedures for the RPC curator bridge |
| `rpc-launcher.md` | RPC process launcher contract details |
| `curator-signal-mapping.md` | Deterministic `CuratorTelemetrySignal` stage mapping reference |
| `scribe-doc-diff-summary.md` | Documentation subgraph diff summary |
| `../unified-error-strategy.md` | Cross-module unified error handling strategy |
