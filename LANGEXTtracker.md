# LANGEXT Feature Line Tracker

> Central process record for the LangGraph integration / language-extension feature line. This tracker is the mandatory coordination artifact for every orchestration, planning, implementation, verification, and handoff session associated with this feature.

## Purpose and Enforcement Rules

### Purpose
- Provide a durable, append-friendly execution record for the LangGraph integration feature line.
- Keep orchestration progress, implementation tasks, validation evidence, and carryover work visible to any incoming engineer or agent.
- Act as the mandatory source of session-level truth for feature progress, sign-off, and cross-session handoff.

### Mandatory Enforcement Rules
1. **This file is required process documentation** for the full feature line and must be consulted before beginning work on any LangGraph integration task.
2. **No orchestration phase is considered complete** until this tracker shows every required task signed off and any carryover work captured in the appropriate handoff sections.
3. **Every active session must append updates instead of rewriting prior history** except to correct obvious clerical errors.
4. **Every completed task must be marked complete in the relevant ledger row** before the session closes.
5. **Any incomplete, partially validated, or blocked work must be recorded** in the current session log, task ledger, risks/blockers, and next-session handoff before closing.
6. **The next session TODO handoff must be created or refreshed before closing** even if the session fully completes its scoped work.
7. **A sign-off entry with timestamp and agent label/initials is mandatory** for each work session.
8. **Validation evidence must be concrete and auditable** (commands run, reviewer notes, or rationale for deferred validation).
9. **If a task touches implementation files, the corresponding design mandate mapping must be traceable** through the design compliance section and/or ledger notes.
10. **If tracker entries conflict with conversational memory, the tracker governs process state** until reconciled explicitly in a new signed entry.

### Required Agent Session Rules
Each current session agent must:
- mark completed tasks;
- record incomplete work;
- create the next session's TODO list before closing;
- sign off with timestamp and initials/agent label;
- preserve prior history by appending dated subsections or new table rows instead of replacing old records.

### Orchestration Completion Gate
No orchestration phase is complete until:
- all required tasks for that phase appear in the ledger;
- each required task has an explicit status;
- completed tasks carry validation and sign-off evidence;
- incomplete or deferred tasks are captured as carryover work;
- risks and blockers are updated to reflect current reality;
- the next-session handoff is present and actionable.

## Phase Breakdown

| Phase | Scope | Exit Criteria | Tracker Evidence Required |
| --- | --- | --- | --- |
| Phase 0 - Foundation Alignment | Align architecture, scope, repo touch points, and process expectations. | Design mandates understood, tracker established, and initial work decomposition captured. | Phase ledger rows created, design compliance mapping started, sign-off recorded. |
| Phase 1 - Orchestrator Core | Implement core LangGraph control-plane integration, state model, routing, and phase execution backbone. | Deterministic graph flow, typed state, phase routing, and initial orchestration hooks are implemented and validated. | Ledger rows complete/signed, validations captured, carryover items documented. |
| Phase 2 - Worker Execution Plane | Add wave execution, isolated worker sessions, constrained tool/runtime controls, and task dispatch. | Worker lifecycle, dependency-aware wave dispatch, and confinement policies are operational. | Task rows updated with files, validation, blockers, and sign-offs. |
| Phase 3 - Verification and Recovery | Add verifier/debug loops, durable checkpoints, and fault recovery workflows. | Verification pipeline and restart/recovery paths are functioning with documented evidence. | Validation notes, blocker handling, and DoD criteria updated. |
| Phase 4 - UX and Operational Hardening | TUI abstraction, telemetry/progress rendering, documentation, and production hardening. | End-user orchestration flow is usable, hardened, and documented for operators/engineers. | Signed completion rows, risk closure, and final DoD confirmation. |

## Design Compliance

This section maps implementation activity back to the major design mandates in `LangGraph Integration for Agentic CLI.md`.

