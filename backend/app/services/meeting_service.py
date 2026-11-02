import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Tuple

from sqlalchemy.orm import Session
from sqlalchemy import desc, func

from backend.app.core.database import commit_with_retry
from backend.app.core.errors import (
    NotFoundError,
    ValidationError,
    ConflictError,
    ForbiddenError,
)
from backend.app.models.meeting import (
    MeetingModel,
    MeetingParticipantModel,
    MeetingMessageModel,
    MeetingDecisionModel,
    MeetingVoteModel,
    MeetingActionItemModel,
    MeetingTranscriptModel,
)
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.approval import ApprovalModel
from backend.app.schemas.meeting import (
    MeetingCreate,
    MeetingUpdate,
    MeetingParticipantCreate,
    MeetingMessageCreate,
    MeetingDecisionCreate,
    MeetingVoteCreate,
    MeetingActionItemCreate,
)
from backend.app.services.event_service import (
    event_service,
    MEETING_CREATED,
    MEETING_INITIALIZING,
    MEETING_STARTED,
    MEETING_PAUSED,
    MEETING_RESUMED,
    MEETING_CANCELLED,
    MEETING_COMPLETED,
    MEETING_FAILED,
    MEETING_PARTICIPANT_JOINED,
    MEETING_PARTICIPANT_LEFT,
    MEETING_PARTICIPANT_STATUS_CHANGED,
    MEETING_TURN_STARTED,
    MEETING_TURN_COMPLETED,
    MEETING_MESSAGE_CREATED,
    MEETING_DECISION_PROPOSED,
    MEETING_VOTE_SUBMITTED,
    MEETING_DECISION_RESOLVED,
    MEETING_ACTION_ITEM_CREATED,
    MEETING_SUMMARY_GENERATED,
    TASK_CREATED,
)
from backend.app.websocket_manager import ws_manager

logger = logging.getLogger("agency.meeting.service")


