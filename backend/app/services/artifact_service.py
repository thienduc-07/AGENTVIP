from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import desc
from backend.app.models.artifact import ArtifactModel
from backend.app.models.task import TaskModel
from backend.app.core.errors import NotFoundError

class ArtifactService:
    @staticmethod
    def list_artifacts(
        db: Session,
        organization_id: Optional[str] = None,
        task_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> List[ArtifactModel]:
        limit = min(max(1, limit), 100)
        offset = max(0, offset)

        query = db.query(ArtifactModel)
        if organization_id:
            query = query.join(TaskModel, ArtifactModel.task_id == TaskModel.id).filter(
                TaskModel.organization_id == organization_id
            )
        if task_id:
            query = query.filter(ArtifactModel.task_id == task_id)

        return query.order_by(desc(ArtifactModel.created_at)).offset(offset).limit(limit).all()

    @staticmethod
    def get_artifact_by_id(
        db: Session,
        artifact_id: str,
        organization_id: Optional[str] = None,
    ) -> ArtifactModel:
        query = db.query(ArtifactModel).filter(ArtifactModel.id == artifact_id)
        if organization_id:
            query = query.join(TaskModel, ArtifactModel.task_id == TaskModel.id).filter(
                TaskModel.organization_id == organization_id
            )
        artifact = query.first()
        if not artifact:
            raise NotFoundError(message=f"Artifact '{artifact_id}' not found", code="ARTIFACT_NOT_FOUND")
        return artifact

    @staticmethod
    def get_artifact_content(
        db: Session,
        artifact_id: str,
        organization_id: Optional[str] = None,
    ) -> str:
        artifact = ArtifactService.get_artifact_by_id(db, artifact_id, organization_id=organization_id)
        from backend.app.core.config import settings
        from backend.app.agent_runtime.tools.security import safe_resolve_path
        target_path = safe_resolve_path(artifact.storage_path, base_root=settings.WORKSPACE_ROOT, must_exist=True, allow_write=False)
        return target_path.read_text(encoding="utf-8", errors="replace")

artifact_service = ArtifactService()
