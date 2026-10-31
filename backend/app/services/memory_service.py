import re
import uuid
import logging
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, func

from backend.app.models.memory import MemoryModel, MemoryCitationModel
from backend.app.schemas.memory import MemoryCreate, MemoryUpdate, MemorySearchResponse, MemorySearchResultItem, MemoryOverviewStats
from backend.app.core.errors import ValidationError, NotFoundError, PermissionDeniedError

logger = logging.getLogger("grandline.memory.service")

# Regex patterns for detecting credentials, private keys, or API secrets
SENSITIVE_PATTERNS = [
    re.compile(r"sk-[a-zA-Z0-9_\-]{20,}", re.IGNORECASE),
    re.compile(r"AIza[0-9A-Za-z\-_]{35}", re.IGNORECASE),
    re.compile(r"Bearer\s+[a-zA-Z0-9_\-\.]{20,}", re.IGNORECASE),
    re.compile(r"-----BEGIN (RSA|OPENSSH|PRIVATE) KEY-----", re.IGNORECASE),
    re.compile(r"(password|secret|api_key|access_token)\s*[:=]\s*['\"][^\s'\"]{6,}['\"]", re.IGNORECASE),
]

class MemoryService:
    def sanitize_content(self, text: str) -> str:
        """Detects and redacts credentials or secrets from memory content."""
        if not text:
            return text
        sanitized = text
        for pattern in SENSITIVE_PATTERNS:
            if pattern.search(sanitized):
                sanitized = pattern.sub("[REDACTED_SECRET]", sanitized)
        return sanitized

    def validate_no_raw_secrets(self, text: str) -> None:
        """Strictly throws ValidationError if high-risk private keys or tokens are detected."""
        if not text:
            return
        for pattern in SENSITIVE_PATTERNS:
            if pattern.search(text):
                raise ValidationError(
                    message="Memory content contains sensitive credentials, API keys, or private secrets.",
                    code="SENSITIVE_DATA_PROHIBITED",
                )

    def can_access_memory(
        self,
        caller_agent_id: Optional[str],
        memory: MemoryModel,
        organization_id: Optional[str] = None,
    ) -> bool:
        """
        Enforces tenant isolation and memory read access control:
        - If organization_id is specified, memory must belong to that organization or be tenant-neutral.
        - Shared scope: accessible by all authorized agents in the organization.
        - Agent scope: accessible only by the owner agent, or supervisor.
        - Task scope: accessible if caller matches owner or supervisor.
        """
        if organization_id:
            meta = memory.metadata_json or {}
            mem_org = meta.get("organization_id")
            if mem_org and mem_org != organization_id:
                return False
            if memory.scope_id:
                if memory.scope_id.startswith("org_") and memory.scope_id != organization_id:
                    return False
                if memory.scope_type in ["shared", "workspace"] and memory.scope_id != organization_id:
                    return False
            if memory.source_task and getattr(memory.source_task, "organization_id", None):
                if memory.source_task.organization_id != organization_id:
                    return False
            owner_ag = getattr(memory, "owner_agent", None)
            if owner_ag and getattr(owner_ag, "organization_id", None):
                if owner_ag.organization_id != organization_id:
                    return False

        if not caller_agent_id:
            return memory.scope_type in ["shared", "workspace"]

        if caller_agent_id == "agent-captain-roger":
            return True

        if memory.scope_type in ["shared", "workspace"]:
            return True

        if memory.scope_type == "agent":
            return memory.owner_agent_id == caller_agent_id

        if memory.scope_type in ["task", "working"]:
            if memory.owner_agent_id == caller_agent_id:
                return True
            return False

        return False

    def check_duplicate_or_conflict(
        self,
        db: Session,
        title: str,
        content: str,
        scope_type: str,
        scope_id: Optional[str] = None,
    ) -> Tuple[bool, Optional[MemoryModel], bool]:
        """
        Checks for exact duplicates or semantic conflicts in the same scope.
        Returns: (is_exact_duplicate, existing_memory, is_conflict)
        """
        normalized_title = title.strip().lower()
        query = db.query(MemoryModel).filter(
            MemoryModel.scope_type == scope_type,
            MemoryModel.status.in_(["active", "candidate"]),
        )
        if scope_id:
            query = query.filter(MemoryModel.scope_id == scope_id)

        existing_memories = query.all()
        for mem in existing_memories:
            # Check exact duplicate content or identical title
            if mem.content.strip().lower() == content.strip().lower():
                return True, mem, False
            if mem.title.strip().lower() == normalized_title:
                # Same title but different content implies conflict / potential update
                return False, mem, True

        return False, None, False

    def create_memory(
        self,
        db: Session,
        data: MemoryCreate,
        auto_activate: bool = False,
        organization_id: Optional[str] = None,
    ) -> MemoryModel:
        """Creates or proposes a new memory record with validation and secret checks."""
        # Validate and sanitize
        self.validate_no_raw_secrets(data.content)
        if data.summary:
            self.validate_no_raw_secrets(data.summary)

        # Duplicate check
        is_dup, existing, is_conflict = self.check_duplicate_or_conflict(
            db, data.title, data.content, data.scope_type, data.scope_id
        )
        if is_dup and existing:
            logger.info(f"Duplicate memory detected ('{data.title}'). Returning existing memory '{existing.id}'")
            return existing

        expires_at = None
        if data.expires_in_seconds and data.expires_in_seconds > 0:
            expires_at = datetime.utcnow() + timedelta(seconds=data.expires_in_seconds)

        initial_status = "active" if auto_activate else data.status
        metadata = data.metadata or {}
        if organization_id:
            metadata["organization_id"] = organization_id
        if is_conflict and existing:
            metadata["supersedes_memory_id"] = existing.id
            metadata["conflict_detected"] = True

        source_task_id = data.source_task_id
        if source_task_id:
            from backend.app.models.task import TaskModel
            if not db.query(TaskModel.id).filter(TaskModel.id == source_task_id).first():
                source_task_id = None

        memory = MemoryModel(
            memory_type=data.memory_type,
            scope_type=data.scope_type,
            scope_id=data.scope_id,
            owner_agent_id=data.owner_agent_id,
            title=data.title.strip(),
            content=data.content.strip(),
            summary=data.summary.strip() if data.summary else None,
            source_type=data.source_type,
            source_id=data.source_id,
            source_task_id=source_task_id,
            confidence=data.confidence,
            verification_status=data.verification_status,
            sensitivity_level=data.sensitivity_level,
            status=initial_status,
            expires_at=expires_at,
            metadata_json=metadata,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )

        db.add(memory)
        db.commit()
        db.refresh(memory)
        logger.info(f"Memory created: '{memory.id}' [{memory.status}] scope={memory.scope_type} title='{memory.title}'")
        return memory

    def get_memory_by_id(
        self,
        db: Session,
        memory_id: str,
        caller_agent_id: Optional[str] = None,
        record_access: bool = True,
        organization_id: Optional[str] = None,
    ) -> MemoryModel:
        """Retrieves a memory by ID after enforcing access permissions and tenant isolation."""
        memory = db.query(MemoryModel).filter(MemoryModel.id == memory_id).first()
        if not memory or memory.status == "deleted":
            raise NotFoundError(message=f"Memory '{memory_id}' not found.", code="MEMORY_NOT_FOUND")

        if not self.can_access_memory(caller_agent_id, memory, organization_id=organization_id):
            raise NotFoundError(
                message=f"Memory '{memory_id}' not found.",
                code="MEMORY_NOT_FOUND",
            )

        # Check expiration
        if memory.is_expired() and memory.status == "active":
            memory.status = "expired"
            db.commit()

        if record_access:
            memory.access_count += 1
            memory.last_accessed_at = datetime.utcnow()
            db.commit()

        return memory

    def approve_candidate(self, db: Session, memory_id: str) -> MemoryModel:
        """Approves a candidate memory, transitioning it to active."""
        memory = db.query(MemoryModel).filter(MemoryModel.id == memory_id).first()
        if not memory:
            raise NotFoundError(message=f"Memory '{memory_id}' not found.", code="MEMORY_NOT_FOUND")
        memory.status = "active"
        memory.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(memory)
        return memory

    def reject_candidate(self, db: Session, memory_id: str, reason: Optional[str] = None) -> MemoryModel:
        """Rejects a candidate memory."""
        memory = db.query(MemoryModel).filter(MemoryModel.id == memory_id).first()
        if not memory:
            raise NotFoundError(message=f"Memory '{memory_id}' not found.", code="MEMORY_NOT_FOUND")
        memory.status = "rejected"
        meta = memory.metadata_json or {}
        if reason:
            meta["rejection_reason"] = reason
        memory.metadata_json = meta
        memory.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(memory)
        return memory

    def archive_memory(self, db: Session, memory_id: str, reason: Optional[str] = None) -> MemoryModel:
        """Archives a memory."""
        memory = db.query(MemoryModel).filter(MemoryModel.id == memory_id).first()
        if not memory:
            raise NotFoundError(message=f"Memory '{memory_id}' not found.", code="MEMORY_NOT_FOUND")
        memory.status = "archived"
        meta = memory.metadata_json or {}
        if reason:
            meta["archive_reason"] = reason
        memory.metadata_json = meta
        memory.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(memory)
        return memory

    def delete_memory(self, db: Session, memory_id: str) -> MemoryModel:
        """Soft deletes a memory."""
        memory = db.query(MemoryModel).filter(MemoryModel.id == memory_id).first()
        if not memory:
            raise NotFoundError(message=f"Memory '{memory_id}' not found.", code="MEMORY_NOT_FOUND")
        memory.status = "deleted"
        memory.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(memory)
        return memory

    def record_citation(
        self,
        db: Session,
        memory_id: str,
        task_id: Optional[str],
        agent_id: str,
        relevance_score: float = 1.0,
    ) -> MemoryCitationModel:
        """Records that an agent/task cited or used a specific memory."""
        resolved_task_id = task_id
        if resolved_task_id:
            from backend.app.models.task import TaskModel
            if not db.query(TaskModel.id).filter(TaskModel.id == resolved_task_id).first():
                resolved_task_id = None

        citation = MemoryCitationModel(
            memory_id=memory_id,
            task_id=resolved_task_id,
            agent_id=agent_id,
            relevance_score=relevance_score,
            created_at=datetime.utcnow(),
        )
        db.add(citation)
        db.commit()
        return citation

    def search_memories(
        self,
        db: Session,
        query: Optional[str] = None,
        scope_type: Optional[str] = None,
        scope_id: Optional[str] = None,
        owner_agent_id: Optional[str] = None,
        memory_type: Optional[str] = None,
        status: Optional[str] = "active",
        caller_agent_id: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
        task_id_for_citation: Optional[str] = None,
        organization_id: Optional[str] = None,
    ) -> MemorySearchResponse:
        """
        Retrieves, ranks, and filters memories based on permissions, status, query keywords, and tenant scope.
        """
        q = db.query(MemoryModel).filter(MemoryModel.status != "deleted")

        if status:
            q = q.filter(MemoryModel.status == status)

        if memory_type:
            q = q.filter(MemoryModel.memory_type == memory_type)

        if scope_type:
            q = q.filter(MemoryModel.scope_type == scope_type)

        if scope_id:
            q = q.filter(MemoryModel.scope_id == scope_id)

        if owner_agent_id:
            q = q.filter(MemoryModel.owner_agent_id == owner_agent_id)

        memories = q.all()

        # Filter out expired or inaccessible memories
        now = datetime.utcnow()
        valid_memories: List[MemoryModel] = []
        for mem in memories:
            if mem.expires_at and mem.expires_at < now:
                if mem.status == "active":
                    mem.status = "expired"
                    db.commit()
                continue
            if not self.can_access_memory(caller_agent_id, mem, organization_id=organization_id):
                continue
            valid_memories.append(mem)

        # Keyword & Token relevance ranking
        scored_items: List[Tuple[MemoryModel, float]] = []
        query_tokens = [tok.lower().strip() for tok in re.split(r"[\s,;._\-]+", query or "") if len(tok.strip()) > 1]

        for mem in valid_memories:
            score = 1.0
            if query_tokens:
                title_lower = mem.title.lower()
                summary_lower = (mem.summary or "").lower()
                content_lower = mem.content.lower()

                matches = 0
                for tok in query_tokens:
                    if tok in title_lower:
                        matches += 3.0
                    if tok in summary_lower:
                        matches += 2.0
                    if tok in content_lower:
                        matches += 1.0

                if matches == 0:
                    continue  # Token filtering: skip items with 0 relevance match
                score = matches * mem.confidence
            else:
                score = mem.confidence

            scored_items.append((mem, score))

        # Sort by relevance score descending
        scored_items.sort(key=lambda x: x[1], reverse=True)

        # Slice results
        total = len(scored_items)
        paged_items = scored_items[offset : offset + limit]

        result_items: List[MemorySearchResultItem] = []
        for mem, score in paged_items:
            # Update access telemetry
            mem.access_count += 1
            mem.last_accessed_at = now
            if caller_agent_id and task_id_for_citation:
                self.record_citation(db, mem.id, task_id_for_citation, caller_agent_id, score)

            result_items.append(
                MemorySearchResultItem(
                    memory=mem.to_dict(),
                    relevance_score=round(score, 2),
                )
            )

        db.commit()
        return MemorySearchResponse(total=total, items=result_items)

    def get_overview_stats(self, db: Session) -> MemoryOverviewStats:
        """Aggregates memory statistics across scopes, types, and lifecycle states."""
        now = datetime.utcnow()
        all_mems = db.query(MemoryModel).filter(MemoryModel.status != "deleted").all()

        total_active = 0
        total_candidate = 0
        total_archived = 0
        total_expired = 0
        by_scope: Dict[str, int] = {}
        by_type: Dict[str, int] = {}

        for m in all_mems:
            if m.expires_at and m.expires_at < now:
                total_expired += 1
            elif m.status == "active":
                total_active += 1
            elif m.status == "candidate":
                total_candidate += 1
            elif m.status == "archived":
                total_archived += 1

            by_scope[m.scope_type] = by_scope.get(m.scope_type, 0) + 1
            by_type[m.memory_type] = by_type.get(m.memory_type, 0) + 1

        recent = (
            db.query(MemoryModel)
            .filter(MemoryModel.status != "deleted")
            .order_by(MemoryModel.created_at.desc())
            .limit(10)
            .all()
        )

        return MemoryOverviewStats(
            total_active=total_active,
            total_candidate=total_candidate,
            total_archived=total_archived,
            total_expired=total_expired,
            by_scope=by_scope,
            by_type=by_type,
            recent_memories=[m.to_dict() for m in recent],
        )

memory_service = MemoryService()
