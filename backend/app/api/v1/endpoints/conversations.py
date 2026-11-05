import json
from typing import List, Optional, Literal, Dict, Any
from fastapi import APIRouter, Depends, Query, status, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.auth import (
    get_current_user,
    get_current_tenant_org,
    UserContext,
)
from backend.app.services.conversation_service import conversation_service
from backend.app.models.conversation import ConversationModel, ConversationMessageModel

router = APIRouter(prefix="/conversations", tags=["Conversations"])

class ChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=10000, description="Nội dung người dùng gửi")
    conversation_id: Optional[str] = Field(None, description="ID phiên trò chuyện hiện tại (nếu có)")
    agent_id: Optional[str] = Field(None, description="ID của Agent được chỉ định hoặc 'auto' để tự động định tuyến")
    mode: Literal["conversation", "task"] = Field("conversation", description="Chế độ xử lý: conversation (hỏi đáp AI) hoặc task (nhiệm vụ)")

class ChatRoutingInfo(BaseModel):
    agent_id: str
    agent_name: str
    role: str
    division: str
    mode: str
    confidence: float
    reason: str
    provider: Optional[str] = None
    model: Optional[str] = None
    is_live_provider: Optional[bool] = None

class ChatResponse(BaseModel):
    conversation_id: str
    message_id: str
    mode: str
    task_id: Optional[str] = None
    task_status: Optional[str] = None
    agent_id: str
    agent_name: str
    role: str
    content: str
    thought: Optional[str] = None
    routing: Dict[str, Any]
    created_at: str

class MessageItemResponse(BaseModel):
    id: str
    conversation_id: str
    sender_type: str
    sender_id: Optional[str] = None
    sender_name: Optional[str] = None
    role: str
    content: str
    thought: Optional[str] = None
    task_id: Optional[str] = None
    routing_metadata: Optional[Dict[str, Any]] = None
    created_at: str

class ConversationSummaryResponse(BaseModel):
    id: str
    title: str
    mode: str
    agent_id: Optional[str] = None
    created_at: str
    updated_at: str
    message_count: int

@router.post("/chat", response_model=ChatResponse, status_code=status.HTTP_200_OK)
async def chat_with_agent(
    payload: ChatRequest,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Điểm cuối trò chuyện AI và điều phối nhiệm vụ của Agent City.
    - Phân tách rõ ràng giữa chế độ CONVERSATION (hỏi đáp AI trực tiếp, nhớ ngữ cảnh) và TASK (khởi tạo nhiệm vụ nền).
    - Tự động định tuyến chuyên gia (Intelligent Agent Routing) dựa trên năng lực của 18 phân ban và 268 chuyên gia.
    """
    try:
        result = await conversation_service.process_chat(
            db=db,
            prompt=payload.prompt,
            conversation_id=payload.conversation_id,
            requested_agent_id=payload.agent_id,
            mode=payload.mode,
            user_id=user.user_id if user else "demo_user",
            organization_id=tenant_org or "org_default_company",
        )
        return result
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Lỗi xử lý phiên trò chuyện: {str(exc)}"
        )

@router.get("", response_model=List[ConversationSummaryResponse])
def list_conversations(
    limit: int = Query(20, ge=1, le=100),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lấy danh sách các phiên trò chuyện của tổ chức hiện tại."""
    convs = (
        db.query(ConversationModel)
        .filter(ConversationModel.organization_id == (tenant_org or "org_default_company"))
        .order_by(ConversationModel.updated_at.desc())
        .limit(limit)
        .all()
    )
    result = []
    for c in convs:
        msg_count = db.query(ConversationMessageModel).filter(ConversationMessageModel.conversation_id == c.id).count()
        result.append(
            ConversationSummaryResponse(
                id=c.id,
                title=c.title,
                mode=c.mode,
                agent_id=c.agent_id,
                created_at=c.created_at.isoformat(),
                updated_at=c.updated_at.isoformat(),
                message_count=msg_count,
            )
        )
    return result

@router.get("/{conversation_id}/messages", response_model=List[MessageItemResponse])
def get_conversation_messages(
    conversation_id: str,
    limit: int = Query(50, ge=1, le=200),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lấy lịch sử tin nhắn của một phiên trò chuyện cụ thể."""
    conv = (
        db.query(ConversationModel)
        .filter(
            ConversationModel.id == conversation_id,
            ConversationModel.organization_id == (tenant_org or "org_default_company"),
        )
        .first()
    )
    if not conv:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Không tìm thấy phiên trò chuyện")

    messages = (
        db.query(ConversationMessageModel)
        .filter(ConversationMessageModel.conversation_id == conversation_id)
        .order_by(ConversationMessageModel.created_at.asc())
        .limit(limit)
        .all()
    )

    out = []
    for m in messages:
        routing_meta = None
        if m.routing_metadata:
            try:
                routing_meta = json.loads(m.routing_metadata)
            except Exception:
                pass
        out.append(
            MessageItemResponse(
                id=m.id,
                conversation_id=m.conversation_id,
                sender_type=m.sender_type,
                sender_id=m.sender_id,
                sender_name=m.sender_name,
                role=m.role,
                content=m.content,
                thought=m.thought,
                task_id=m.task_id,
                routing_metadata=routing_meta,
                created_at=m.created_at.isoformat(),
            )
        )
    return out

