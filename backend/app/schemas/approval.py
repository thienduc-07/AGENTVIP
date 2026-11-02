from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, Field, ConfigDict

ApprovalStatusType = Literal["pending", "approved", "rejected", "expired", "cancelled"]

class ApprovalResponse(BaseModel):
    id: str
    task_id: str
    action_type: str
    description: str
    status: ApprovalStatusType
    requested_at: datetime
    resolved_at: Optional[datetime] = None
    resolved_by_user_id: Optional[str] = None
    decision_reason: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class ApprovalDecisionRequest(BaseModel):
    decision: Literal["approved", "rejected", "expired", "cancelled"] = Field(
        ...,
        description="Decision must be 'approved', 'rejected', 'expired', or 'cancelled'"
    )
    reason: Optional[str] = Field(None, max_length=500, description="Optional justification for the decision")