| Design Mandate ID | Major Design Mandate | Expected Implementation Coverage | Related Phase(s) | Ledger Task IDs |
| --- | --- | --- | --- | --- |
| DM-01 | Thin orchestrator control plane separated from code-writing workers | LangGraph orchestration must coordinate but not directly perform feature-file modification logic intended for worker agents. | Phase 1, 2 | P1-TBD, P2-001, P2-003, P2-005, P2-009 |
| DM-02 | Typed in-memory state replaces file-driven control flow | State schema, reducers, and checkpointed graph state must govern routing instead of markdown parsing. | Phase 1, 3 | P1-TBD, P3-TBD |
| DM-03 | Deterministic routing and validation gates | Conditional graph edges and explicit validation gates must control plan/execute/verify transitions. | Phase 1, 3 | P1-TBD, P3-TBD |
| DM-04 | Wave-based isolated execution workers | Independent tasks execute in isolated sessions with dependency-aware batching and traceable outputs. | Phase 2 | P2-001, P2-003, P2-004, P2-009, P2-013 |
| DM-05 | Durable persistence and resumability | Super-step checkpointing, thread continuity, and restart-safe orchestration state must exist. | Phase 3 | P3-TBD |
| DM-06 | Secure tool interception and confinement | Worker tools require directory confinement, destructive command controls, and escalation boundaries where applicable. | Phase 2, 4 | P2-016, P4-TBD |
| DM-07 | Friendly frontend abstraction with hidden worker noise | User-facing experience must present unified progress/telemetry rather than raw parallel worker output. | Phase 4 | P4-TBD |
| DM-08 | Durable artifacts for human/agent continuity | Project-readable artifacts, handoffs, and implementation records must remain append-friendly and auditable. | Phase 0-4 | P0-001, cross-phase |

### Design Compliance Notes
- Use the ledger `validation notes` or `follow-up TODO` fields to record how a task satisfies one or more design mandates.
- When a new implementation task is added, update the `Ledger Task IDs` column above if the task is materially tied to a mandate.
- If any task deviates from a design mandate, record the rationale in `Risks / blockers` and obtain explicit sign-off in the session log.

## Phase 1 Task Ledger

> Append new rows; do not delete historical rows. Prefer adding a new dated row or updating status fields for the same task when progress changes.

| task ID | title | owner/agent | date | status | files touched | validation notes | blocker notes | follow-up TODO |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0-001 | Establish mandatory feature-line tracker and enforcement model | GPT-5.2-Codex | 2026-03-22 | Completed | `LANGEXTtracker.md` | Tracker created at repo root; structure includes required sections, enforcement rules, append-friendly logging, and design mandate mapping. | None. | Replace placeholder `*-TBD` task references with concrete implementation IDs as Phase 1 planning advances. |
| P1-001 | Define LangGraph orchestration state schema and lifecycle phase model | Unassigned | — | Not Started | — | Must satisfy DM-02 and support deterministic phase tracking. | Pending implementation planning. | Capture concrete interfaces, reducers, and state transition validation evidence. |
| P1-002 | Implement deterministic planner/checker routing for orchestration phases | Unassigned | — | Not Started | — | Must satisfy DM-03 with explicit pass/fail routing criteria. | Pending implementation planning. | Document route conditions, failure loops, and validation hooks. |
| P1-003 | Wire orchestration entry points into the CLI extension surface | Unassigned | — | Not Started | — | Must support DM-01 and Phase 1 exit criteria without leaking worker complexity. | Pending implementation planning. | Identify integration points, command intercept behavior, and operator-visible telemetry requirements. |


## Phase 2 Task Ledger

> Append new rows; do not delete historical rows. Every Phase 2 task must explicitly read and then update `LANGEXTtracker.md` before the session closes.

