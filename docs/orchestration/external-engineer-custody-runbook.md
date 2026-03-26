# External Engineer Runbook: Custody Graph, Contracts, Tool Isolation, and Recovery

This runbook is the operator-facing guide for debugging and operating the Orc custody pipeline without internal tribal knowledge.

## 1) Canonical state schema

### 1.1 Master custody graph state (`OrcMasterState`)

Source of truth: `src/orchestration/orc-graph.ts`.

Required fields:
- `threadId`, `runCorrelationId`: stable run identity.
- `next`: active node (`route`, `dispatch`, `verify`, `complete`, `failed`, `contract_error`).
- `memoryRoute`: retrieval mode (`filesystem` or `vector`) for Archivist context access.
- `routing`: includes `taskType`, `requestedBy`, active `targetGuildMember`, and append-only `chainOfCustody`.
- `retries`: retry counter and failure metadata.

Optional/derived fields:
- `activeGuildMember`: current custodian identity and session binding.
- `contractPayload`: typed handoff package (`StructuralBlueprint`, `ReconReport`, `FailureDossier`).
- `reconReport`, `archivistContext`, `failureDossier`: downstream contract artifacts.
- `contractValidationFailure`: structured validation failure metadata emitted when contract checks fail.

### 1.2 Contract schema (`contracts.ts`)

All cross-agent payloads are validated through `validateOrcContractPayload`:
- `StructuralBlueprint`: architect-compatible handoff.
- `ReconReport`: scout-compatible coordinate and findings packet.
- `FailureDossier`: inquisitor/mechanic failure exchange packet.

Validation behavior:
- Every model returns deterministic `issues[]` with `path`, `expected`, `received`, `message`.
- Any invalid payload transitions graph state to `contract_error` and records `contractValidationFailure`.

### 1.3 Subagent isolation schema

Subagent policy is controlled by `ORC_SUBAGENT_TOOL_POLICY_MAP` in `src/orchestration/graph/subagents/tool_policy.ts`:
- Policy is role-scoped and domain-based.
- Runtime telemetry tool calls are classified into domains (`read`, `lsp`, `edit`, `test`, `dependency`, etc.).
- Violations raise `OrcSubagentToolPolicyViolationError` and include structured violation detail.

## 2) Routing graph and custody transitions

## 2.1 Master routing graph

Node progression:
- `route` -> chooses target guild member and validates route-time contract payload.
- `dispatch` -> enforces subagent handoff completeness and validates contract/recon artifacts.
- `verify` -> validates recon/failure artifacts and decides `route`, `complete`, or `failed`.
- `complete` -> finalization node (or emits failed summary if entering with `failed`).
- `contract_error` -> terminal validation error state.

Built-in guard middleware:
- `subagent_dispatch_guard` blocks dispatch unless both `activeGuildMember` and `contractPayload` are present.

## 2.2 Expected custody sequence (feature-delivery path)

Typical high-safety flow:
1. Architect emits `StructuralBlueprint`.
2. Scout produces `ReconReport` coordinates.
3. Mechanic applies edits and compiles.
4. Inquisitor runs adversarial tests.
5. Warden intercepts dependency/environment faults from Mechanic verify failures.
6. Optional Alchemist optimization runs after baseline pass.
7. Scribe publishes docs and emits completion success signal.
8. Archivist retrieves/injects bounded historical context when requested.
9. Curator emits telemetry signal mapping for operator UX.

## 3) Failure modes and detection signals

### 3.1 Contract validation failures

Symptoms:
- `next = contract_error`.
- `failureSummary` includes failing node + contract model.
- `contractValidationFailure.issues[]` provides exact path-level diagnostics.

Common causes:
- Wrong contract model routed to role (for example, Mechanic with `ReconReport` handoff id).
- Invalid field shapes (`coordinates`, empty strings/arrays, malformed envelope).

### 3.2 Tool-policy violations (isolation breaks)

Symptoms:
- Runtime throws `OrcSubagentToolPolicyViolationError` during telemetry binding.
- Diagnostic event emitted: `subagent.policy_violation`.

Common causes:
- Scout executing dependency/test/edit tooling.
- Inquisitor executing dependency installation commands.
- Any role executing unclassified tools.

### 3.3 Warden intercept conditions

Mechanic verify diagnostics classified as environment/dependency (e.g., module-not-found, missing env vars) should route to Warden remediation instead of repeated code retries.

Symptoms if healthy:
- Subgraph path: `edit -> verify -> warden -> verify`.
- `environmentStateUpdate` populated with updated manifests/env docs.

### 3.4 Scribe completion gate failures

Symptoms:
- Orc completion blocked with explicit error requiring Scribe success signal.
- Missing README/architecture/public-interface updates in Scribe subgraph.

### 3.5 Archivist context issues

Symptoms:
- Context injection absent or over-sized.
- Bounded clamp should enforce char and snippet caps before merge into master state.

### 3.6 Curator signal drift

Symptoms:
- Incorrect visual signal under retry/recovery conditions.
- Expected mapping: retry escalation => `fire:*`, successful recovery => `water:*`.

## 4) Recovery operations

### 4.1 Contract-error recovery

1. Read `contractValidationFailure.issues` paths.
2. Fix producer payload shape/model id.
3. Re-run from `route` with corrected payload.
4. Confirm dispatch + verify contract checks pass.

### 4.2 Tool-policy violation recovery

1. Identify violating role/tool from error detail.
2. Reroute work to the correct role (or adjust workflow, not policy, unless governance approved).
3. Re-run telemetry-binding path; verify no `subagent.policy_violation` events.

### 4.3 Warden recovery loop

1. Confirm verify failure classified as environment/dependency.
2. Apply Warden remediation (`package.json`, lockfile, env docs/vars).
3. Resume Mechanic verify step.
4. If still failing with code diagnostics, route back to normal Mechanic edit loop.

### 4.4 Scribe gate recovery

1. Ensure docs include README + architecture + public interface changes.
2. Emit diff summary artifact.
3. Re-run Scribe node until success signal is true.
4. Only then allow Orc complete node to emit final done summary.

### 4.5 Archivist retrieval recovery

1. Validate memory route (`filesystem` vs `vector`) and namespace/thread ids.
2. Re-run retrieval with bounded limits (`maxSources`, summary char budget).
3. Confirm context injection provenance and truncation indicators.

### 4.6 Curator recovery

1. Verify incoming RPC event shape (`agentId`, `paneId`, event-specific required keys).
2. Replay retry/recovery events.
3. Confirm deterministic signal mapping and pane-level isolation.

## 5) Minimal operator checklists

Before merge:
- Custody transition tests include both pass and fail paths.
- Contract violations route to `contract_error` with useful issue payloads.
- Tool-policy violations are blocked and observable through diagnostics.
- Warden intercept path is validated.
- Scribe success gate blocks premature completion.
- Archivist retrieval/context injection and Curator signaling are deterministic.

During incident:
- Snapshot run state, correlation id, current node.
- Classify incident: contract vs policy vs environment vs doc gate vs telemetry.
- Apply matching recovery procedure above.
- Re-run only from the minimal affected node to preserve deterministic custody history.
