from __future__ import annotations

import sys
from pathlib import Path
from typing import Any
from types import SimpleNamespace


def run_orc_deepagent(launch_input, emitter) -> None:
    repo_root = _install_vendor_paths()

    from deepagents import create_deep_agent
    from deepagents.backends import LocalShellBackend

    if not launch_input.model_spec:
        raise RuntimeError("Orc launch input did not provide a deepagent model spec.")

    graph_actor = launch_input.graph_name
    agent_actor = {
        "kind": "agent",
        "id": graph_actor,
        "label": "Orc Deepagent",
    }

    emitter.emit(
        category="lifecycle",
        name="graph_initialized",
        status="succeeded",
        who=as_actor(agent_actor),
        how={"environment": "worker"},
        payload={
            "graphId": graph_actor,
            "stage": "initialized",
            "providerId": launch_input.selected_provider_id,
            "modelId": launch_input.selected_model_id,
            "modelSpec": launch_input.model_spec,
            "workspaceRoot": launch_input.workspace_root,
            "projectRoot": launch_input.project_root,
        },
        raw_payload={"repoRoot": str(repo_root)},
    )

    backend = LocalShellBackend(
        root_dir=launch_input.workspace_root,
        inherit_env=True,
        virtual_mode=False,
    )
    agent = create_deep_agent(
        model=launch_input.model_spec,
        backend=backend,
        system_prompt=build_orc_system_prompt(launch_input),
        name=graph_actor,
    )

    emitter.emit(
        category="lifecycle",
        name="graph_running",
        status="started",
        who=as_actor(agent_actor),
        how={"environment": "worker"},
        payload={
            "graphId": graph_actor,
            "stage": "running",
            "providerId": launch_input.selected_provider_id,
            "modelId": launch_input.selected_model_id,
            "modelSpec": launch_input.model_spec,
        },
        raw_payload={"prompt": launch_input.prompt},
    )

    try:
        result = agent.invoke({"messages": [{"role": "user", "content": launch_input.prompt}]})
    except Exception as exc:  # noqa: BLE001
        emitter.emit(
            category="lifecycle",
            name="graph_failed",
            status="failed",
            severity="error",
            who=as_actor(agent_actor),
            how={"environment": "worker"},
            payload={
                "graphId": graph_actor,
                "stage": "failed",
                "reason": str(exc),
            },
            raw_payload={"errorType": exc.__class__.__name__, "message": str(exc)},
        )
        raise

    final_text = extract_final_text(result)
    emitter.emit(
        category="agent_message",
        name="assistant_response",
        status="succeeded",
        who=as_actor(agent_actor),
        how={"interactionTarget": "user", "environment": "worker"},
        payload={
            "messageId": f"{launch_input.thread_id}:assistant:final",
            "content": final_text,
            "role": "assistant",
            "audience": "operator",
            "agentId": graph_actor,
            "streamState": "final",
        },
        raw_payload={"result": summarize_result(result)},
    )
    emitter.emit(
        category="lifecycle",
        name="graph_completed",
        status="succeeded",
        who=as_actor(agent_actor),
        how={"environment": "worker"},
        payload={
            "graphId": graph_actor,
            "stage": "completed",
            "providerId": launch_input.selected_provider_id,
            "modelId": launch_input.selected_model_id,
            "modelSpec": launch_input.model_spec,
        },
        raw_payload={"resultSummary": summarize_result(result)},
    )


def as_actor(actor: dict[str, str]):
    return SimpleNamespace(kind=actor["kind"], id=actor["id"], label=actor["label"], worker_id=None)


def build_orc_system_prompt(launch_input) -> str:
    return "\n".join(
        [
            "You are Orc, the dedicated deepagent orchestration runtime for this Vibe workspace.",
            "Work directly in the repository and keep responses concise.",
            "Validate the requested change before declaring completion.",
            f"Workspace root: {launch_input.workspace_root}",
            f"Project root: {launch_input.project_root}",
            f"Selected model: {launch_input.model_spec}",
        ]
    )


def extract_final_text(result: Any) -> str:
    if isinstance(result, dict):
        messages = result.get("messages")
        if isinstance(messages, list) and messages:
            return extract_content(messages[-1])
    return extract_content(result)


def extract_content(value: Any) -> str:
    content = getattr(value, "content", value)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            text = getattr(item, "text", None)
            if isinstance(text, str):
                parts.append(text)
                continue
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
        text_value = "\n".join(part for part in parts if part).strip()
        if text_value:
            return text_value
    return str(content)


def summarize_result(result: Any) -> dict[str, Any]:
    if isinstance(result, dict):
        return {
            "keys": sorted(str(key) for key in result.keys()),
            "messageCount": len(result.get("messages", [])) if isinstance(result.get("messages"), list) else None,
        }
    return {"type": result.__class__.__name__}


def _install_vendor_paths() -> Path:
    repo_root = Path(__file__).resolve().parents[4]
    for candidate in [
        repo_root / "resources" / "deepagents-main" / "libs" / "deepagents",
        repo_root / "resources" / "langgraph-main" / "libs" / "langgraph",
        repo_root / "resources" / "langgraph-main" / "libs" / "checkpoint",
        repo_root / "resources" / "langgraph-main" / "libs" / "checkpoint-sqlite",
    ]:
        candidate_str = str(candidate)
        if candidate.exists() and candidate_str not in sys.path:
            sys.path.insert(0, candidate_str)
    return repo_root
