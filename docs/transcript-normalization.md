# Transcript normalization for TUI rendering

## Why this layer exists

Historically the renderer walked `AgentMessage[]` directly and made implicit assumptions about ordering and shape:

- assistant text/thinking/tool calls were interpreted inline during render,
- tool results were attached by ad hoc lookup,
- non-core assistant parts (for example runtime status/artifact payloads) had no typed timeline representation.

The new normalization step converts raw messages into typed `TranscriptItem[]` before rendering so downstream UI code can consume a stable timeline model.

## Normalization contract

`src/transcript-normalizer.ts` exposes:

- `normalizeTranscript(messages: AgentMessage[]): NormalizedTranscript`
- `NormalizedTranscript.items: TranscriptItem[]`
- `NormalizedTranscript.unknownMessages: AgentMessage[]`

Behavior:

1. `user` messages -> `TranscriptItem(kind="user")`
2. `assistant` content is split into one item per part:
   - text -> `assistant-text`
   - thinking -> `assistant-thinking`
   - toolCall -> `tool-call`
   - status -> `runtime-status`
   - artifact -> `artifact`
3. `toolResult` messages -> `tool-result` items with tool name backfilled from preceding tool calls.
4. unsupported message roles (currently `bashExecution`) are preserved in `unknownMessages` for fallback rendering.

The normalizer is deterministic: item IDs and part IDs are generated from monotonic counters so the same input yields byte-stable output.

## Renderer integration

`src/message-renderer.ts` now consumes `normalizeTranscript(...)` instead of iterating `AgentMessage[]` directly.

- `user`, `assistant-text`, and `assistant-thinking` items map to existing coding-agent components.
- `tool-call` creates a `ToolExecutionComponent`.
- `tool-result` resolves against queued components by tool name and updates result payloads.
- `artifact` and `runtime-status` are emitted as explicit timeline rows (currently Markdown summary rows).
- `unknownMessages` still render as JSON fallback blocks to preserve debuggability.

## Fixture-based stability checks

`test/transcript-normalizer.test.ts` validates both shape coverage and stability against captured real sessions:

- `coding-agent/test/fixtures/large-session.jsonl`
- `coding-agent/test/fixtures/before-compaction.jsonl`

The tests assert:

- deterministic output across repeated normalization runs,
- required core timeline kinds are present,
- unknown-role behavior is explicit and stable (expected `bashExecution` passthrough).

This gives outside engineers a reproducible baseline when extending transcript kinds or renderer behavior.
