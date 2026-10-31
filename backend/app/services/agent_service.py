from datetime import datetime
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import desc
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.schemas.agent import AgentCreate, AgentUpdate
from backend.app.core.errors import NotFoundError, ConflictError, ValidationError
from backend.app.services.event_service import event_service

from backend.app.models.recruitment import RecruitmentRecordModel

class AgentService:
    @staticmethod
    def list_agents(db: Session, organization_id: Optional[str] = None, limit: int = 50, offset: int = 0) -> List[AgentModel]:
        limit = min(max(1, limit), 100)
        offset = max(0, offset)
        if organization_id:
            recruited_ids = [
                r[0] for r in db.query(RecruitmentRecordModel.agent_id)
                .filter(RecruitmentRecordModel.organization_id == organization_id)
                .all()
            ]
            all_recruited = [
                r[0] for r in db.query(RecruitmentRecordModel.agent_id).all()
            ]
            return (
                db.query(AgentModel)
                .filter(
                    (AgentModel.organization_id == organization_id) |
                    (AgentModel.id.in_(recruited_ids)) |
                    ((AgentModel.organization_id.is_(None)) & (~AgentModel.id.in_(all_recruited)))
                )
                .order_by(AgentModel.created_at.asc())
                .offset(offset)
                .limit(limit)
                .all()
            )
        return db.query(AgentModel).order_by(AgentModel.created_at.asc()).offset(offset).limit(limit).all()

    @staticmethod
    def get_agent_by_id(db: Session, agent_id: str, organization_id: Optional[str] = None) -> AgentModel:
        agent = db.query(AgentModel).filter(AgentModel.id == agent_id).first()
        if not agent:
            raise NotFoundError(message=f"Agent '{agent_id}' not found", code="AGENT_NOT_FOUND")
        if organization_id:
            if agent.organization_id and agent.organization_id != organization_id:
                raise NotFoundError(message=f"Agent '{agent_id}' not found", code="AGENT_NOT_FOUND")
            rec = db.query(RecruitmentRecordModel).filter(RecruitmentRecordModel.agent_id == agent_id).first()
            if rec and rec.organization_id != organization_id:
                raise NotFoundError(message=f"Agent '{agent_id}' not found", code="AGENT_NOT_FOUND")
        return agent

    @staticmethod
    def create_agent(db: Session, agent_in: AgentCreate) -> AgentModel:
        if not agent_in.name.strip():
            raise ValidationError(message="Agent name cannot be blank", code="EMPTY_AGENT_NAME")

        if agent_in.id:
            existing = db.query(AgentModel).filter(AgentModel.id == agent_in.id).first()
            if existing:
                raise ConflictError(message=f"Agent with ID '{agent_in.id}' already exists", code="AGENT_ALREADY_EXISTS")

        agent_data = agent_in.model_dump(exclude_unset=True)
        agent = AgentModel(**agent_data, status="idle")
        db.add(agent)

        event_service.create_event(
            db=db,
            event_type="agent.created",
            agent_id=agent.id,
            payload={"name": agent.name, "role": agent.role, "station": agent.station},
            commit=False
        )

        db.commit()
        db.refresh(agent)
        return agent

    @staticmethod
    def update_agent(db: Session, agent_id: str, agent_in: AgentUpdate, organization_id: Optional[str] = None) -> AgentModel:
        agent = AgentService.get_agent_by_id(db, agent_id, organization_id=organization_id)
        update_data = agent_in.model_dump(exclude_unset=True)

        for field, value in update_data.items():
            setattr(agent, field, value)

        agent.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(agent)
        return agent

    @staticmethod
    def get_agent_tasks(db: Session, agent_id: str, organization_id: Optional[str] = None, limit: int = 50, offset: int = 0) -> List[TaskModel]:
        # Validate agent exists and belongs to tenant
        AgentService.get_agent_by_id(db, agent_id, organization_id=organization_id)

        limit = min(max(1, limit), 100)
        offset = max(0, offset)
        query = db.query(TaskModel).filter(TaskModel.assigned_agent_id == agent_id)
        if organization_id:
            query = query.filter(TaskModel.organization_id == organization_id)
        return (
            query
            .order_by(desc(TaskModel.created_at))
            .offset(offset)
            .limit(limit)
            .all()
        )

agent_service = AgentService()
