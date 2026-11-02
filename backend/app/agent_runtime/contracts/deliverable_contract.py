import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class StructuredDeliverable(BaseModel):
    """
    Authoritative, tamper-evident contract representing verified task outputs
    and physical evidence produced by autonomous workforce specialists.
    """
    deliverable_id: str = Field(
        default_factory=lambda: f"deliv_{uuid.uuid4().hex[:12]}",
        description="Unique deliverable identifier",
    )
    task_id: str = Field(..., description="Target task or subtask database ID")
    parent_task_id: Optional[str] = Field(default=None, description="Parent workflow ID if applicable")
    agent_id: str = Field(..., description="Specialist agent ID that performed execution")
    organization_id: str = Field(default="org_default_company", description="Tenant organization ID")
    execution_id: str = Field(..., description="Execution loop or cycle identifier")
    objective: str = Field(..., description="Task title or goal statement")
    actions_performed: List[str] = Field(default_factory=list, description="Key operational actions performed")
    tools_invoked: List[Dict[str, Any]] = Field(default_factory=list, description="Audit log of tool invocations")
    evidence_references: List[str] = Field(default_factory=list, description="Citations, file paths, or verified references")
    result_summary: str = Field(..., description="Verified output summary")
    artifact_paths: List[str] = Field(default_factory=list, description="Physical sandbox artifact file paths")
    artifact_hashes: Dict[str, str] = Field(default_factory=dict, description="Cryptographic SHA-256 hashes of physical artifacts")
    verification_status: str = Field(
        default="VERIFIED",
        description="Verification outcome: VERIFIED | PARTIALLY_VERIFIED | FAILED | PENDING_REVIEW",
    )
    verification_notes: Optional[str] = Field(default=None, description="Detailed notes from ResultVerifier")
    completion_timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="ISO 8601 UTC completion timestamp",
    )

    def to_dict(self) -> Dict[str, Any]:
        return self.model_dump()