class MeetingService:
    @staticmethod
    def create_meeting(
        db: Session,
        meeting_in: MeetingCreate,
        organization_id: str,
        created_by: Optional[str] = None,
    ) -> MeetingModel:
        if not meeting_in.title or not meeting_in.title.strip():
            raise ValidationError(message="Meeting title cannot be empty", code="INVALID_TITLE")

        # 1. Validate Moderator Agent if specified
        if meeting_in.moderator_agent_id:
            mod_agent = (
                db.query(AgentModel)
                .filter(
                    AgentModel.id == meeting_in.moderator_agent_id,
                    AgentModel.organization_id == organization_id,
                )
                .first()
            )
            if not mod_agent:
                raise NotFoundError(
                    message=f"Moderator agent '{meeting_in.moderator_agent_id}' not found in organization",
                    code="MODERATOR_AGENT_NOT_FOUND",
                )

        # 2. Validate Participant Agents
        participant_agent_ids = list(dict.fromkeys(meeting_in.participant_agent_ids or []))
        if participant_agent_ids:
            found_count = (
                db.query(AgentModel)
                .filter(
                    AgentModel.id.in_(participant_agent_ids),
                    AgentModel.organization_id == organization_id,
                )
                .count()
            )
            if found_count != len(participant_agent_ids):
                raise ValidationError(
                    message="One or more participant agents do not exist in organization",
                    code="PARTICIPANT_AGENT_NOT_FOUND",
                )

        # 3. Create Meeting
        now = datetime.utcnow()
        meeting = MeetingModel(
            organization_id=organization_id,
            title=meeting_in.title.strip(),
            description=meeting_in.description.strip() if meeting_in.description else None,
            meeting_type=meeting_in.meeting_type or "GENERAL",
            status="DRAFT",
            objective=meeting_in.objective.strip() if meeting_in.objective else None,
            created_by=created_by,
            moderator_agent_id=meeting_in.moderator_agent_id,
            metadata_json=meeting_in.metadata_json or {},
            created_at=now,
            updated_at=now,
        )
        db.add(meeting)
        db.flush()

        # 4. Attach Moderator & Participants
        order = 0
        if meeting_in.moderator_agent_id:
            mod_part = MeetingParticipantModel(
                meeting_id=meeting.id,
                agent_id=meeting_in.moderator_agent_id,
                role="MODERATOR",
                participation_status="INVITED",
                speaking_order=order,
                contribution_count=0,
            )
            db.add(mod_part)
            order += 1

        for ag_id in participant_agent_ids:
            if ag_id == meeting_in.moderator_agent_id:
                continue
            part = MeetingParticipantModel(
                meeting_id=meeting.id,
                agent_id=ag_id,
                role="SPECIALIST",
                participation_status="INVITED",
                speaking_order=order,
                contribution_count=0,
            )
            db.add(part)
            order += 1

        db.flush()

        # 5. Emit Audit Event & Broadcast
        ev = event_service.create_event(
            db=db,
            event_type=MEETING_CREATED,
            agent_id=meeting.moderator_agent_id,
            organization_id=organization_id,
            payload={
                "meeting_id": meeting.id,
                "title": meeting.title,
                "meeting_type": meeting.meeting_type,
                "moderator_agent_id": meeting.moderator_agent_id,
                "participant_count": order,
            },
            commit=False,
        )

        commit_with_retry(db)
        db.refresh(meeting)

        ws_manager.broadcast_sync(ev.to_envelope())
        logger.info(f"Created meeting '{meeting.id}' ('{meeting.title}') in org '{organization_id}'")
        return meeting

    @staticmethod
    def get_meeting(
        db: Session,
        meeting_id: str,
        organization_id: Optional[str] = None,
    ) -> MeetingModel:
        query = db.query(MeetingModel).filter(MeetingModel.id == meeting_id)
        if organization_id:
            query = query.filter(MeetingModel.organization_id == organization_id)
        meeting = query.first()
        if not meeting:
            raise NotFoundError(
                message=f"Meeting '{meeting_id}' not found",
                code="MEETING_NOT_FOUND",
            )
        return meeting

    @staticmethod
    def list_meetings(
        db: Session,
        organization_id: str,
        status: Optional[str] = None,
        meeting_type: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[MeetingModel]:
        limit = min(max(1, limit), 100)
        offset = max(0, offset)

        query = db.query(MeetingModel).filter(MeetingModel.organization_id == organization_id)
        if status:
            query = query.filter(MeetingModel.status == status)
        if meeting_type:
            query = query.filter(MeetingModel.meeting_type == meeting_type)

        return query.order_by(desc(MeetingModel.created_at)).offset(offset).limit(limit).all()

    @staticmethod
    def update_meeting(
        db: Session,
        meeting_id: str,
        update_in: MeetingUpdate,
        organization_id: str,
    ) -> MeetingModel:
        meeting = MeetingService.get_meeting(db, meeting_id, organization_id=organization_id)
        now = datetime.utcnow()

        if update_in.title is not None:
            if not update_in.title.strip():
                raise ValidationError(message="Meeting title cannot be empty", code="INVALID_TITLE")
            meeting.title = update_in.title.strip()

        if update_in.description is not None:
            meeting.description = update_in.description.strip() if update_in.description else None

        if update_in.objective is not None:
            meeting.objective = update_in.objective.strip() if update_in.objective else None

        if update_in.moderator_agent_id is not None:
            mod_agent = (
                db.query(AgentModel)
                .filter(
                    AgentModel.id == update_in.moderator_agent_id,
                    AgentModel.organization_id == organization_id,
                )
                .first()
            )
            if not mod_agent:
                raise NotFoundError(
                    message=f"Moderator agent '{update_in.moderator_agent_id}' not found in organization",
                    code="MODERATOR_AGENT_NOT_FOUND",
                )
            meeting.moderator_agent_id = update_in.moderator_agent_id

        if update_in.metadata_json is not None:
            existing = dict(meeting.metadata_json or {})
            existing.update(update_in.metadata_json)
            meeting.metadata_json = existing

        meeting.updated_at = now
        commit_with_retry(db)
        db.refresh(meeting)
        return meeting

    @staticmethod
    def start_meeting(
        db: Session,
        meeting_id: str,
        organization_id: str,
    ) -> MeetingModel:
        meeting = MeetingService.get_meeting(db, meeting_id, organization_id=organization_id)

        if meeting.status in ("COMPLETED", "CANCELLED", "FAILED"):
            raise ConflictError(
                message=f"Cannot start meeting in '{meeting.status}' state",
                code="INVALID_MEETING_STATE",
            )

        if len(meeting.participants) == 0:
            raise ValidationError(
                message="Cannot start meeting without any participants",
                code="NO_PARTICIPANTS",
            )

        now = datetime.utcnow()
        meeting.status = "IN_PROGRESS"
        if not meeting.started_at:
            meeting.started_at = now
        meeting.updated_at = now

        # Transition all invited participants to JOINED
        for part in meeting.participants:
            if part.participation_status == "INVITED":
                part.participation_status = "JOINED"
                part.joined_at = now

        ev = event_service.create_event(
            db=db,
            event_type=MEETING_STARTED,
            agent_id=meeting.moderator_agent_id,
            organization_id=organization_id,
            payload={
                "meeting_id": meeting.id,
                "title": meeting.title,
                "started_at": meeting.started_at.isoformat() if meeting.started_at else None,
                "participant_count": len(meeting.participants),
            },
            commit=False,
        )

        commit_with_retry(db)
        db.refresh(meeting)
        ws_manager.broadcast_sync(ev.to_envelope())
        logger.info(f"Meeting '{meeting.id}' started")
        return meeting

    @staticmethod
    def pause_meeting(
        db: Session,
        meeting_id: str,
        organization_id: str,
        reason: Optional[str] = None,
    ) -> MeetingModel:
        meeting = MeetingService.get_meeting(db, meeting_id, organization_id=organization_id)

        if meeting.status != "IN_PROGRESS":
            raise ConflictError(
                message=f"Cannot pause meeting with status '{meeting.status}' (must be IN_PROGRESS)",
                code="INVALID_MEETING_STATE",
            )

        now = datetime.utcnow()
        meeting.status = "PAUSED"
        meeting.updated_at = now
        meta = dict(meeting.metadata_json or {})
        if reason:
            meta["pause_reason"] = reason
        meta["paused_at"] = now.isoformat()
        meeting.metadata_json = meta

        ev = event_service.create_event(
            db=db,
            event_type=MEETING_PAUSED,
            agent_id=meeting.moderator_agent_id,
            organization_id=organization_id,
            payload={
                "meeting_id": meeting.id,
                "reason": reason or "Operator requested pause",
            },
            commit=False,
        )

        commit_with_retry(db)
        db.refresh(meeting)
        ws_manager.broadcast_sync(ev.to_envelope())
        logger.info(f"Meeting '{meeting.id}' paused: {reason}")
        return meeting

    @staticmethod
    def resume_meeting(
        db: Session,
        meeting_id: str,
        organization_id: str,
    ) -> MeetingModel:
        meeting = MeetingService.get_meeting(db, meeting_id, organization_id=organization_id)

        if meeting.status not in ("PAUSED", "WAITING_APPROVAL"):
            raise ConflictError(
                message=f"Cannot resume meeting with status '{meeting.status}' (must be PAUSED or WAITING_APPROVAL)",
                code="INVALID_MEETING_STATE",
            )

        now = datetime.utcnow()
        meeting.status = "IN_PROGRESS"
        meeting.updated_at = now
        meta = dict(meeting.metadata_json or {})
        meta["resumed_at"] = now.isoformat()
        meeting.metadata_json = meta

        ev = event_service.create_event(
            db=db,
            event_type=MEETING_RESUMED,
            agent_id=meeting.moderator_agent_id,
            organization_id=organization_id,
            payload={
                "meeting_id": meeting.id,
                "resumed_at": now.isoformat(),
            },
            commit=False,
        )

        commit_with_retry(db)
        db.refresh(meeting)
        ws_manager.broadcast_sync(ev.to_envelope())
        logger.info(f"Meeting '{meeting.id}' resumed")
        return meeting

    @staticmethod
    def cancel_meeting(
        db: Session,
        meeting_id: str,
        organization_id: str,
        reason: Optional[str] = None,
    ) -> MeetingModel:
        meeting = MeetingService.get_meeting(db, meeting_id, organization_id=organization_id)

        if meeting.status in ("COMPLETED", "CANCELLED"):
            raise ConflictError(
                message=f"Cannot cancel meeting already in terminal status '{meeting.status}'",
                code="MEETING_ALREADY_TERMINAL",
            )

        now = datetime.utcnow()
        meeting.status = "CANCELLED"
        meeting.ended_at = now
        meeting.updated_at = now
        meta = dict(meeting.metadata_json or {})
        if reason:
            meta["cancel_reason"] = reason
        meeting.metadata_json = meta

        for part in meeting.participants:
            if part.participation_status in ("JOINED", "SPEAKING", "LISTENING", "THINKING"):
                part.participation_status = "FINISHED"
                part.left_at = now

        ev = event_service.create_event(
            db=db,
            event_type=MEETING_CANCELLED,
            agent_id=meeting.moderator_agent_id,
            organization_id=organization_id,
            payload={
                "meeting_id": meeting.id,
                "reason": reason or "Meeting cancelled",
                "ended_at": now.isoformat(),
            },
            commit=False,
        )

        commit_with_retry(db)
        db.refresh(meeting)
        ws_manager.broadcast_sync(ev.to_envelope())
        logger.info(f"Meeting '{meeting.id}' cancelled")
        return meeting

    @staticmethod
    def complete_meeting(
        db: Session,
        meeting_id: str,
        organization_id: str,
    ) -> MeetingModel:
        meeting = MeetingService.get_meeting(db, meeting_id, organization_id=organization_id)

        if meeting.status in ("COMPLETED", "CANCELLED"):
            raise ConflictError(
                message=f"Cannot complete meeting already in '{meeting.status}' status",
                code="MEETING_ALREADY_TERMINAL",
            )

        now = datetime.utcnow()
        meeting.status = "COMPLETED"
        meeting.ended_at = now
        meeting.updated_at = now

        for part in meeting.participants:
            if part.participation_status in ("JOINED", "SPEAKING", "LISTENING", "THINKING"):
                part.participation_status = "FINISHED"
                part.left_at = now

        ev = event_service.create_event(
            db=db,
            event_type=MEETING_COMPLETED,
            agent_id=meeting.moderator_agent_id,
            organization_id=organization_id,
            payload={
                "meeting_id": meeting.id,
                "ended_at": now.isoformat(),
                "duration_seconds": (now - meeting.started_at).total_seconds() if meeting.started_at else 0.0,
            },
            commit=False,
        )

        commit_with_retry(db)
        db.refresh(meeting)
        ws_manager.broadcast_sync(ev.to_envelope())
        logger.info(f"Meeting '{meeting.id}' completed")
        return meeting

    # -------------------------------------------------------------------------
    # Participants
    # -------------------------------------------------------------------------

    @staticmethod
    def add_participant(
        db: Session,
        meeting_id: str,
        agent_id: str,
        organization_id: str,
        role: str = "SPECIALIST",
        speaking_order: Optional[int] = None,
        metadata_json: Optional[Dict[str, Any]] = None,
    ) -> MeetingParticipantModel:
        meeting = MeetingService.get_meeting(db, meeting_id, organization_id=organization_id)

        if meeting.status in ("COMPLETED", "CANCELLED"):
            raise ConflictError(
                message="Cannot add participant to a completed or cancelled meeting",
                code="MEETING_ALREADY_TERMINAL",
            )

        # Validate Agent
        agent = (
            db.query(AgentModel)
            .filter(
                AgentModel.id == agent_id,
                AgentModel.organization_id == organization_id,
            )
            .first()
        )
        if not agent:
            raise NotFoundError(
                message=f"Agent '{agent_id}' not found in organization",
                code="AGENT_NOT_FOUND",
            )

        # Check existing
        existing = (
            db.query(MeetingParticipantModel)
            .filter(
                MeetingParticipantModel.meeting_id == meeting.id,
                MeetingParticipantModel.agent_id == agent_id,
            )
            .first()
        )
        if existing:
            if existing.participation_status == "REMOVED":
                existing.participation_status = "JOINED" if meeting.status == "IN_PROGRESS" else "INVITED"
                existing.role = role
                existing.left_at = None
                commit_with_retry(db)
                db.refresh(existing)
                return existing
            raise ConflictError(
                message=f"Agent '{agent_id}' is already a participant in meeting '{meeting_id}'",
                code="PARTICIPANT_ALREADY_EXISTS",
            )

        if speaking_order is None:
            max_order = (
                db.query(func.max(MeetingParticipantModel.speaking_order))
                .filter(MeetingParticipantModel.meeting_id == meeting.id)
                .scalar()
            )
            speaking_order = (max_order + 1) if max_order is not None else 0

        now = datetime.utcnow()
        part = MeetingParticipantModel(
            meeting_id=meeting.id,
            agent_id=agent_id,
            role=role,
            participation_status="JOINED" if meeting.status == "IN_PROGRESS" else "INVITED",
            joined_at=now if meeting.status == "IN_PROGRESS" else None,
            speaking_order=speaking_order,
            contribution_count=0,
            metadata_json=metadata_json or {},
        )
        db.add(part)
        db.flush()

        ev = event_service.create_event(
            db=db,
            event_type=MEETING_PARTICIPANT_JOINED,
            agent_id=agent_id,
            organization_id=organization_id,
            payload={
                "meeting_id": meeting.id,
                "agent_id": agent_id,
                "agent_name": agent.name,
                "role": role,
                "speaking_order": speaking_order,
            },
            commit=False,
        )

        commit_with_retry(db)
        db.refresh(part)
        ws_manager.broadcast_sync(ev.to_envelope())
        return part

    @staticmethod
    def remove_participant(
        db: Session,
        meeting_id: str,
        agent_id: str,
        organization_id: str,
    ) -> bool:
        meeting = MeetingService.get_meeting(db, meeting_id, organization_id=organization_id)

        part = (
            db.query(MeetingParticipantModel)
            .filter(
                MeetingParticipantModel.meeting_id == meeting.id,
                MeetingParticipantModel.agent_id == agent_id,
            )
            .first()
        )
        if not part:
            raise NotFoundError(
                message=f"Participant '{agent_id}' not found in meeting '{meeting_id}'",
                code="PARTICIPANT_NOT_FOUND",
            )

        now = datetime.utcnow()
        part.participation_status = "REMOVED"
        part.left_at = now

        ev = event_service.create_event(
            db=db,
            event_type=MEETING_PARTICIPANT_LEFT,
            agent_id=agent_id,
            organization_id=organization_id,
            payload={
                "meeting_id": meeting.id,
                "agent_id": agent_id,
            },
            commit=False,
        )

        commit_with_retry(db)
        ws_manager.broadcast_sync(ev.to_envelope())
        return True

    @staticmethod
    def list_participants(
        db: Session,
        meeting_id: str,
        organization_id: str,
    ) -> List[MeetingParticipantModel]:
        MeetingService.get_meeting(db, meeting_id, organization_id=organization_id)
        return (
            db.query(MeetingParticipantModel)
            .filter(MeetingParticipantModel.meeting_id == meeting_id)
            .order_by(MeetingParticipantModel.speaking_order.asc())
            .all()
        )

    # -------------------------------------------------------------------------
    # Messages
    # -------------------------------------------------------------------------

    @staticmethod
    def create_message(
        db: Session,
        meeting_id: str,
        organization_id: str,
        content: str,
        agent_id: Optional[str] = None,
        message_type: str = "STATEMENT",
        reply_to_message_id: Optional[str] = None,
        metadata_json: Optional[Dict[str, Any]] = None,
    ) -> MeetingMessageModel:
        meeting = MeetingService.get_meeting(db, meeting_id, organization_id=organization_id)

        if not content or not content.strip():
            raise ValidationError(message="Message content cannot be empty", code="EMPTY_CONTENT")

        # Resolve Participant & validate Agent
        participant_id = None
        if agent_id:
            part = (
                db.query(MeetingParticipantModel)
                .filter(
                    MeetingParticipantModel.meeting_id == meeting.id,
                    MeetingParticipantModel.agent_id == agent_id,
                )
                .first()
            )
            if part:
                participant_id = part.id
                part.contribution_count += 1
                part.participation_status = "LISTENING"

        # Determine next sequence_number atomically
        max_seq = (
            db.query(func.max(MeetingMessageModel.sequence_number))
            .filter(MeetingMessageModel.meeting_id == meeting.id)
            .scalar()
        )
        seq = (max_seq + 1) if max_seq is not None else 1

        now = datetime.utcnow()
        msg = MeetingMessageModel(
            meeting_id=meeting.id,
            participant_id=participant_id,
            agent_id=agent_id,
            message_type=message_type,
            content=content.strip(),
            sequence_number=seq,
            reply_to_message_id=reply_to_message_id,
            metadata_json=metadata_json or {},
            created_at=now,
        )
        db.add(msg)
        meeting.updated_at = now
        db.flush()

        ev = event_service.create_event(
            db=db,
            event_type=MEETING_MESSAGE_CREATED,
            agent_id=agent_id,
            organization_id=organization_id,
            payload={
                "meeting_id": meeting.id,
                "message_id": msg.id,
                "agent_id": agent_id,
                "message_type": message_type,
                "sequence_number": seq,
                "content_preview": content[:120] if len(content) > 120 else content,
            },
            commit=False,
        )

        commit_with_retry(db)
        db.refresh(msg)
        ws_manager.broadcast_sync(ev.to_envelope())
        return msg

    @staticmethod
    def list_messages(
        db: Session,
        meeting_id: str,
        organization_id: str,
        limit: int = 100,
        offset: int = 0,
    ) -> List[MeetingMessageModel]:
        MeetingService.get_meeting(db, meeting_id, organization_id=organization_id)
        limit = min(max(1, limit), 200)
        offset = max(0, offset)

        return (
            db.query(MeetingMessageModel)
            .filter(MeetingMessageModel.meeting_id == meeting_id)
            .order_by(MeetingMessageModel.sequence_number.asc())
            .offset(offset)
            .limit(limit)
            .all()
        )

    # -------------------------------------------------------------------------
    # Decisions & Voting
    # -------------------------------------------------------------------------

    @staticmethod
    def propose_decision(
        db: Session,
        meeting_id: str,
        organization_id: str,
        title: str,
        description: str,
        decision_type: str = "STRATEGIC",
        proposed_by: Optional[str] = None,
        voting_policy: str = "SIMPLE_MAJORITY",
        metadata_json: Optional[Dict[str, Any]] = None,
    ) -> MeetingDecisionModel:
        meeting = MeetingService.get_meeting(db, meeting_id, organization_id=organization_id)

        if not title or not title.strip():
            raise ValidationError(message="Decision title cannot be empty", code="INVALID_TITLE")
        if not description or not description.strip():
            raise ValidationError(message="Decision description cannot be empty", code="INVALID_DESCRIPTION")

        meta = dict(metadata_json or {})
        meta["voting_policy"] = voting_policy

        now = datetime.utcnow()
        decision = MeetingDecisionModel(
            meeting_id=meeting.id,
            title=title.strip(),
            description=description.strip(),
            decision_type=decision_type,
            status="PROPOSED",
            proposed_by=proposed_by,
            created_at=now,
            metadata_json=meta,
        )
        db.add(decision)
        meeting.updated_at = now
        db.flush()

        ev = event_service.create_event(
            db=db,
            event_type=MEETING_DECISION_PROPOSED,
            agent_id=proposed_by,
            organization_id=organization_id,
            payload={
                "meeting_id": meeting.id,
                "decision_id": decision.id,
                "title": decision.title,
                "decision_type": decision.decision_type,
                "voting_policy": voting_policy,
                "proposed_by": proposed_by,
            },
            commit=False,
        )

        commit_with_retry(db)
        db.refresh(decision)
        ws_manager.broadcast_sync(ev.to_envelope())
        return decision

    @staticmethod
    def cast_vote(
        db: Session,
        meeting_id: str,
        decision_id: str,
        agent_id: str,
        vote: str,
        reasoning: Optional[str] = None,
        organization_id: Optional[str] = None,
    ) -> MeetingVoteModel:
        MeetingService.get_meeting(db, meeting_id, organization_id=organization_id)

        decision = (
            db.query(MeetingDecisionModel)
            .filter(
                MeetingDecisionModel.id == decision_id,
                MeetingDecisionModel.meeting_id == meeting_id,
            )
            .first()
        )
        if not decision:
            raise NotFoundError(message=f"Decision '{decision_id}' not found in meeting", code="DECISION_NOT_FOUND")

        if decision.status not in ("PROPOSED", "VOTING"):
            raise ConflictError(
                message=f"Cannot cast vote on decision with status '{decision.status}'",
                code="DECISION_ALREADY_RESOLVED",
            )

        vote_normalized = vote.upper().strip()
        if vote_normalized not in ("YES", "NO", "ABSTAIN"):
            raise ValidationError(message="Vote must be YES, NO, or ABSTAIN", code="INVALID_VOTE")

        # Validate agent is participant
        participant = (
            db.query(MeetingParticipantModel)
            .filter(
                MeetingParticipantModel.meeting_id == meeting_id,
                MeetingParticipantModel.agent_id == agent_id,
            )
            .first()
        )
        if not participant:
            raise ForbiddenError(
                message=f"Agent '{agent_id}' is not an active participant in meeting '{meeting_id}'",
                code="NOT_A_PARTICIPANT",
            )

        now = datetime.utcnow()
        # Upsert vote
        existing_vote = (
            db.query(MeetingVoteModel)
            .filter(
                MeetingVoteModel.decision_id == decision.id,
                MeetingVoteModel.agent_id == agent_id,
            )
            .first()
        )
        if existing_vote:
            existing_vote.vote = vote_normalized
            existing_vote.reasoning = reasoning
            existing_vote.created_at = now
            vote_record = existing_vote
        else:
            vote_record = MeetingVoteModel(
                decision_id=decision.id,
                agent_id=agent_id,
                vote=vote_normalized,
                reasoning=reasoning,
                created_at=now,
            )
            db.add(vote_record)

        decision.status = "VOTING"
        db.flush()

        ev = event_service.create_event(
            db=db,
            event_type=MEETING_VOTE_SUBMITTED,
            agent_id=agent_id,
            organization_id=organization_id,
            payload={
                "meeting_id": meeting_id,
                "decision_id": decision.id,
                "agent_id": agent_id,
                "vote": vote_normalized,
                "reasoning": reasoning,
            },
            commit=False,
        )

        commit_with_retry(db)
        db.refresh(vote_record)
        ws_manager.broadcast_sync(ev.to_envelope())
        return vote_record

    @staticmethod
    def resolve_decision(
        db: Session,
        meeting_id: str,
        decision_id: str,
        organization_id: str,
        resolution_override: Optional[str] = None,
        approved_by: Optional[str] = None,
    ) -> MeetingDecisionModel:
        meeting = MeetingService.get_meeting(db, meeting_id, organization_id=organization_id)

        decision = (
            db.query(MeetingDecisionModel)
            .filter(
                MeetingDecisionModel.id == decision_id,
                MeetingDecisionModel.meeting_id == meeting_id,
            )
            .first()
        )
        if not decision:
            raise NotFoundError(message=f"Decision '{decision_id}' not found", code="DECISION_NOT_FOUND")

        now = datetime.utcnow()
        meta = dict(decision.metadata_json or {})
        voting_policy = meta.get("voting_policy", "SIMPLE_MAJORITY")

        votes = db.query(MeetingVoteModel).filter(MeetingVoteModel.decision_id == decision.id).all()
        yes_votes = [v for v in votes if v.vote == "YES"]
        no_votes = [v for v in votes if v.vote == "NO"]
        abstain_votes = [v for v in votes if v.vote == "ABSTAIN"]

        if resolution_override:
            final_status = resolution_override
        else:
            if voting_policy == "UNANIMOUS":
                final_status = "APPROVED" if (len(yes_votes) > 0 and len(no_votes) == 0) else "REJECTED"
            elif voting_policy == "CONSENSUS":
                total_active = len(yes_votes) + len(no_votes)
                if total_active == 0:
                    final_status = "REJECTED"
                else:
                    ratio = len(yes_votes) / total_active
                    final_status = "APPROVED" if ratio >= 0.75 else "REJECTED"
            elif voting_policy == "MODERATOR_DECISION":
                mod_vote = next((v for v in votes if v.agent_id == meeting.moderator_agent_id), None)
                if mod_vote:
                    final_status = "APPROVED" if mod_vote.vote == "YES" else "REJECTED"
                else:
                    final_status = "APPROVED" if len(yes_votes) > len(no_votes) else "REJECTED"
            else:  # SIMPLE_MAJORITY
                final_status = "APPROVED" if len(yes_votes) > len(no_votes) else "REJECTED"

        # Check if human approval is required by policy or metadata
        if meta.get("requires_human_approval", False) and final_status == "APPROVED":
            final_status = "REQUIRES_HUMAN_APPROVAL"
            meeting.status = "WAITING_APPROVAL"

        decision.status = final_status
        decision.resolved_at = now
        decision.approved_by = approved_by
        meta["tally"] = {
            "yes": len(yes_votes),
            "no": len(no_votes),
            "abstain": len(abstain_votes),
            "total_votes": len(votes),
        }
        decision.metadata_json = meta
        db.flush()

        ev = event_service.create_event(
            db=db,
            event_type=MEETING_DECISION_RESOLVED,
            agent_id=decision.proposed_by,
            organization_id=organization_id,
            payload={
                "meeting_id": meeting.id,
                "decision_id": decision.id,
                "status": final_status,
                "voting_policy": voting_policy,
                "yes_votes": len(yes_votes),
                "no_votes": len(no_votes),
                "abstain_votes": len(abstain_votes),
            },
            commit=False,
        )

        commit_with_retry(db)
        db.refresh(decision)
        ws_manager.broadcast_sync(ev.to_envelope())
        return decision

    # -------------------------------------------------------------------------
    # Action Items
    # -------------------------------------------------------------------------

    @staticmethod
    def create_action_item(
        db: Session,
        meeting_id: str,
        organization_id: str,
        item_in: MeetingActionItemCreate,
        assigned_by: Optional[str] = None,
    ) -> MeetingActionItemModel:
        meeting = MeetingService.get_meeting(db, meeting_id, organization_id=organization_id)

        # Validate Assigned Agent
        agent = (
            db.query(AgentModel)
            .filter(
                AgentModel.id == item_in.assigned_agent_id,
                AgentModel.organization_id == organization_id,
            )
            .first()
        )
        if not agent:
            raise NotFoundError(
                message=f"Agent '{item_in.assigned_agent_id}' not found in organization",
                code="AGENT_NOT_FOUND",
            )

        linked_task_id = None
        now = datetime.utcnow()

        if item_in.create_linked_task:
            task = TaskModel(
                title=f"[Meeting: {meeting.title}] {item_in.title.strip()}",
                description=f"{item_in.description.strip()}\n\nOriginated from Meeting '{meeting.title}' ({meeting.id}).",
                organization_id=organization_id,
                assigned_agent_id=item_in.assigned_agent_id,
                task_type="agent_task",
                priority=item_in.priority or "normal",
                status="queued",
                created_at=now,
                updated_at=now,
            )
            db.add(task)
            db.flush()
            linked_task_id = task.id

            event_service.create_event(
                db=db,
                event_type=TASK_CREATED,
                agent_id=item_in.assigned_agent_id,
                task_id=task.id,
                organization_id=organization_id,
                payload={
                    "task_id": task.id,
                    "title": task.title,
                    "assigned_agent_id": task.assigned_agent_id,
                    "meeting_id": meeting.id,
                },
                commit=False,
            )

        action_item = MeetingActionItemModel(
            meeting_id=meeting.id,
            decision_id=item_in.decision_id,
            title=item_in.title.strip(),
            description=item_in.description.strip(),
            assigned_agent_id=item_in.assigned_agent_id,
            assigned_by=assigned_by,
            linked_task_id=linked_task_id,
            priority=item_in.priority or "normal",
            status="PENDING",
            due_at=item_in.due_at,
            created_at=now,
        )
        db.add(action_item)
        meeting.updated_at = now
        db.flush()

        ev = event_service.create_event(
            db=db,
            event_type=MEETING_ACTION_ITEM_CREATED,
            agent_id=item_in.assigned_agent_id,
            organization_id=organization_id,
            payload={
                "meeting_id": meeting.id,
                "action_item_id": action_item.id,
                "title": action_item.title,
                "assigned_agent_id": action_item.assigned_agent_id,
                "linked_task_id": linked_task_id,
                "priority": action_item.priority,
            },
            commit=False,
        )

        commit_with_retry(db)
        db.refresh(action_item)
        ws_manager.broadcast_sync(ev.to_envelope())
        return action_item

    # -------------------------------------------------------------------------
    # Transcripts & Summaries
    # -------------------------------------------------------------------------

    @staticmethod
    def generate_transcript(
        db: Session,
        meeting_id: str,
        organization_id: str,
        custom_summary: Optional[str] = None,
    ) -> MeetingTranscriptModel:
        meeting = MeetingService.get_meeting(db, meeting_id, organization_id=organization_id)

        messages = (
            db.query(MeetingMessageModel)
            .filter(MeetingMessageModel.meeting_id == meeting.id)
            .order_by(MeetingMessageModel.sequence_number.asc())
            .all()
        )
        decisions = (
            db.query(MeetingDecisionModel)
            .filter(MeetingDecisionModel.meeting_id == meeting.id)
            .order_by(MeetingDecisionModel.created_at.asc())
            .all()
        )
        action_items = (
            db.query(MeetingActionItemModel)
            .filter(MeetingActionItemModel.meeting_id == meeting.id)
            .order_by(MeetingActionItemModel.created_at.asc())
            .all()
        )

        # Assemble markdown transcript
        lines: List[str] = []
        lines.append(f"# Meeting Transcript: {meeting.title}")
        lines.append(f"**Meeting ID:** `{meeting.id}`  ")
        lines.append(f"**Type:** {meeting.meeting_type} | **Status:** {meeting.status}  ")
        if meeting.objective:
            lines.append(f"**Objective:** {meeting.objective}  ")
        lines.append(f"**Started At:** {meeting.started_at.isoformat() if meeting.started_at else 'N/A'}  ")
        lines.append(f"**Ended At:** {meeting.ended_at.isoformat() if meeting.ended_at else 'N/A'}  ")
        lines.append("")

        lines.append("## Participants")
        for part in meeting.participants:
            ag_name = part.agent.name if part.agent else part.agent_id
            lines.append(f"- **{ag_name}** ({part.role}) — Contributions: {part.contribution_count}, Status: {part.participation_status}")
        lines.append("")

        lines.append("## Discussion Log")
        if not messages:
            lines.append("_No dialogue recorded._")
        for msg in messages:
            ag_name = msg.agent.name if msg.agent else "System"
            lines.append(f"**[{msg.sequence_number}] {ag_name} ({msg.message_type})**:")
            lines.append(f"> {msg.content}")
            lines.append("")

        lines.append("## Decisions")
        if not decisions:
            lines.append("_No formal decisions recorded._")
        for dec in decisions:
            lines.append(f"- **{dec.title}** ({dec.status}) [{dec.decision_type}]: {dec.description}")
        lines.append("")

        lines.append("## Action Items")
        if not action_items:
            lines.append("_No action items assigned._")
        for item in action_items:
            assigned = item.assigned_agent.name if item.assigned_agent else item.assigned_agent_id
            task_ref = f"(Linked Task: `{item.linked_task_id}`)" if item.linked_task_id else ""
            lines.append(f"- [ ] **{item.title}** -> Assigned to: **{assigned}** [Priority: {item.priority}] {task_ref}")
        lines.append("")

        transcript_content = "\n".join(lines)

        # Summary generation
        summary_text = custom_summary
        if not summary_text:
            approved_decisions = [d.title for d in decisions if d.status == "APPROVED"]
            summary_text = (
                f"Executive Summary for '{meeting.title}': The meeting covered {len(messages)} statements across "
                f"{len(meeting.participants)} participants. {len(decisions)} decisions were proposed "
                f"({len(approved_decisions)} approved). {len(action_items)} action items were established."
            )

        # Transcript versioning
        max_ver = (
            db.query(func.max(MeetingTranscriptModel.transcript_version))
            .filter(MeetingTranscriptModel.meeting_id == meeting.id)
            .scalar()
        )
        next_ver = (max_ver + 1) if max_ver is not None else 1

        now = datetime.utcnow()
        transcript = MeetingTranscriptModel(
            meeting_id=meeting.id,
            transcript_version=next_ver,
            content=transcript_content,
            summary=summary_text,
            created_at=now,
        )
        db.add(transcript)
        meeting.updated_at = now
        db.flush()

        ev = event_service.create_event(
            db=db,
            event_type=MEETING_SUMMARY_GENERATED,
            agent_id=meeting.moderator_agent_id,
            organization_id=organization_id,
            payload={
                "meeting_id": meeting.id,
                "transcript_id": transcript.id,
                "transcript_version": next_ver,
            },
            commit=False,
        )

        commit_with_retry(db)
        db.refresh(transcript)
        ws_manager.broadcast_sync(ev.to_envelope())
        return transcript

    @staticmethod
    def get_summary(
        db: Session,
        meeting_id: str,
        organization_id: str,
    ) -> Dict[str, Any]:
        meeting = MeetingService.get_meeting(db, meeting_id, organization_id=organization_id)

        latest_transcript = (
            db.query(MeetingTranscriptModel)
            .filter(MeetingTranscriptModel.meeting_id == meeting.id)
            .order_by(MeetingTranscriptModel.transcript_version.desc())
            .first()
        )

        decisions = (
            db.query(MeetingDecisionModel)
            .filter(MeetingDecisionModel.meeting_id == meeting.id)
            .all()
        )
        action_items = (
            db.query(MeetingActionItemModel)
            .filter(MeetingActionItemModel.meeting_id == meeting.id)
            .all()
        )

        duration = None
        if meeting.started_at:
            end_point = meeting.ended_at or datetime.utcnow()
            duration = (end_point - meeting.started_at).total_seconds()

        return {
            "meeting_id": meeting.id,
            "title": meeting.title,
            "status": meeting.status,
            "objective": meeting.objective,
            "started_at": meeting.started_at,
            "ended_at": meeting.ended_at,
            "duration_seconds": duration,
            "participants_count": len(meeting.participants),
            "messages_count": len(meeting.messages),
            "decisions": [d.to_dict() for d in decisions],
            "action_items": [a.to_dict() for a in action_items],
            "summary_text": latest_transcript.summary if latest_transcript else None,
        }


meeting_service = MeetingService()
