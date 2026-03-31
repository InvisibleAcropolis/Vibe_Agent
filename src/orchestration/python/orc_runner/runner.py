from __future__ import annotations

"""Strict JSONL telemetry emitter for the Orc Python orchestration runner.

Stdout is reserved exclusively for newline-delimited JSON objects so the TypeScript
transport can parse each line independently without pretty-printing, multiline payloads,
or out-of-band text. Stderr remains the only channel for human-oriented diagnostics.

Event contract summary for transport implementers:
- each stdout write is exactly one compact JSON object followed by ``\n``;
- every event carries a per-run ``origin.runCorrelationId`` and monotonic
  ``origin.streamSequence``;
- canonical ``who``/``what``/``how``/``when`` fields stay stable for reducers;
- raw upstream material is preserved under ``rawPayload`` using the
  ``orc.python_runner.upstream`` namespace;
- oversized, multiline, or binary-like values are normalized into single-line,
  size-bounded JSON-safe structures before emission.
"""

import base64
import json
import os
import platform
import sys
import time
import traceback
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence
from .deepagent_graph import run_orc_deepagent

RUNNER_VERSION = "0.2.0"
_MAX_STRING_LENGTH = 400
_MAX_COLLECTION_ITEMS = 20
_MAX_DEPTH = 6
_BINARY_SNIPPET_BYTES = 24


@dataclass(slots=True)
class SecurityPolicySnapshot:
    allowed_working_directories: list[str] = field(default_factory=list)
    blocked_command_patterns: list[str] = field(default_factory=list)
    maximum_concurrency: int = 1
    requires_approval_after: int = 1
    escalation_reasons: list[str] = field(default_factory=list)
    worker_workspace_root: str = ""
    worker_durable_root: str = ""
    worker_write_allowed_paths: list[str] = field(default_factory=list)
    worker_blocked_command_patterns: list[str] = field(default_factory=list)
    session_kind: str = "main-app"


@dataclass(slots=True)
class ResumeContext:
    checkpoint_id: str | None = None
    checkpoint_storage_path: str | None = None
    resume_token: str | None = None
    resume_cursor: str | None = None
    active_wave_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class OrcRunnerLaunchInput:
    thread_id: str
    project_root: str
    workspace_root: str
    prompt: str
    phase_intent: str
    security_policy: SecurityPolicySnapshot
    resume: ResumeContext = field(default_factory=ResumeContext)
    checkpoint_id: str | None = None
    run_correlation_id: str | None = None
    graph_name: str = "orc_langgraph"
    selected_provider_id: str | None = None
    selected_model_id: str | None = None
    model_spec: str | None = None
    runner_context_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_mapping(cls, payload: Mapping[str, Any]) -> "OrcRunnerLaunchInput":
        security_payload = payload.get("securityPolicy") or payload.get("security_policy") or {}
        worker_sandbox = security_payload.get("workerSandbox") or security_payload.get("worker_sandbox") or {}
        human_thresholds = security_payload.get("humanEscalationThresholds") or security_payload.get("human_escalation_thresholds") or {}
        resume_payload = payload.get("resume") or payload.get("resumeContext") or payload.get("resume_context") or {}
        return cls(
            thread_id=str(payload["threadId"]),
            project_root=str(payload.get("projectRoot") or payload.get("workspaceRoot") or ""),
            workspace_root=str(payload.get("workspaceRoot") or payload.get("projectRoot") or ""),
            prompt=str(payload.get("prompt") or ""),
            phase_intent=str(payload.get("phaseIntent") or payload.get("phase") or "bootstrapping"),
            security_policy=SecurityPolicySnapshot(
                allowed_working_directories=_string_list(security_payload.get("allowedWorkingDirectories")),
                blocked_command_patterns=_string_list(security_payload.get("blockedCommandPatterns")),
                maximum_concurrency=int(security_payload.get("maximumConcurrency", 1)),
                requires_approval_after=int(human_thresholds.get("requiresApprovalAfter", 1)),
                escalation_reasons=_string_list(human_thresholds.get("reasons")),
                worker_workspace_root=str(worker_sandbox.get("workspaceRoot") or ""),
                worker_durable_root=str(worker_sandbox.get("durableRoot") or ""),
                worker_write_allowed_paths=_string_list(worker_sandbox.get("writeAllowedPaths")),
                worker_blocked_command_patterns=_string_list(worker_sandbox.get("blockedCommandPatterns")),
                session_kind=str(security_payload.get("sessionKind") or "main-app"),
            ),
            resume=ResumeContext(
                checkpoint_id=_optional_string(resume_payload.get("checkpointId") or payload.get("checkpointId")),
                checkpoint_storage_path=_optional_string(resume_payload.get("checkpointStoragePath")),
                resume_token=_optional_string(resume_payload.get("resumeToken")),
                resume_cursor=_optional_string(resume_payload.get("resumeCursor")),
                active_wave_id=_optional_string(resume_payload.get("activeWaveId")),
                metadata=dict(resume_payload.get("metadata") or {}),
            ),
            checkpoint_id=_optional_string(payload.get("checkpointId")),
            run_correlation_id=_optional_string(payload.get("runCorrelationId")) or f"orc-run-{uuid.uuid4()}",
            graph_name=str(payload.get("graphName") or "orc_langgraph"),
            selected_provider_id=_optional_string(payload.get("selectedProviderId")),
            selected_model_id=_optional_string(payload.get("selectedModelId")),
            model_spec=_optional_string(payload.get("modelSpec")),
            runner_context_id=_optional_string(payload.get("runnerContextId")),
            metadata=dict(payload.get("metadata") or {}),
        )


