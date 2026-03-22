from __future__ import annotations

import json
import os
import platform
import sys
import traceback
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

RUNNER_VERSION = "0.1.0"


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
    phase_intent: str
    security_policy: SecurityPolicySnapshot
    resume: ResumeContext = field(default_factory=ResumeContext)
    checkpoint_id: str | None = None
    run_correlation_id: str | None = None
    graph_name: str = "orc_langgraph"
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
            metadata=dict(payload.get("metadata") or {}),
        )


class OrcRunnerTelemetryEmitter:
    def __init__(self, launch_input: OrcRunnerLaunchInput) -> None:
        self.launch_input = launch_input
        self.sequence = 0

    def emit(self, *, category: str, name: str, status: str, severity: str = "info", payload: Mapping[str, Any] | None = None) -> None:
        self.sequence += 1
        event = {
            "origin": {
                "runCorrelationId": self.launch_input.run_correlation_id,
                "eventId": f"{self.launch_input.thread_id}:{self.sequence}",
                "streamSequence": self.sequence,
                "emittedAt": _utc_now(),
                "source": "python_runner",
                "threadId": self.launch_input.thread_id,
                "phase": self.launch_input.phase_intent,
            },
            "who": {
                "kind": "system",
                "id": "orc-python-runner",
                "label": "Orc Python Runner",
                "runCorrelationId": self.launch_input.run_correlation_id,
            },
            "what": {
                "category": category,
                "name": name,
                "severity": severity,
                "status": status,
            },
            "how": {
                "channel": "stdout_jsonl",
                "interactionTarget": "computer",
                "environment": "transport",
                "transport": "python_child_process",
                "checkpointId": self.launch_input.resume.checkpoint_id or self.launch_input.checkpoint_id,
            },
            "when": _utc_now(),
            "rawPayload": {
                "namespace": "orc.python_runner",
                "payload": dict(payload or {}),
            },
        }
        sys.stdout.write(json.dumps(event, separators=(",", ":"), sort_keys=False) + "\n")
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
        emitter.emit(
            category="lifecycle",
            name="process_start",
            status="started",
            payload={
                "runnerVersion": RUNNER_VERSION,
                "pythonVersion": platform.python_version(),
                "platform": platform.platform(),
                "cwd": os.getcwd(),
            },
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
            },
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
        )
        emitter.emit(
            category="lifecycle",
            name="graph_shutdown",
            status="succeeded",
            payload={
                "graphName": launch_input.graph_name,
                "reason": "bootstrap_complete",
            },
        )
        return 0
    except Exception as exc:  # noqa: BLE001
        fallback_input = OrcRunnerLaunchInput(
            thread_id="unknown-thread",
            project_root="",
            workspace_root="",
            phase_intent="failed",
            security_policy=SecurityPolicySnapshot(),
            run_correlation_id=f"orc-run-{uuid.uuid4()}",
        )
        emitter = OrcRunnerTelemetryEmitter(fallback_input)
        emitter.diagnostic(f"[orc-runner] fatal: {exc}")
        emitter.diagnostic(traceback.format_exc())
        emitter.emit(
            category="diagnostic",
            name="fatal_exception",
            status="failed",
            severity="critical",
            payload={
                "errorType": exc.__class__.__name__,
                "message": str(exc),
                "traceback": traceback.format_exc().splitlines(),
            },
        )
        return 1


def _read_launch_payload() -> Mapping[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("expected JSON launch payload on stdin")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise TypeError("launch payload must be a JSON object")
    return payload


def _validate_launch_input(launch_input: OrcRunnerLaunchInput) -> None:
    for field_name in ("thread_id", "project_root", "workspace_root", "phase_intent"):
        if not getattr(launch_input, field_name):
            raise ValueError(f"{field_name} is required")
    for root in (launch_input.project_root, launch_input.workspace_root):
        if not Path(root).is_absolute():
            raise ValueError(f"expected absolute path for root: {root}")


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
