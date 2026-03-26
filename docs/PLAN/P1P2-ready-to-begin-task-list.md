# P1/P2 Ready-to-Begin Task List

This task list translates the current P1/P2 orchestration plan material into execution-ready work packets for engineers starting immediately. It is optimized for handoff clarity, validation evidence, and outside-engineer onboarding.

## Source basis and interpretation notes

- Primary planning source: `docs/PLAN/P1P2 Development Execution Plan.pdf`.
- Supporting implementation orientation used to operationalize this list:
  - `docs/orchestration/phase-1-scaffold.md`
  - `docs/orchestration/phase-2-execution-plan.md`
- The tasks below are intentionally framed around the **deferred work and explicit boundaries** called out in the Phase 2 orientation so teams can begin execution without re-discovery.

## How to use this list

Each task is structured with:
- **Outcome**: what must be true when done.
- **Ready criteria**: what makes this task startable now.
- **Implementation notes**: guardrails and boundaries.
- **Validation & tests**: concrete checks to run.
- **Documentation artifacts**: what to capture so external engineers can pick up quickly.

---

## Task 1 — Replace bootstrap telemetry with live LangGraph/DeepAgents event bindings

**Outcome**
- Python runner emits canonical lifecycle, worker, tool, and checkpoint telemetry derived from real LangGraph/DeepAgents callbacks rather than bootstrap/demo event simulation.

**Ready criteria**
- Existing Python runner invocation path is already stable (`python3 -m src.orchestration.python.orc_runner`).
- Canonical event categories and normalization pipeline already exist in Phase 2.

**Implementation notes**
- Keep stdout as strict JSONL and stderr for diagnostics.
- Preserve canonical event envelope shape so TypeScript reducers/subscribers do not regress.
- Add passthrough metadata fields only under namespaced keys.

**Validation & tests**
- Integration test: runner receives launch envelope and emits real callback-backed JSONL sequence.
- Contract test: each callback maps to approved canonical event type and required fields.
- Fault test: malformed callback payload still downgraded to warning/fault event, not process crash.

**Documentation artifacts**
- Callback-to-canonical-event mapping table (source callback, canonical event, required metadata).
- Runner telemetry contract examples in `docs/orchestration/`.

---

## Task 2 — Implement replay-aware event-log discovery and resume republishing

**Outcome**
- Resume flow can discover prior run segments and republish canonical event history into reducer/subscriber pipeline before live continuation.

**Ready criteria**
- Durable event-log directory and run manifests already exist.
- Tracker/checkpoint metadata includes run/thread context sufficient to locate prior logs.

**Implementation notes**
- Build deterministic segment ordering and idempotent republish semantics.
- Ensure republished events are marked with replay provenance metadata.
- Avoid duplicate terminal state publication in the GEB/reducer path.

**Validation & tests**
- Replay test: interrupted run + resume reproduces expected pre-terminal reduced state.
- Ordering test: segment boundaries maintain strict event order.
- Idempotency test: replay called twice does not duplicate reducer outcomes.

**Documentation artifacts**
- Resume/replay sequence diagram.
- Event replay invariants checklist for support engineers.

---

## Task 3 — Restore in-flight worker state from durable checkpoints

**Outcome**
- Resume flow can restore active wave/worker execution context from durable checkpoint payloads (not only reduced summary metadata).

**Ready criteria**
- Checkpoint metadata schema already reserves `stateSnapshot`, `resumeData`, and worker/wave references.
- Transport and runtime lifecycle boundaries are operational.

**Implementation notes**
- Introduce explicit checkpoint payload adapter format versioning.
- Keep tracker snapshots slim; store heavy restoration payloads by reference.
- Fail safely when checkpoint payload is incompatible (clear canonical fault + operator guidance).

**Validation & tests**
- Resume test: kill during active wave, then restore worker progress and continue.
- Compatibility test: old checkpoint format handled by migration or explicit unsupported-state error.
- Corruption test: missing payload produces deterministic failure classification.

**Documentation artifacts**
- Checkpoint payload schema + version migration policy.
- “Known resume limits” matrix for external operators.

---

## Task 4 — Wire live command/tool interception into canonical security telemetry

**Outcome**
- Real worker tool/command interception events emit canonical security approval/block telemetry and feed reduced state + operator overlays.