| task ID | title | owner/agent | date | status | files touched | validation notes | blocker notes | follow-up TODO |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P2-001 | Freeze the Phase 2 control/data-plane contract | GPT-5.2-Codex | 2026-03-22 | Completed | `LANGEXTtracker.md`, `src/orchestration/orc-io.ts`, `src/orchestration/orc-state.ts` | Static review completed after adding Phase 2 run/event/sequence/origin/category/severity/lifecycle transport types, the canonical `who`/`what`/`how`/`when` envelope, and ownership-boundary comments. Verified with `npm run build`. | None. | Next session can consume the frozen envelope contract from `src/orchestration/orc-io.ts` while implementing `P2-002` reducer/event-bus normalization. |
| P2-002 | Define the canonical Global Event Bus schema and reducers | GPT-5.2-Codex | 2026-03-22 | Planned | `docs/orchestration/phase-2-execution-plan.md`, `LANGEXTtracker.md` | Planned task inventory captures typed event unions, normalization rules, and reducer targets for live telemetry. | Awaiting implementation. | Add `src/orchestration/orc-events.ts` and reducer-facing summaries for agent/user vs agent/computer activity. |
| P2-003 | Build the Python LangGraph runner bootstrap and execution envelope | GPT-5.2-Codex | 2026-03-22 | Planned | `docs/orchestration/phase-2-execution-plan.md`, `LANGEXTtracker.md` | Planned task inventory defines the Python runner bootstrap, stderr/stdout split, and launch contract. | Awaiting implementation. | Create the Python runner entry point and document its environment contract. |
| P2-004 | Implement JSONL telemetry emission for LangGraph and DeepAgents activity | GPT-5.2-Codex | 2026-03-22 | Planned | `docs/orchestration/phase-2-execution-plan.md`, `LANGEXTtracker.md` | Planned task inventory requires strict single-line JSON emission with run correlation, sequencing, and raw payload passthrough. | Awaiting implementation. | Instrument graph, subagent, tool, retry, and completion events as JSONL telemetry. |
| P2-005 | Add a TypeScript child-process transport adapter for Orc | GPT-5.2-Codex | 2026-03-22 | Planned | `docs/orchestration/phase-2-execution-plan.md`, `LANGEXTtracker.md` | Planned task inventory defines a reusable TS transport abstraction for supervising the Python process. | Awaiting implementation. | Add `src/orchestration/orc-python-transport.ts` and wire lifecycle controls into `orc-runtime.ts`. |
| P2-006 | Implement incremental JSONL parsing and malformed-stream recovery | GPT-5.2-Codex | 2026-03-22 | Planned | `docs/orchestration/phase-2-execution-plan.md`, `LANGEXTtracker.md` | Planned task inventory covers chunk assembly, parse warnings, stall handling, and graceful degradation. | Awaiting implementation. | Build defensive line parsing and transport-fault classification rules. |
| P2-007 | Implement the asynchronous Global Event Bus core | GPT-5.2-Codex | 2026-03-22 | Planned | `docs/orchestration/phase-2-execution-plan.md`, `LANGEXTtracker.md` | Planned task inventory specifies a typed, decoupled pub/sub core for orchestration telemetry. | Awaiting implementation. | Add `src/orchestration/orc-event-bus.ts` with lifecycle and fan-out rules. |
| P2-008 | Add Orc event logging and durable event-history persistence | GPT-5.2-Codex | 2026-03-22 | Planned | `docs/orchestration/phase-2-execution-plan.md`, `LANGEXTtracker.md` | Planned task inventory defines timestamped event-log persistence decoupled from rendering. | Awaiting implementation. | Extend orchestration storage with append-only event-log support and replay notes. |
| P2-009 | Wire transport + GEB updates into Orc runtime lifecycle methods | GPT-5.2-Codex | 2026-03-22 | Planned | `docs/orchestration/phase-2-execution-plan.md`, `LANGEXTtracker.md` | Planned task inventory replaces Phase 1 runtime placeholders with supervised launch/resume flows. | Awaiting implementation. | Upgrade `launch()` / `resumeThread()` to own transport, tracker, checkpoint, and bus lifecycle. |
| P2-010 | Add event-driven control-plane state reduction | GPT-5.2-Codex | 2026-03-22 | Planned | `docs/orchestration/phase-2-execution-plan.md`, `LANGEXTtracker.md` | Planned task inventory maps canonical events into tracker/dashboard state instead of manual placeholders. | Awaiting implementation. | Define reducers for wave, worker, message, checkpoint, and terminal-state updates. |
| P2-011 | Render friendly operator-facing summaries from raw agent telemetry | GPT-5.2-Codex | 2026-03-22 | Planned | `docs/orchestration/phase-2-execution-plan.md`, `LANGEXTtracker.md` | Planned task inventory defines presentation adapters for human-readable orchestration summaries. | Awaiting implementation. | Add summary/presentation helpers that preserve raw detail for drill-down. |
| P2-012 | Introduce a TUI telemetry subscriber layer for dashboards, overlays, and panes | GPT-5.2-Codex | 2026-03-22 | Planned | `docs/orchestration/phase-2-execution-plan.md`, `LANGEXTtracker.md` | Planned task inventory maps the event bus into TUI state via subscriber adapters. | Awaiting implementation. | Add dedicated orchestration subscribers instead of coupling views to transport internals. |
| P2-013 | Add subagent activity surfaces and overlay management rules | GPT-5.2-Codex | 2026-03-22 | Planned | `docs/orchestration/phase-2-execution-plan.md`, `LANGEXTtracker.md` | Planned task inventory covers multi-overlay/subagent UI lifecycle behavior. | Awaiting implementation. | Define identity, retention, and update rules for subagent panes and overlays. |
| P2-014 | Implement transport and orchestration fault handling | GPT-5.2-Codex | 2026-03-22 | Planned | `docs/orchestration/phase-2-execution-plan.md`, `LANGEXTtracker.md` | Planned task inventory captures startup failure, disconnect, exit, cancellation, and remediation handling. | Awaiting implementation. | Standardize fatal vs retryable states across transport, tracker, and TUI. |
| P2-015 | Implement debug/diagnostic instrumentation for outside engineers | GPT-5.2-Codex | 2026-03-22 | Planned | `docs/orchestration/phase-2-execution-plan.md`, `LANGEXTtracker.md` | Planned task inventory documents debug mode, raw-event mirrors, and troubleshooting expectations. | Awaiting implementation. | Publish engineer-facing diagnostics guidance alongside runtime instrumentation. |
| P2-016 | Wire security and approval events into the GEB contract | GPT-5.2-Codex | 2026-03-22 | Planned | `docs/orchestration/phase-2-execution-plan.md`, `LANGEXTtracker.md` | Planned task inventory maps security-policy outcomes into the shared telemetry pipeline. | Awaiting implementation. | Add canonical approval-required and blocked-command event handling. |
| P2-017 | Prepare the tracker/checkpoint bridge for Phase 3 durability work | GPT-5.2-Codex | 2026-03-22 | Planned | `docs/orchestration/phase-2-execution-plan.md`, `LANGEXTtracker.md` | Planned task inventory documents the telemetry-to-checkpoint bridge needed for Phase 3 recovery work. | Awaiting implementation. | Extend checkpoint metadata only where needed for correlation and resume readiness. |
| P2-018 | Publish Phase 2 engineering documentation and operator handoff notes | GPT-5.2-Codex | 2026-03-22 | Planned | `docs/orchestration/phase-2-execution-plan.md`, `LANGEXTtracker.md` | Planned task inventory defines the final documentation and sign-off requirements for the phase. | Awaiting implementation. | Update README/orchestration guides and close the phase with validation evidence and handoff notes. |