@dataclass(slots=True)
class TelemetryActor:
    kind: str
    id: str
    label: str
    worker_id: str | None = None


class OrcRunnerTelemetryEmitter:
    """Emit strict single-line JSONL telemetry for the TypeScript transport.

    The emitter owns the stdout contract: each call serializes one compact JSON object,
    appends a single trailing newline, and flushes immediately. Callers should pass raw
    upstream metadata separately from canonical payload details so downstream reducers can
    rely on canonical fields while debuggers retain provider-native context.
    """

    def __init__(self, launch_input: OrcRunnerLaunchInput) -> None:
        self.launch_input = launch_input
        self.sequence = 0
        self._monotonic_start = time.monotonic_ns()

    def emit(
        self,
        *,
        category: str,
        name: str,
        status: str,
        severity: str = "info",
        who: TelemetryActor | None = None,
        how: Mapping[str, Any] | None = None,
        payload: Mapping[str, Any] | None = None,
        raw_payload: Mapping[str, Any] | None = None,
        raw_namespace: str = "orc.python_runner.upstream",
        parent_event_id: str | None = None,
        wave_id: str | None = None,
        worker_id: str | None = None,
    ) -> None:
        self.sequence += 1
        emitted_at = _utc_now()
        event_id = f"{self.launch_input.thread_id}:{self.sequence}"
        actor = who or TelemetryActor(kind="system", id="orc-python-runner", label="Orc Python Runner")
        transport_metadata = {
            "channel": "stdout_jsonl",
            "interactionTarget": "computer",
            "environment": "transport",
            "transport": "python_child_process",
            "checkpointId": self.launch_input.resume.checkpoint_id or self.launch_input.checkpoint_id,
        }
        if how:
            transport_metadata.update(dict(how))
        event = {
            "origin": {
                "runCorrelationId": self.launch_input.run_correlation_id,
                "eventId": event_id,
                "streamSequence": self.sequence,
                "emittedAt": emitted_at,
                "source": "python_runner",
                "threadId": self.launch_input.thread_id,
                "phase": self.launch_input.phase_intent,
                "waveId": wave_id,
                "workerId": worker_id or actor.worker_id,
                "parentEventId": parent_event_id,
                "monotonicNs": time.monotonic_ns() - self._monotonic_start,
            },
            "who": {
                "kind": actor.kind,
                "id": actor.id,
                "label": actor.label,
                "workerId": actor.worker_id,
                "runCorrelationId": self.launch_input.run_correlation_id,
            },
            "what": {
                "category": category,
                "name": name,
                "severity": severity,
                "status": status,
            },
            "how": transport_metadata,
            "when": emitted_at,
            "payload": _sanitize_for_json(payload or {}, path="payload"),
            "rawPayload": {
                "namespace": raw_namespace,
                "payload": _sanitize_for_json(raw_payload or payload or {}, path="rawPayload"),
            },
        }
        serialized = json.dumps(_drop_none(event), separators=(",", ":"), sort_keys=False, ensure_ascii=False)
        sys.stdout.write(serialized + "\n")
        sys.stdout.flush()

    def diagnostic(self, message: str) -> None:
        sys.stderr.write(message.rstrip() + "\n")
        sys.stderr.flush()


