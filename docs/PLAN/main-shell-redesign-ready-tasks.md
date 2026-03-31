# Main Shell Redesign — Ready-to-Begin Task Backlog

This task backlog is derived from `docs/PLAN/main-shell-redesign-plan.md` and is intended to be immediately actionable by engineers without additional decomposition.

## How to use this backlog

- **Status** starts as `Ready` for all tasks below.
- **Dependencies** are explicit and should gate sequencing.
- **Definition of done** is concrete and testable.
- **Evidence** identifies what should be committed (code, tests, docs) before closing the task.

---

## Epic A — Foundation, Interfaces, and Parallel Shell Hosting

### A1. Add OpenTUI/Solid dependencies and verify compile
- **Status:** Ready
- **Scope:** `package.json`, lockfile, TypeScript compile compatibility.
- **Dependencies:** None.
- **Steps:**
  1. Add `@opentui/core`, `@opentui/solid`, and `solid-js` to dependencies.
  2. Reconcile TypeScript settings and module resolution for new packages.
  3. Ensure existing build remains green.
- **Definition of done:**
  - New packages are installed and committed.
  - `npm run build` passes.
  - No regressions in existing shell startup path.
- **Evidence:** dependency diff + successful build log.

### A2. Scaffold new shell namespace and adapter contract
- **Status:** Ready
- **Scope:** new module tree (for example `src/shell-next/**`), shared shell adapter entry point.
- **Dependencies:** A1.
- **Steps:**
  1. Create new shell root modules (renderer, controller, actions, state, chrome).
  2. Define `MainShellAdapter` interface to host either legacy or new shell.
  3. Add bootstrap wiring in `src/app.ts` (feature-flag/selection seam only).
- **Definition of done:**
  - App can instantiate either shell implementation.
  - New shell modules compile even if not default.
- **Evidence:** adapter interfaces + conditional shell instantiation in app startup.

### A3. Define shared transcript/rich-document model contracts
- **Status:** Ready
- **Scope:** shared model types used by adapters and renderer.
- **Dependencies:** A2.
- **Steps:**
  1. Create typed models for `TranscriptItem`, `TranscriptPart`, `ShellSurfaceDescriptor`, `RichDocumentSource`, and `RichDocumentRenderModel`.
  2. Encode required item kinds (`user`, `assistant-text`, `assistant-thinking`, etc.).
  3. Add stable IDs and action hooks for expand/collapse/launch.
- **Definition of done:**
  - Types are exported from a shared module and consumed by at least one adapter stub.
  - Type checks enforce required transcript item discriminants.
- **Evidence:** model file(s) + compile usage in shell adapter.

### A4. Introduce shell action model and input routing abstraction
- **Status:** Ready
- **Scope:** input/action layer decoupled from row-based geometry.
- **Dependencies:** A2, A3.
- **Steps:**
  1. Create action enum/union for scroll, follow toggle, prompt focus, overlays, surfaces.
  2. Refactor `input-controller` integration to dispatch actions via adapter.
  3. Preserve keybindings (`F1/F2/F3`, `ctrl+q`, interrupt, model cycling, command palette).
- **Definition of done:**
  - Legacy input controller no longer depends on fixed-row shell math for core behaviors.
  - Key mapping parity matrix is documented and validated.
- **Evidence:** action dispatcher wiring + parity doc/checklist.

---

## Epic B — Transcript Normalization and Rendering

### B1. Build runtime-to-transcript normalization pipeline
- **Status:** Ready
- **Scope:** replace direct `AgentMessage[] -> component` rendering path.
- **Dependencies:** A3.
- **Steps:**
  1. Implement normalization adapter producing typed `TranscriptItem[]`.
  2. Split assistant messages into text/thinking/tool-call/tool-result parts.
  3. Emit artifact/runtime status entries explicitly.
- **Definition of done:**
  - New adapter can process real captured sessions.
  - Thinking and tool blocks are preserved as structured parts.
- **Evidence:** adapter code + fixture-based tests on real captures.

### B2. Implement transcript-first scroll surface (OpenTUI)
- **Status:** Ready
- **Scope:** primary timeline component with follow/unfollow behavior.
- **Dependencies:** A1, A2, B1.
- **Steps:**
  1. Build main scrollbox renderer for transcript items.
  2. Add sticky-bottom follow when streaming.
  3. Add disengage behavior on upward scroll.
  4. Support keyboard and mouse navigation.