## Current Session Work Log

### 2026-03-22 — GPT-5.2-Codex
- Created the central `LANGEXTtracker.md` document at the repository root to serve as the mandatory process artifact for the full feature line.
- Added the required fixed sections: purpose/enforcement, phase breakdown, Phase 1 ledger, session work log, sign-off block, next-session TODO handoff, risks/blockers, and definition of done.
- Added explicit agent rules requiring task completion updates, incomplete-work capture, next-session TODO creation, and timestamped sign-off.
- Added a design compliance matrix mapping tracker usage and future implementation tasks back to the major mandates in `LangGraph Integration for Agentic CLI.md`.
- Seeded the ledger with the tracker creation task and placeholder Phase 1 orchestration tasks so future sessions can append progress without restructuring the file.
- Validation performed: manual structural review of headings, table fields, and enforcement criteria.



### 2026-03-22 — GPT-5.2-Codex (Phase 2 planning pass)
- Read `LANGEXTtracker.md`, the Phase 1 scaffold guide, and the master LangGraph integration design document before planning the next phase.
- Added `docs/orchestration/phase-2-execution-plan.md` as the comprehensive Phase 2 task inventory for the worker execution plane, Python↔TypeScript JSONL transport, async Global Event Bus, TUI telemetry subscribers, and robustness/error-handling work.
- Expanded the tracker with a dedicated Phase 2 task ledger (`P2-001` through `P2-018`) so future sessions can mark implementation progress without restructuring the process artifact.
- Updated the design compliance matrix to replace the placeholder Phase 2 task references for DM-01, DM-04, and DM-06 with concrete planned task IDs.
- Validation performed: static document review of task sequencing, dependency map, and tracker-touch requirements for every Phase 2 task.

