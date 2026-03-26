# RPC launcher module for Orc/Inquisitor/Alchemist

This document describes the process-launch boundary implemented in `src/orchestration/bridge/rpc_launcher.ts`.

## Why this module exists

The orchestration runtime needs a strict way to bootstrap multiple agents from `resources/pi-mono-main` in RPC mode while preserving:

1. **Independent process identity** for Orc, Inquisitor, and Alchemist.
2. **Typed command envelopes** sent over stdin.
3. **Typed telemetry envelopes** emitted over stdout as JSONL.
4. **Per-agent restart policy** so one failing process does not collapse the whole swarm.

## Launch behavior

`RpcProcessLauncher` spawns one process per configured role with default command arguments:

```text
node src/cli.ts --mode rpc --agent <role>
```

Each process uses `cwd = <repo>/resources/pi-mono-main` by default to ensure all agents execute from the pi-mono runtime tree.

## Typed wire contracts

### Command envelope (`stdin`)

`RpcCommandEnvelope<TPayload>` captures contract fields for command dispatch:

- `schema`: fixed `"pi.rpc.command.v1"` sentinel for protocol versioning.
- `requestId`: client correlation id.
- `issuedAt`: ISO timestamp.
- `target`: `RpcAgentProcessIdentity` so the receiver can reject stale commands.
- `command.kind`: semantic command name (e.g., `initialize`, `execute`, `shutdown`).
- `command.payload`: generic payload with caller-defined type.

### Telemetry envelope (`stdout`)

`RpcTelemetryEnvelope<TPayload>` defines the output stream contract:

- `schema`: fixed `"pi.rpc.telemetry.v1"` sentinel.
- `eventId`: event correlation id.
- `emittedAt`: ISO timestamp.
- `source`: process identity for role/instance/attempt attribution.
- `telemetry.kind`: event type (e.g., `ready`, `progress`, `fault`).
- `telemetry.severity`: `debug | info | warning | error`.
- `telemetry.payload`: typed event payload.

## Process identity model

Each launch receives a unique `RpcAgentProcessIdentity`:

- `agentRole`: `orc` | `inquisitor` | `alchemist`.
- `agentId`: stable logical id from configuration.
- `instanceId`: UUID-backed per-launch instance token.
- `launchAttempt`: monotonic restart attempt index.
- `pid`: assigned after spawn.

This identity is surfaced in runtime snapshots and should be propagated in command and telemetry flows.

## Restart policy model

`RpcRestartPolicy` supports:

- `enabled`: global switch.
- `maxRestarts`: cap per role.
- `restartDelayMs`: backoff delay.
- `shouldRestart(context)`: per-exit policy hook.

Restarts are **role-local**: an Orc crash increments Orc restart count only; Inquisitor and Alchemist continue unaffected unless their own exits satisfy policy.

## Operational notes

- Stdout is parsed as strict JSONL. Non-JSON or malformed payloads are routed through the stderr callback path.
- `stopAgent()` marks `stopRequested`, sends SIGTERM, and suppresses auto-restart for that exit.
- `getAgentState(role)` returns immutable snapshots suitable for health dashboards.