- **Definition of done:**
  - Full-history scroll works for long sessions.
  - Follow mode state is visible and controllable.
- **Evidence:** component implementation + interaction tests/smoke.

### B3. Inline thinking/tool collapse model
- **Status:** Ready
- **Scope:** collapsible transcript parts replacing thinking tray behavior.
- **Dependencies:** B1, B2.
- **Steps:**
  1. Add per-item expansion state keyed by stable transcript IDs.
  2. Render assistant thinking and tool outputs as collapsible sections.
  3. Remove dependence on `thinking-tray` in new shell path.
- **Definition of done:**
  - Thinking/tool sections can expand/collapse without losing scroll position.
  - Detached tray is absent from new shell execution path.
- **Evidence:** collapse state store + renderer + parity validation.

### B4. Compatibility bridge for `AppMessageSyncService`
- **Status:** Ready
- **Scope:** migration bridge from current services to new transcript publication model.
- **Dependencies:** B1.
- **Steps:**
  1. Add bridge API for publishing normalized transcript items.
  2. Wire `AppMessageSyncService` to bridge behind migration seam.
  3. Preserve old shell behavior while bridge is dual-target capable.
- **Definition of done:**
  - Service can target both legacy and new shell adapters.
  - No regression in existing message sync flow.
- **Evidence:** bridge wiring + dual-path tests.

---

## Epic C — Prompt/Composer and Core UX Parity

### C1. Implement docked prompt/composer surface
- **Status:** Ready
- **Scope:** prompt outside transcript scrollbox.
- **Dependencies:** A2, A4, B2.
- **Steps:**
  1. Build docked composer region with multiline editing.
  2. Keep prompt submission + interrupt/abort handling.
  3. Preserve pasted input and prompt restoration.
- **Definition of done:**
  - Prompt remains usable while transcript scrolls/streams.
  - Pending text survives overlay/surface transitions.
- **Evidence:** composer component + integration tests.

### C2. Prompt-adjacent control affordances
- **Status:** Ready
- **Scope:** model/runtime/tool expansion/thinking visibility controls.
- **Dependencies:** C1, A4.
- **Steps:**
  1. Add model selection/cycling controls.
  2. Add runtime switching affordance.
  3. Add thinking visibility and tool expansion preferences.
  4. Hook command palette launch.
- **Definition of done:**
  - All controls available without relying on legacy footer/menu rows.
- **Evidence:** UI control wiring + command mapping checks.

### C3. Minimal shell chrome/meta row
- **Status:** Ready
- **Scope:** replace heavy header/status/summary rows with compact context line.
- **Dependencies:** B2, C1.
- **Steps:**
  1. Add meta row with session label, runtime label, psmux host label, model/provider.
  2. Add compact streaming/idle and follow indicators.
  3. Add slim key-hints row.
- **Definition of done:**
  - Required context is visible with minimal persistent chrome.
  - No fixed dashboard-style row stack in new shell.
- **Evidence:** chrome components + before/after layout check.

---

## Epic D — Extension Host Compatibility and State Migration

### D1. Extension API behavior mapping layer
- **Status:** Ready
- **Scope:** preserve `setStatus`, `setWidget`, `setHeader`, `setFooter`, `custom`, editor replacement semantics.
- **Dependencies:** A2, C1, C3.
- **Steps:**
  1. Implement destination mapping strategy (meta row, overlay, drawer, transcript-adjacent card, secondary surface).
  2. Preserve tool expansion state accessors.
  3. Verify focus restoration behavior.
- **Definition of done:**
  - Extension APIs produce visible results in new shell.
  - No hard dependency on legacy `ShellView.tui` containers.
- **Evidence:** compatibility adapter + extension flow smoke tests.

### D2. `AppShellState` migration split
- **Status:** Ready
- **Scope:** separate behavior state from legacy layout state.
- **Dependencies:** A3, D1.
- **Steps:**
  1. Inventory current state fields in `src/app-state-store.ts`.
  2. Keep runtime/artifact/overlay/thinking/permission states.
  3. Add follow mode, expansion state, selected item, launched surfaces.
  4. Remove/deprecate row-layout-only fields.