def main(argv: list[str] | None = None) -> int:
    _ = argv or sys.argv[1:]
    try:
        payload = _read_launch_payload()
        launch_input = OrcRunnerLaunchInput.from_mapping(payload)
        _validate_launch_input(launch_input)
        emitter = OrcRunnerTelemetryEmitter(launch_input)
        emitter.diagnostic(
            f"[orc-runner] boot thread={launch_input.thread_id} graph={launch_input.graph_name} cwd={os.getcwd()}"
        )
        boot_event_id = _emit_bootstrap_sequence(emitter, launch_input, payload)
        run_orc_deepagent(launch_input, emitter)
        emitter.emit(
            category="lifecycle",
            name="completion",
            status="succeeded",
            payload={
                "graphName": launch_input.graph_name,
                "reason": "deepagent_run_complete",
                "emittedCategories": sorted(
                    {
                        "lifecycle",
                        "checkpoint",
                        "agent_message",
                    }
                ),
            },
            raw_payload={"completion": True, "graphName": launch_input.graph_name},
            how={"interactionTarget": "user", "environment": "worker"},
            who=TelemetryActor(kind="agent", id=launch_input.graph_name, label="Orc Graph"),
        )
        return 0
    except Exception as exc:  # noqa: BLE001
        fallback_input = OrcRunnerLaunchInput(
            thread_id="unknown-thread",
            project_root="",
            workspace_root="",
            prompt="",
            phase_intent="failed",
            security_policy=SecurityPolicySnapshot(),
            run_correlation_id=f"orc-run-{uuid.uuid4()}",
        )
        emitter = OrcRunnerTelemetryEmitter(fallback_input)
        emitter.diagnostic(f"[orc-runner] fatal: {exc}")
        emitter.diagnostic(traceback.format_exc())
        emitter.emit(
            category="diagnostic",
            name="failure",
            status="failed",
            severity="critical",
            payload={
                "errorType": exc.__class__.__name__,
                "message": str(exc),
                "traceback": traceback.format_exc().splitlines(),
            },
            raw_payload={
                "exception": {
                    "type": exc.__class__.__name__,
                    "message": str(exc),
                    "traceback": traceback.format_exc(),
                }
            },
        )
        return 1