### 2026-03-22 — GPT-5.2-Codex (P2-001 contract freeze)
- Updated the `P2-001` ledger row to `In Progress` before touching implementation files, then completed the row after the contract work and static validation finished.
- Extended `src/orchestration/orc-io.ts` with the Phase 2 transport vocabulary: run correlation ids, event ids, stream sequence numbers, origin metadata, event categories, severity, lifecycle status, and actor/delivery descriptors.
- Added a canonical event envelope that captures `who`, `what`, `how`, and `when` plus a namespaced raw-payload passthrough field for Python-runner and future replay metadata.
- Documented the minimum metadata needed to separate agent→user interactions from agent→computer/tool activity and clarified the ownership boundary in `src/orchestration/orc-state.ts` between transport facts, reduced control-plane state, tracker snapshots, and future TUI view models.
- Validation performed: `npm run build` plus static review of comments and type boundaries for downstream implementers.

## Sign-off Block

| timestamp (UTC) | agent | scope completed | sign-off notes |
| --- | --- | --- | --- |
| 2026-03-22T12:00:00Z | GPT-5.2-Codex | Created mandatory feature-line tracker document and initialized Phase 1 ledger/process controls. | Session closed with carryover planning captured below; future sessions must replace placeholder task mappings with concrete implementation IDs as work advances. |
| 2026-03-22T13:30:00Z | GPT-5.2-Codex | Planned the full Phase 2 backlog and added the Phase 2 execution-plan guide. | Session closed after updating the tracker, documenting 18 concrete Phase 2 tasks, and mapping initial Phase 2 design mandates to real task IDs. |
| 2026-03-22T14:15:00Z | GPT-5.2-Codex | Completed P2-001 contract freeze for the Phase 2 transport and state boundary vocabulary. | Session closed after freezing the canonical event envelope, updating the tracker ledger/work log, and validating the TypeScript contract with `npm run build`. |

## Next-Session TODO Handoff

### Priority TODOs for Next Session
1. Begin implementation with `P2-001` and `P2-002`, extending the Orc TypeScript contracts for transport envelopes, event schemas, and reducer targets before building transport code.
2. Confirm the exact repository path for the new Python LangGraph runner and add it to `P2-003` once the implementation branch starts touching files.
3. Replace the remaining placeholder design-compliance mappings for Phase 1 and future Phase 3/4 work as those task inventories become concrete.
4. Use the frozen `OrcCanonicalEventEnvelope` contract from `src/orchestration/orc-io.ts` to implement `P2-002` normalization and reducers without redefining transport metadata.
5. Record concrete validation commands, reviewer notes, or deferred-validation rationale directly in the Phase 2 ledger rows as implementation work starts.
6. Continue to read `LANGEXTtracker.md` at session start and append updates rather than rewriting prior history.

## Risks / Blockers

| date | type | description | owner | mitigation / next action | status |
| --- | --- | --- | --- | --- | --- |
| 2026-03-22 | Process risk | Design compliance table currently contains placeholder task references for future implementation work. | GPT-5.2-Codex / next session | Phase 2 placeholders have been replaced; Phase 1 and Phase 3/4 placeholder IDs still need concrete mappings as planning advances. | Open |
| 2026-03-22 | Coordination risk | If future agents update tracker content by rewriting prior rows instead of appending, auditability may be lost. | All future agents | Enforce append-only updates and add dated subsections/rows for each session. | Open |

## Definition of Done

A phase or feature-line milestone is only done when all of the following are true:
- every required task is represented in the relevant ledger with task ID, title, owner/agent, date, status, files touched, validation notes, blocker notes, and follow-up TODO;
- every completed task is marked completed and supported by validation evidence;
- incomplete or deferred work is documented in the session log, risks/blockers, and next-session handoff;
- design compliance mappings are updated to show how implemented tasks satisfy the major design mandates;
- required sign-off entries are present with timestamp and agent label/initials;
- carryover work is explicitly captured before session closure;
- no orchestration phase is declared complete unless the tracker reflects full sign-off coverage and documented carryover handling.