- **Definition of done:**
  - New shell state model supports transcript-first behavior without legacy row assumptions.
- **Evidence:** state schema changes + migration notes.

---

## Epic E — Sessions, Overlays, and Secondary Surfaces

### E1. Move sessions browser out of split-pane shell
- **Status:** Ready
- **Scope:** sessions UI as overlay or secondary surface.
- **Dependencies:** A2, C1.
- **Steps:**
  1. Remove sessions split-pane dependency from main shell.
  2. Implement launch route to sessions browser overlay/surface.
  3. Preserve grouped sessions, current-session indicator, switching behavior.
- **Definition of done:**
  - Sessions workflow no longer requires side-by-side transcript layout.
- **Evidence:** session launch flow + interaction smoke test.

### E2. Implement `ShellSurfaceDescriptor` launch contract
- **Status:** Ready
- **Scope:** unified descriptor for overlay/drawer/secondary terminal launches.
- **Dependencies:** A3.
- **Steps:**
  1. Define descriptor fields and routing contract.
  2. Add launch manager that handles scope and initial payload.
  3. Add RPC/event-bus subscription hooks per surface.
- **Definition of done:**
  - New shell can open surfaces via typed descriptors.
- **Evidence:** surface manager + API tests.

### E3. Deliver one real v1 secondary surface via PSMUX
- **Status:** Ready
- **Scope:** concrete proof path (recommended: artifact/document viewer or sessions browser).
- **Dependencies:** E2.
- **Steps:**
  1. Choose v1 surface and formalize route.
  2. Wire launch through existing PSMUX plumbing.
  3. Validate open/focus/close lifecycle and reattach behavior.
- **Definition of done:**
  - End-to-end launch works from main shell into a secondary PSMUX-backed surface.
- **Evidence:** runtime smoke log + operator workflow recording.

---

## Epic F — Orchestration Event Integration

### F1. Orc event-bus transcript adapters
- **Status:** Ready
- **Scope:** map orchestration telemetry to transcript items (`subagent-event`, `checkpoint`, `runtime-status`, `error`).
- **Dependencies:** A3, B2.
- **Steps:**
  1. Add adapter from Orc event stream/RPC telemetry to transcript model.
  2. Normalize timestamps, source IDs, and status severity.
  3. Render in timeline with compact/expanded detail views.
- **Definition of done:**
  - Coding and orchestration events coexist in one timeline.
- **Evidence:** adapters + captured-event fixture tests.

### F2. Preserve orchestration commands while remapping presentation
- **Status:** Ready
- **Scope:** keep workflows like `openOrchestrationOverlay()` functional.
- **Dependencies:** F1, E2.
- **Steps:**
  1. Route existing orchestration command entry points to new surfaces.
  2. Keep launch/attach status visible via transcript/meta rather than dedicated stripe.
  3. Validate behavior under external session reattach.
- **Definition of done:**
  - Orchestration commands remain discoverable and operational in new shell.
- **Evidence:** command-path integration tests + manual smoke notes.

---

## Epic G — Trusted MDX Rich-Document Pipeline

### G1. Implement trusted/untrusted document classification
- **Status:** Ready
- **Scope:** safety boundary before render.
- **Dependencies:** A3.
- **Steps:**
  1. Define document trust metadata and source policy.
  2. Add classifier in rich-document load path.
  3. Ensure untrusted markdown cannot execute shell components.
- **Definition of done:**
  - Documents are deterministically routed to trusted MDX or safe markdown renderer.
- **Evidence:** policy module + security-oriented tests.

### G2. Add trusted MDX compile/render bridge
- **Status:** Ready
- **Scope:** `RichDocumentSource -> RichDocumentRenderModel -> OpenTUI components`.
- **Dependencies:** G1, A1.
- **Steps:**
  1. Add compiler pipeline for trusted sources.
  2. Implement constrained component allowlist (headings, callouts, code, metadata, links, timeline cards, collapsibles).
  3. Map render model to terminal components.
- **Definition of done:**
  - Trusted artifact-class documents render through the new path.
- **Evidence:** compile+render tests with trusted fixtures.