def _emit_bootstrap_sequence(
    emitter: OrcRunnerTelemetryEmitter,
    launch_input: OrcRunnerLaunchInput,
    stdin_payload: Mapping[str, Any],
) -> str:
    emitter.emit(
        category="lifecycle",
        name="process_start",
        status="started",
        payload={
            "runnerVersion": RUNNER_VERSION,
            "pythonVersion": platform.python_version(),
            "platform": platform.platform(),
            "cwd": os.getcwd(),
            "stdinKeys": sorted(str(key) for key in stdin_payload.keys()),
        },
        raw_payload={"stdin": stdin_payload},
    )
    emitter.emit(
        category="lifecycle",
        name="graph_initialization",
        status="started",
        payload={
            "graphName": launch_input.graph_name,
            "phaseIntent": launch_input.phase_intent,
            "projectRoot": launch_input.project_root,
            "workspaceRoot": launch_input.workspace_root,
            "providerId": launch_input.selected_provider_id,
            "modelId": launch_input.selected_model_id,
            "modelSpec": launch_input.model_spec,
        },
        raw_payload={"launchInput": stdin_payload},
        who=TelemetryActor(kind="agent", id=launch_input.graph_name, label="Orc Graph"),
        how={"environment": "worker"},
    )
    emitter.emit(
        category="checkpoint",
        name="checkpoint_restore_attempt",
        status="started",
        payload={
            "checkpointId": launch_input.resume.checkpoint_id or launch_input.checkpoint_id,
            "resumeToken": launch_input.resume.resume_token,
            "resumeCursor": launch_input.resume.resume_cursor,
            "activeWaveId": launch_input.resume.active_wave_id,
            "checkpointStoragePath": launch_input.resume.checkpoint_storage_path,
            "resumeMetadata": launch_input.resume.metadata,
        },
        raw_payload={"resume": launch_input.resume.metadata, "checkpointId": launch_input.checkpoint_id},
    )
    return f"{launch_input.thread_id}:1"
        payload={
            "subagentId": subagent_actor.id,
            "workerId": subagent_actor.worker_id,
            "role": "planner",
            "waveId": wave_id,
        },
        raw_payload={"subagent": {"id": subagent_actor.id, "role": "planner", "metadata": stdin_payload.get("metadata", {})}},
        parent_event_id=parent_event_id,
        wave_id=wave_id,
        worker_id=subagent_actor.worker_id,
    )
    emitter.emit(
        category="agent_message",
        name="user_facing_message",
        status="streaming",
        who=subagent_actor,
        how={"interactionTarget": "user", "environment": "worker"},
        payload={
            "messageId": "msg-plan-1",
            "content": "Planning orchestration telemetry contract.\nEach stdout record remains strict JSONL.",
def _read_launch_payload() -> Mapping[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("expected JSON launch payload on stdin")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise TypeError("launch payload must be a JSON object")
    return payload


def _validate_launch_input(launch_input: OrcRunnerLaunchInput) -> None:
    for field_name in ("thread_id", "project_root", "workspace_root", "phase_intent", "prompt"):
        if not getattr(launch_input, field_name):
            raise ValueError(f"{field_name} is required")
    for root in (launch_input.project_root, launch_input.workspace_root):
        if not Path(root).is_absolute():
            raise ValueError(f"expected absolute path for root: {root}")
    if not launch_input.model_spec:
        raise ValueError("model_spec is required")


def _sanitize_for_json(value: Any, *, path: str, depth: int = 0) -> Any:
    """Normalize arbitrary upstream data into strict single-line JSON-safe values.

    Policy:
    - strings keep content but replace literal newlines with escaped ``\\n`` and truncate
      values beyond ``_MAX_STRING_LENGTH`` characters;
    - bytes / bytearray / memoryview are treated as binary-like payloads and summarized
      with length plus a short base64 preview;
    - mappings and sequences recurse up to ``_MAX_DEPTH`` and limit item counts to
      ``_MAX_COLLECTION_ITEMS``;
    - unsupported objects fall back to ``repr(value)`` and are then normalized as strings.
    """
    if depth >= _MAX_DEPTH:
        return {"truncated": True, "reason": "max_depth", "path": path, "type": type(value).__name__}
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        single_line = value.replace("\r\n", "\n").replace("\r", "\n").replace("\n", r"\n")
        if len(single_line) <= _MAX_STRING_LENGTH:
            return single_line
        return {
            "truncated": True,
            "type": "string",
            "path": path,
            "originalLength": len(single_line),
            "preview": single_line[:_MAX_STRING_LENGTH],
        }
    if isinstance(value, (bytes, bytearray, memoryview)):
        raw_bytes = bytes(value)
        return {
            "truncated": True,
            "type": "binary",
            "path": path,
            "byteLength": len(raw_bytes),
            "base64Preview": base64.b64encode(raw_bytes[:_BINARY_SNIPPET_BYTES]).decode("ascii"),
        }
    if isinstance(value, Mapping):
        items = list(value.items())
        sanitized: dict[str, Any] = {}
        for key, nested_value in items[:_MAX_COLLECTION_ITEMS]:
            sanitized[str(key)] = _sanitize_for_json(nested_value, path=f"{path}.{key}", depth=depth + 1)
        if len(items) > _MAX_COLLECTION_ITEMS:
            sanitized["__truncated__"] = {
                "reason": "max_items",
                "kept": _MAX_COLLECTION_ITEMS,
                "total": len(items),
                "path": path,
            }
        return sanitized
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray, memoryview)):
        items = list(value)
        sanitized_items = [
            _sanitize_for_json(item, path=f"{path}[{index}]", depth=depth + 1)
            for index, item in enumerate(items[:_MAX_COLLECTION_ITEMS])
        ]
        if len(items) > _MAX_COLLECTION_ITEMS:
            sanitized_items.append(
                {
                    "truncated": True,
                    "reason": "max_items",
                    "kept": _MAX_COLLECTION_ITEMS,
                    "total": len(items),
                    "path": path,
                }
            )
        return sanitized_items
    return _sanitize_for_json(repr(value), path=path, depth=depth + 1)


def _drop_none(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _drop_none(nested) for key, nested in value.items() if nested is not None}
    if isinstance(value, list):
        return [_drop_none(item) for item in value]
    return value


def _string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise TypeError(f"expected list[str], got {type(value).__name__}")
    return [str(item) for item in value]


def _optional_string(value: Any) -> str | None:
    if value in (None, ""):
        return None
    return str(value)


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
