from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ContractProvenance(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    agent_name: str | None = None
    timestamp: datetime | None = None
    correlation_id: str | None = None


class ContractEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    status: Literal["pass", "fail", "pending"] | None = None
    passed: bool | None = None
    metadata: dict[str, Any] | None = None
    provenance: ContractProvenance | None = None


class StructuralBlueprint(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    objective: str
    scope: list[str] = Field(min_length=1)
    constraints: list[str] = Field(min_length=1)
    deliverables: list[str] = Field(min_length=1)
    risk_register: list[str] = Field(default_factory=list)
    envelope: ContractEnvelope | None = None


class ReconReport(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    summary: str
    findings: list[str] = Field(min_length=1)
    recommendations: list[str] = Field(min_length=1)
    evidence_links: list[str] = Field(default_factory=list)
    envelope: ContractEnvelope | None = None


class FailureDossier(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    failure_code: str
    failure_summary: str
    actions_taken: list[str] = Field(min_length=1)
    next_actions: list[str] = Field(default_factory=list)
    envelope: ContractEnvelope | None = None