### G3. Untrusted markdown fallback renderer
- **Status:** Ready
- **Scope:** safe rendering path for agent/user/tool content.
- **Dependencies:** G1.
- **Steps:**
  1. Add markdown/plain renderer for untrusted content.
  2. Ensure feature parity for code blocks/links/basic formatting.
  3. Validate no MDX component execution occurs in fallback path.
- **Definition of done:**
  - Untrusted text renders correctly and safely.
- **Evidence:** fallback tests + negative execution checks.

---

## Epic H — Legacy Removal, Documentation, and Cutover

### H1. Remove legacy main-shell-only components from default path
- **Status:** Ready
- **Scope:** `thinking-tray`, split-pane container, fixed-height math.
- **Dependencies:** B3, E1, C3.
- **Steps:**
  1. Remove `thinking-tray` from active main-shell render path.
  2. Remove side-by-side transcript+sessions default behavior.
  3. Remove fixed-row layout calculations from default shell path.
- **Definition of done:**
  - Default shell starts transcript-first with docked prompt and minimal chrome.
- **Evidence:** code removal diff + startup verification.

### H2. Flip default shell and keep rollback switch
- **Status:** Ready
- **Scope:** production selection toggle.
- **Dependencies:** all critical parity tasks (B–F).
- **Steps:**
  1. Set new shell as default selection path.
  2. Keep rollback flag for one release cycle.
  3. Track post-cutover defects against parity checklist.
- **Definition of done:**
  - New shell is default and core workflows pass acceptance criteria.
- **Evidence:** config change + release note + parity signoff.

### H3. Update architecture docs and operator guides
- **Status:** Ready
- **Scope:** documentation handoff for internal/external engineers.
- **Dependencies:** H2, G2/G3.
- **Steps:**
  1. Update `docs/shellview.md` or publish successor architecture document.
  2. Document transcript model, extension mapping, and surface-launch contract.
  3. Add troubleshooting guide for follow mode, expansion state, and surface launch failures.
- **Definition of done:**
  - New shell architecture and operations are documented for external contributors.
- **Evidence:** docs diff + reviewer signoff.

---

## Cross-cutting QA tasks (must run throughout implementation)

### Q1. Smoke harness for shell workflows (real runtime)
- **Status:** Ready
- **Dependencies:** A2 onward.
- **Checks:** app launch, prompt submit, long streaming reply, full-history scroll, expand/collapse thinking, expand/collapse tool output, model/runtime switch, secondary surface launch, sessions replacement workflow, F1/F2/F3 entries, extension custom flow.
- **Done when:** scripted or repeatable manual harness exists and is run per milestone.

### Q2. Adapter integration tests with real captured data
- **Status:** Ready
- **Dependencies:** B1, F1.
- **Checks:** coding transcript normalization, orchestration event normalization, extension-host compatibility behavior.
- **Done when:** non-mocked tests pass against curated real captures.

### Q3. Rich-document safety and rendering tests
- **Status:** Ready
- **Dependencies:** G1–G3.
- **Checks:** trusted MDX compile success, untrusted markdown fallback, blocked unsafe component execution.
- **Done when:** automated tests pass with explicit safety assertions.

---

## Suggested implementation order (critical path)

1. **A1 → A2 → A3 → A4** (foundation)
2. **B1 → B2 → B3 → B4** (transcript pipeline + bridge)
3. **C1 → C2 → C3** (prompt + core UX parity)
4. **D1 → D2** (extension/state compatibility)
5. **E2 → E1 → E3** (surface contracts + sessions + one real secondary surface)
6. **F1 → F2** (orchestration timeline integration)
7. **G1 → G2 → G3** (MDX safe rich docs)
8. **H1 → H2 → H3** (legacy removal + cutover + docs)
9. Run **Q1/Q2/Q3** continuously at each phase gate.

---

## Ready-to-start checklist for engineering lead

- [ ] Assign owners for Epics A–H.
- [ ] Confirm v1 secondary surface choice (sessions browser vs artifact viewer).
- [ ] Approve keybinding parity table (especially F1/F2/F3 replacement strategy if remapped).
- [ ] Approve trusted MDX allowlist and trust policy.
- [ ] Schedule Windows + PowerShell + PSMUX validation windows for each phase gate.
- [ ] Define cutover release criteria and rollback decision owner.
