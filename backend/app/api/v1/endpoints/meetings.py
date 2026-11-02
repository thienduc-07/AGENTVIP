from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, Query, Body, status, Response
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.auth import (
    get_current_user,
    get_current_tenant_org,
    UserContext,
)
from backend.app.schemas.meeting import (
    MeetingCreate,
    MeetingUpdate,
    MeetingResponse,
    MeetingSummaryResponse,
    MeetingParticipantCreate,
    MeetingParticipantResponse,
    MeetingMessageCreate,
    MeetingMessageResponse,
    MeetingDecisionCreate,
    MeetingDecisionResponse,
    MeetingVoteCreate,
    MeetingVoteResponse,
    MeetingActionItemCreate,
    MeetingActionItemResponse,
    MeetingTranscriptResponse,
)
from backend.app.services.meeting_service import meeting_service
from backend.app.agent_runtime.meeting.orchestrator import meeting_orchestrator

router = APIRouter(prefix="/meetings", tags=["Meetings"])


@router.post("", response_model=MeetingResponse, status_code=status.HTTP_201_CREATED)
def create_meeting(
    meeting_in: MeetingCreate,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Creates a new persistent multi-agent meeting session strictly scoped to tenant organization."""
    return meeting_service.create_meeting(
        db=db,
        meeting_in=meeting_in,
        organization_id=tenant_org,
        created_by=user.user_id,
    )


@router.get("", response_model=List[MeetingResponse])
def list_meetings(
    status: Optional[str] = Query(None, description="Filter by status (DRAFT, IN_PROGRESS, etc.)"),
    meeting_type: Optional[str] = Query(None, description="Filter by meeting type"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lists meetings scoped to tenant organization."""
    return meeting_service.list_meetings(
        db=db,
        organization_id=tenant_org,
        status=status,
        meeting_type=meeting_type,
        limit=limit,
        offset=offset,
    )


@router.get("/{meeting_id}", response_model=MeetingResponse)
def get_meeting(
    meeting_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Fetches meeting details by ID with strict tenant isolation."""
    return meeting_service.get_meeting(
        db=db,
        meeting_id=meeting_id,
        organization_id=tenant_org,
    )


@router.patch("/{meeting_id}", response_model=MeetingResponse)
def update_meeting(
    meeting_id: str,
    meeting_in: MeetingUpdate,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Updates meeting configuration or metadata."""
    return meeting_service.update_meeting(
        db=db,
        meeting_id=meeting_id,
        update_in=meeting_in,
        organization_id=tenant_org,
    )


@router.post("/{meeting_id}/start", response_model=MeetingResponse)
def start_meeting(
    meeting_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Starts the meeting session, setting participant statuses to JOINED."""
    return meeting_service.start_meeting(
        db=db,
        meeting_id=meeting_id,
        organization_id=tenant_org,
    )


@router.post("/{meeting_id}/pause", response_model=MeetingResponse)
def pause_meeting(
    meeting_id: str,
    payload: Optional[Dict[str, Any]] = Body(default=None),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Pauses an active meeting session."""
    reason = (payload or {}).get("reason")
    return meeting_service.pause_meeting(
        db=db,
        meeting_id=meeting_id,
        organization_id=tenant_org,
        reason=reason,
    )


@router.post("/{meeting_id}/resume", response_model=MeetingResponse)
def resume_meeting(
    meeting_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resumes a paused or waiting meeting session."""
    return meeting_service.resume_meeting(
        db=db,
        meeting_id=meeting_id,
        organization_id=tenant_org,
    )


@router.post("/{meeting_id}/cancel", response_model=MeetingResponse)
def cancel_meeting(
    meeting_id: str,
    payload: Optional[Dict[str, Any]] = Body(default=None),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cancels a meeting session."""
    reason = (payload or {}).get("reason")
    return meeting_service.cancel_meeting(
        db=db,
        meeting_id=meeting_id,
        organization_id=tenant_org,
        reason=reason,
    )


@router.post("/{meeting_id}/complete", response_model=MeetingResponse)
def complete_meeting(
    meeting_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Completes a meeting session."""
    return meeting_service.complete_meeting(
        db=db,
        meeting_id=meeting_id,
        organization_id=tenant_org,
    )


# -----------------------------------------------------------------------------
# Participants
# -----------------------------------------------------------------------------

@router.post("/{meeting_id}/participants", response_model=MeetingParticipantResponse, status_code=status.HTTP_201_CREATED)
def add_participant(
    meeting_id: str,
    part_in: MeetingParticipantCreate,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Adds a real agent participant to the meeting."""
    return meeting_service.add_participant(
        db=db,
        meeting_id=meeting_id,
        agent_id=part_in.agent_id,
        organization_id=tenant_org,
        role=part_in.role,
        speaking_order=part_in.speaking_order,
        metadata_json=part_in.metadata_json,
    )


@router.delete("/{meeting_id}/participants/{agent_id}", status_code=status.HTTP_200_OK)
def remove_participant(
    meeting_id: str,
    agent_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Removes a participant agent from the meeting."""
    meeting_service.remove_participant(
        db=db,
        meeting_id=meeting_id,
        agent_id=agent_id,
        organization_id=tenant_org,
    )
    return {"status": "removed", "agent_id": agent_id, "meeting_id": meeting_id}


@router.get("/{meeting_id}/participants", response_model=List[MeetingParticipantResponse])
def list_participants(
    meeting_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lists participants of a meeting in speaking order."""
    return meeting_service.list_participants(
        db=db,
        meeting_id=meeting_id,
        organization_id=tenant_org,
    )


# -----------------------------------------------------------------------------
# Messages
# -----------------------------------------------------------------------------

@router.post("/{meeting_id}/messages", response_model=MeetingMessageResponse, status_code=status.HTTP_201_CREATED)
def create_message(
    meeting_id: str,
    msg_in: MeetingMessageCreate,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Appends a new statement or contribution to the meeting dialogue."""
    return meeting_service.create_message(
        db=db,
        meeting_id=meeting_id,
        organization_id=tenant_org,
        content=msg_in.content,
        agent_id=msg_in.agent_id,
        message_type=msg_in.message_type,
        reply_to_message_id=msg_in.reply_to_message_id,
        metadata_json=msg_in.metadata_json,
    )


@router.get("/{meeting_id}/messages", response_model=List[MeetingMessageResponse])
def list_messages(
    meeting_id: str,
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lists sequential messages recorded in the meeting."""
    return meeting_service.list_messages(
        db=db,
        meeting_id=meeting_id,
        organization_id=tenant_org,
        limit=limit,
        offset=offset,
    )


# -----------------------------------------------------------------------------
# Decisions & Voting
# -----------------------------------------------------------------------------

@router.post("/{meeting_id}/decisions", response_model=MeetingDecisionResponse, status_code=status.HTTP_201_CREATED)
def propose_decision(
    meeting_id: str,
    dec_in: MeetingDecisionCreate,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Proposes a new formal decision for deliberation and voting."""
    return meeting_service.propose_decision(
        db=db,
        meeting_id=meeting_id,
        organization_id=tenant_org,
        title=dec_in.title,
        description=dec_in.description,
        decision_type=dec_in.decision_type,
        proposed_by=dec_in.proposed_by,
        voting_policy=dec_in.voting_policy or "SIMPLE_MAJORITY",
        metadata_json=dec_in.metadata_json,
    )


@router.post("/{meeting_id}/decisions/{decision_id}/vote", response_model=MeetingVoteResponse)
def cast_vote(
    meeting_id: str,
    decision_id: str,
    vote_in: MeetingVoteCreate,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Casts an authoritative participant vote on a proposed decision."""
    return meeting_service.cast_vote(
        db=db,
        meeting_id=meeting_id,
        decision_id=decision_id,
        agent_id=vote_in.agent_id,
        vote=vote_in.vote,
        reasoning=vote_in.reasoning,
        organization_id=tenant_org,
    )


@router.post("/{meeting_id}/decisions/{decision_id}/resolve", response_model=MeetingDecisionResponse)
def resolve_decision(
    meeting_id: str,
    decision_id: str,
    payload: Optional[Dict[str, Any]] = Body(default=None),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resolves a decision tally based on voting policy and rules."""
    override = (payload or {}).get("resolution_override")
    return meeting_service.resolve_decision(
        db=db,
        meeting_id=meeting_id,
        decision_id=decision_id,
        organization_id=tenant_org,
        resolution_override=override,
        approved_by=user.user_id,
    )


# -----------------------------------------------------------------------------
# Action Items
# -----------------------------------------------------------------------------

@router.post("/{meeting_id}/action-items", response_model=MeetingActionItemResponse, status_code=status.HTTP_201_CREATED)
def create_action_item(
    meeting_id: str,
    item_in: MeetingActionItemCreate,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Creates an actionable outcome linked to real TaskModel execution."""
    return meeting_service.create_action_item(
        db=db,
        meeting_id=meeting_id,
        organization_id=tenant_org,
        item_in=item_in,
        assigned_by=user.user_id,
    )


@router.get("/{meeting_id}/action-items", response_model=List[MeetingActionItemResponse])
def list_action_items(
    meeting_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lists action items generated during the meeting."""
    meeting = meeting_service.get_meeting(db, meeting_id, organization_id=tenant_org)
    return meeting.action_items


# -----------------------------------------------------------------------------
# Transcripts & Summary
# -----------------------------------------------------------------------------

@router.post("/{meeting_id}/transcripts/generate", response_model=MeetingTranscriptResponse)
def generate_transcript(
    meeting_id: str,
    payload: Optional[Dict[str, Any]] = Body(default=None),
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Compiles complete meeting transcript and executive summary."""
    custom_summary = (payload or {}).get("summary")
    return meeting_service.generate_transcript(
        db=db,
        meeting_id=meeting_id,
        organization_id=tenant_org,
        custom_summary=custom_summary,
    )


@router.get("/{meeting_id}/transcripts", response_model=List[MeetingTranscriptResponse])
def list_transcripts(
    meeting_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Fetches compiled transcript versions for the meeting."""
    meeting = meeting_service.get_meeting(db, meeting_id, organization_id=tenant_org)
    return meeting.transcripts


@router.get("/{meeting_id}/summary", response_model=MeetingSummaryResponse)
def get_meeting_summary(
    meeting_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Fetches comprehensive summary of the meeting."""
    return meeting_service.get_summary(
        db=db,
        meeting_id=meeting_id,
        organization_id=tenant_org,
    )


# -----------------------------------------------------------------------------
# Runtime Speaking Turn Coordination
# -----------------------------------------------------------------------------

@router.post("/{meeting_id}/execute-turn", response_model=Dict[str, Any])
async def execute_turn(
    meeting_id: str,
    tenant_org: str = Depends(get_current_tenant_org),
    user: UserContext = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Executes next authoritative speaking turn in the meeting via MeetingOrchestrator."""
    return await meeting_orchestrator.execute_turn(
        meeting_id=meeting_id,
        db=db,
        organization_id=tenant_org,
    )
