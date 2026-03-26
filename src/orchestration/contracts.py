from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class ReconCoordinate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    absolute_file_path: str
    line_start: int = Field(ge=1)
    line_end: int = Field(ge=1)
    semantic_change_target: str

    @model_validator(mode="after")
    def validate_coordinate(self) -> "ReconCoordinate":
        if not self.absolute_file_path.startswith("/"):
            raise ValueError("absolute_file_path must be an absolute path.")
        if self.line_end < self.line_start:
            raise ValueError("line_end must be greater than or equal to line_start.")
        return self


class ReconReport(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    summary: str
    findings: list[str] = Field(min_length=1)
    recommendations: list[str] = Field(min_length=1)
    coordinates: list[ReconCoordinate] = Field(min_length=1)
    evidence_links: list[str] = Field(default_factory=list)
    envelope: ContractEnvelope | None = None

    @model_validator(mode="after")
    def validate_deterministic_coordinates(self) -> "ReconReport":
        ordered = sorted(
            self.coordinates,
            key=lambda c: (c.absolute_file_path, c.line_start, c.line_end, c.semantic_change_target),
        )
        for idx, coord in enumerate(self.coordinates):
            if coord != ordered[idx]:
                raise ValueError(
                    "coordinates must be strictly sorted by absolute_file_path, line_start, line_end, semantic_change_target.",
                )
        return self


class FailureDossier(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    failure_code: str
    failure_summary: str
    actions_taken: list[str] = Field(min_length=1)
    next_actions: list[str] = Field(default_factory=list)
    envelope: ContractEnvelope | None = None
