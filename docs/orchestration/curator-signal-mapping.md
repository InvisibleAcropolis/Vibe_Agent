# Curator Signal Mapping (`curator.signal.v1`)

This document defines the stable visual signal contract emitted by `RpcEventCurator` snapshots.

## Signal schema

Each `CuratorSnapshot` includes:

- `signal.version`: fixed to `"curator.signal.v1"`
- `signal.key`: `${element}:${stage}`
- `signal.element`: `water` or `fire`
- `signal.stage`: `idle | active | retrying | recovering | completed | cancelled | failed | fault | timed_out`
- `signal.retryActive`, `signal.retryAttempt`, `signal.retryMaxAttempts`
- `signal.failureActive`, `signal.recoveryActive`
- `signal.detail`: latest error/finish detail when available

## Deterministic transition precedence

The resolver always applies this exact priority order:

1. `timed_out` → `fire:timed_out`
2. `retryActive === true` → `fire:retrying`
3. terminal `status === ended`:
   - `finishReason === completed` → `water:completed`
   - `finishReason === cancelled` → `water:cancelled`
   - all other reasons → `fire:failed`
4. `recoveryActive === true` → `water:recovering`
5. `failureActive === true` → `fire:fault`
6. running state → `water:active`
7. fallback → `water:idle`

Because precedence is fixed, identical event streams always produce identical signal sequences.

## RPC event mapping rules

The curator consumes a subset of RPC events from `packages/coding-agent/docs/rpc.md`:

- `agent_start`: reset to clean running state (`water:active`)
- `tool_execution_update` with `status=failed`: set fault tracking (`fire:fault` unless overridden by retry/terminal)
- `auto_retry_start`: set retry active and failure active (`fire:retrying`)
- `auto_retry_end` with `success=true`: clear failure and mark recovering (`water:recovering`)
- `auto_retry_end` with `success=false`: keep failure active (`fire:fault` or `fire:failed` at end)
- `extension_error`: mark failure active (`fire:fault`)
- `agent_end`: convert to terminal signal (`water:completed`, `water:cancelled`, or `fire:failed`)

## Renderer contract

Frontends/TUI renderers should consume `snapshot.signal.key` as the canonical visual state selector.
This avoids re-implementing event interpretation in each renderer.