**Ready criteria**
- Canonical security event taxonomy already exists.
- Security policy merge and policy snapshot plumbing already present in runtime contracts.

**Implementation notes**
- Preserve distinction between policy decision, execution attempt, and execution result.
- Include minimal auditable context (worker id, tool id, policy rule id, decision reason).
- Ensure blocked actions never execute.

**Validation & tests**
- Approval-path test: allowlisted command emits approval and execution events.
- Block-path test: denied command emits block event and does not execute.
- Audit test: tracker summary and event log agree on security decision counts.

**Documentation artifacts**
- Security decision event schema reference.
- Operator triage runbook for approvals/blocks.

---

## Task 5 — Connect `subagentSurfaces` to all live Orc overlays/panes

**Outcome**
- All Orc live UI surfaces consume subscriber-owned subagent slices; no view binds directly to transport/parser internals.

**Ready criteria**
- `orc-tui-subscriber` already exists as intended adapter boundary.
- Dashboard/overlay surfaces already consume partial subscriber outputs.

**Implementation notes**
- Consolidate surface identity lifecycle rules in subscriber layer.
- Add batching/backpressure-safe UI update strategy for high-volume worker bursts.
- Keep UI rendering deterministic for equivalent event sequences.

**Validation & tests**
- UI integration test: multi-worker run updates all panes consistently.
- Regression test: no direct transport event subscription in TUI components.
- Performance smoke test: bursty event stream does not stall UI loop.

**Documentation artifacts**
- Subscriber slice contract for each UI surface.
- “Do not bind directly to transport” architecture note with examples.

---

## Task 6 — Harden transport diagnostics and fault classification acceptance suite

**Outcome**
- Fault classes in Phase 2 matrix are covered by automated tests and produce deterministic terminal summaries.

**Ready criteria**
- Canonical transport fault codes are already defined.
- Debug artifact channels (stderr/raw mirror/parser warnings/diagnostics) already exist.

**Implementation notes**
- Treat this as cross-cutting reliability hardening before broader Phase 3 features.
- Ensure tests assert tracker terminal state, event-log terminal event, and UI-facing summary coherence.

**Validation & tests**
- Scenario tests for: startup failure, disconnect, broken pipe, non-zero exit, signal shutdown, user cancellation, ambiguous terminal.
- Artifact consistency check across tracker + event log + diagnostics.

**Documentation artifacts**
- Fault-class-to-test-case traceability table.
- External engineer troubleshooting checklist with exact artifact paths.

---

## Task 7 — Define and ship Phase 3 readiness contracts

**Outcome**
- Engineering team has explicit “ready for Phase 3” entry contracts covering replay, checkpoint restoration, and security/event guarantees.

**Ready criteria**
- Phase 2 implementation and deferred boundaries are already documented.

**Implementation notes**
- Keep this as a lightweight standards/documentation task but gate Phase 3 branch work on sign-off.
- Include non-goals and known limitations to avoid accidental over-commitment.

**Validation & tests**
- Review gate: architecture + runtime + UI owners approve contract.
- Traceability gate: each contract item maps to a passing automated test or explicit deferred item.

**Documentation artifacts**
- `docs/orchestration/phase-3-readiness-contract.md`.
- Update `LANGEXTtracker.md` with signed acceptance entries.

---

## Suggested sprint ordering (ready now)

1. **Task 1** (live callback bindings) — unlocks real signal quality.
2. **Task 6** (fault suite hardening) — stabilizes execution confidence early.
3. **Task 4** (live security interception) — closes safety/telemetry loop.
4. **Task 5** (subscriber/UI completion) — finalizes operator-facing live surfaces.
5. **Task 2** (replay-aware resume) — establishes recovery backbone.
6. **Task 3** (in-flight restore) — completes deeper resumability.
7. **Task 7** (Phase 3 readiness contracts) — formal sign-off and handoff.

## Definition of Done (global for this list)

A task from this list is considered complete only when all are true:

1. Implementation merged with no direct transport-to-UI coupling regressions.
2. Automated tests added or updated and passing locally/CI.
3. Durable artifacts validate expected outcomes (tracker, event logs, diagnostics where applicable).
4. Outside-engineer documentation updated with troubleshooting-first orientation.
5. `LANGEXTtracker.md` updated with completion evidence, risks, and next-step handoff notes.
