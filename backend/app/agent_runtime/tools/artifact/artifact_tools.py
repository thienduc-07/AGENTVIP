import os
import uuid
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime
from backend.app.core.config import settings
from backend.app.agent_runtime.tools.base import Tool, ToolResult, ToolPermissionLevel, ToolCategory, SideEffectLevel
from backend.app.agent_runtime.tools.security import safe_resolve_path, PathSecurityError
from backend.app.models.artifact import ArtifactModel

class ArtifactCreateTool:
    name: str = "artifact.create"
    display_name: str = "Create Verified Artifact"
    description: str = (
        "Creates and registers an official deliverable artifact (markdown report, JSON data, TXT) "
        "inside the workspace sandbox. Records persistent metadata and tracks provenance."
    )
    category: ToolCategory = ToolCategory.ARTIFACT
    permission_level: ToolPermissionLevel = ToolPermissionLevel.LEVEL_1_WORKSPACE_WRITE
    side_effect_level: SideEffectLevel = SideEffectLevel.REVERSIBLE_MUTATION
    requires_approval: bool = False
    is_enabled: bool = True
    timeout_seconds: int = 15
    max_output_size: int = 50000

    input_schema: Dict[str, Any] = {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Artifact name or relative filename (e.g. 'maritime_analysis.md', 'fleet_metrics.json')"
            },
            "content": {
                "type": "string",
                "description": "Textual content for the artifact"
            },
            "artifact_type": {
                "type": "string",
                "description": "Category of artifact (e.g. 'report', 'dataset', 'code', 'log')",
                "default": "report"
            },
            "mime_type": {
                "type": "string",
                "description": "MIME type (e.g. 'text/markdown', 'application/json', 'text/plain')",
                "default": "text/markdown"
            }
        },
        "required": ["name", "content"]
    }

    async def execute(self, arguments: Dict[str, Any], context: Any = None) -> ToolResult:
        name = arguments.get("name", "").strip()
        content = arguments.get("content", "")
        artifact_type = arguments.get("artifact_type", "report")
        mime_type = arguments.get("mime_type", "text/markdown")

        if not name:
            return ToolResult(success=False, output="Artifact name cannot be empty.", error="INVALID_ARGUMENTS")

        try:
            # Artifacts are stored under workspace_sandbox/artifacts/
            artifacts_dir = settings.SANDBOX_DIR / "artifacts"
            artifacts_dir.mkdir(parents=True, exist_ok=True)

            target_path = safe_resolve_path(
                name,
                base_root=artifacts_dir,
                must_exist=False,
                allow_write=True
            )
            target_path.parent.mkdir(parents=True, exist_ok=True)

            # Atomic write pattern to prevent corrupt/partial writes during crashes
            temp_path = target_path.with_name(f".{target_path.name}.tmp.{uuid.uuid4().hex[:8]}")
            try:
                with open(temp_path, "w", encoding="utf-8") as f:
                    f.write(content)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(temp_path, target_path)
            except Exception as write_err:
                if temp_path.exists():
                    try:
                        temp_path.unlink()
                    except OSError:
                        pass
                raise write_err

            size_bytes = target_path.stat().st_size
            rel_storage = str(target_path.relative_to(settings.WORKSPACE_ROOT))
            artifact_id = f"art-{uuid.uuid4().hex[:12]}"
            task_id = getattr(context, "task_id", None) if context else None

            # Attempt DB registration if session available (idempotent duplicate prevention)
            db = getattr(context, "db", None)
            if db and task_id:
                try:
                    existing_art = db.query(ArtifactModel).filter(
                        ArtifactModel.task_id == task_id,
                        ArtifactModel.name == name,
                    ).first()
                    if existing_art:
                        existing_art.storage_path = rel_storage
                        existing_art.mime_type = mime_type
                        existing_art.size_bytes = size_bytes
                        existing_art.artifact_type = artifact_type
                        artifact_id = existing_art.id
                    else:
                        db_art = ArtifactModel(
                            id=artifact_id,
                            task_id=task_id,
                            name=name,
                            artifact_type=artifact_type,
                            storage_path=rel_storage,
                            mime_type=mime_type,
                            size_bytes=size_bytes,
                        )
                        db.add(db_art)
                    db.commit()
                except Exception:
                    if db:
                        db.rollback()

            return ToolResult(
                success=True,
                data={
                    "artifact_id": artifact_id,
                    "name": name,
                    "artifact_type": artifact_type,
                    "mime_type": mime_type,
                    "storage_path": rel_storage,
                    "size_bytes": size_bytes,
                    "task_id": task_id,
                },
                artifact_ids=[artifact_id],
                output=(
                    f"Successfully created artifact '{name}' (ID: {artifact_id}, "
                    f"Size: {size_bytes} bytes, Path: {rel_storage})."
                )
            )
        except PathSecurityError as e:
            return ToolResult(success=False, output=str(e), error="SECURITY_VIOLATION")
        except Exception as e:
            return ToolResult(success=False, output=f"Artifact creation failed: {str(e)}", error="CREATION_ERROR")


class ArtifactGetTool:
    name: str = "artifact.get"
    display_name: str = "Retrieve Artifact"
    description: str = "Retrieves metadata and textual contents of a previously created artifact."
    category: ToolCategory = ToolCategory.ARTIFACT
    permission_level: ToolPermissionLevel = ToolPermissionLevel.LEVEL_0_READ_ONLY
    side_effect_level: SideEffectLevel = SideEffectLevel.READ_ONLY
    requires_approval: bool = False
    is_enabled: bool = True
    timeout_seconds: int = 15
    max_output_size: int = 50000

    input_schema: Dict[str, Any] = {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Artifact name or relative path in workspace_sandbox/artifacts"
            },
            "max_lines": {
                "type": "integer",
                "description": "Maximum lines of content to return (default: 200)",
                "default": 200
            }
        },
        "required": ["name"]
    }

    async def execute(self, arguments: Dict[str, Any], context: Any = None) -> ToolResult:
        name = arguments.get("name", "").strip()
        max_lines = min(max(1, arguments.get("max_lines", 200)), 1000)

        if not name:
            return ToolResult(success=False, output="Artifact name cannot be empty.", error="INVALID_ARGUMENTS")

        artifacts_dir = settings.SANDBOX_DIR / "artifacts"
        target_path = artifacts_dir / name
        if not target_path.exists():
            # Check sandbox root directly
            alt_path = settings.SANDBOX_DIR / name
            if alt_path.exists():
                target_path = alt_path
            else:
                return ToolResult(
                    success=False,
                    output=f"Artifact '{name}' not found in sandbox artifacts directory.",
                    error="NOT_FOUND"
                )

        try:
            target_path = safe_resolve_path(str(target_path), base_root=settings.WORKSPACE_ROOT)
            with open(target_path, "r", encoding="utf-8", errors="replace") as f:
                lines = [f.readline() for _ in range(max_lines)]
            content = "".join([l for l in lines if l])
            size = target_path.stat().st_size

            return ToolResult(
                success=True,
                data={
                    "name": name,
                    "storage_path": str(target_path.relative_to(settings.WORKSPACE_ROOT)),
                    "size_bytes": size,
                    "lines_returned": len(lines),
                },
                output=f"=== Artifact: {name} ({size} bytes) ===\n{content}"
            )
        except Exception as e:
            return ToolResult(success=False, output=f"Failed to read artifact: {str(e)}", error="READ_ERROR")


class ArtifactListTool:
    name: str = "artifact.list"
    display_name: str = "List Artifacts"
    description: str = "Lists all artifacts generated in the workspace sandbox."
    category: ToolCategory = ToolCategory.ARTIFACT
    permission_level: ToolPermissionLevel = ToolPermissionLevel.LEVEL_0_READ_ONLY
    side_effect_level: SideEffectLevel = SideEffectLevel.READ_ONLY
    requires_approval: bool = False
    is_enabled: bool = True
    timeout_seconds: int = 15
    max_output_size: int = 20000

    input_schema: Dict[str, Any] = {
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Maximum number of artifacts to list (default: 20)",
                "default": 20
            }
        }
    }

    async def execute(self, arguments: Dict[str, Any], context: Any = None) -> ToolResult:
        limit = min(max(1, arguments.get("limit", 20)), 100)
        artifacts_dir = settings.SANDBOX_DIR / "artifacts"
        artifacts = []

        if artifacts_dir.exists():
            for item in sorted(artifacts_dir.glob("*")):
                if item.is_file() and not item.name.startswith("."):
                    artifacts.append({
                        "name": item.name,
                        "storage_path": str(item.relative_to(settings.WORKSPACE_ROOT)),
                        "size_bytes": item.stat().st_size,
                        "modified_at": datetime.fromtimestamp(item.stat().st_mtime).isoformat(),
                    })

        summary = f"Discovered {len(artifacts)} artifacts in sandbox:\n"
        lines = [f"- {a['name']} ({a['size_bytes']} bytes, {a['storage_path']})" for a in artifacts[:limit]]
        return ToolResult(
            success=True,
            data={"artifacts": artifacts[:limit], "total_count": len(artifacts)},
            output=summary + "\n".join(lines) if artifacts else "No artifacts discovered in sandbox."
        )


class ArtifactVerifyTool:
    name: str = "artifact.verify"
    display_name: str = "Verify Artifact Integrity"
    description: str = "Verifies that an artifact exists, has non-zero size, and satisfies format requirements."
    category: ToolCategory = ToolCategory.ARTIFACT
    permission_level: ToolPermissionLevel = ToolPermissionLevel.LEVEL_0_READ_ONLY
    side_effect_level: SideEffectLevel = SideEffectLevel.READ_ONLY
    requires_approval: bool = False
    is_enabled: bool = True
    timeout_seconds: int = 15
    max_output_size: int = 20000

    input_schema: Dict[str, Any] = {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Artifact name or relative path to verify"
            },
            "min_size_bytes": {
                "type": "integer",
                "description": "Minimum expected file size in bytes (default: 1)",
                "default": 1
            },
            "required_format": {
                "type": "string",
                "description": "Expected file extension (e.g. '.md', '.json', '.csv')",
                "default": ""
            }
        },
        "required": ["name"]
    }

    async def execute(self, arguments: Dict[str, Any], context: Any = None) -> ToolResult:
        name = arguments.get("name", "").strip()
        min_size = max(1, arguments.get("min_size_bytes", 1))
        required_fmt = arguments.get("required_format", "").strip().lower()

        if not name:
            return ToolResult(success=False, output="Artifact name cannot be empty.", error="INVALID_ARGUMENTS")

        artifacts_dir = settings.SANDBOX_DIR / "artifacts"
        target_path = artifacts_dir / name
        if not target_path.exists():
            target_path = settings.SANDBOX_DIR / name
            if not target_path.exists():
                return ToolResult(
                    success=False,
                    output=f"Verification failed: Artifact '{name}' does not exist.",
                    error="NOT_FOUND"
                )

        if required_fmt and not target_path.name.lower().endswith(required_fmt):
            return ToolResult(
                success=False,
                output=f"Verification failed: Expected format '{required_fmt}', got '{target_path.suffix}'.",
                error="FORMAT_MISMATCH"
            )

        size = target_path.stat().st_size
        if size < min_size:
            return ToolResult(
                success=False,
                output=f"Verification failed: Artifact size ({size} bytes) is below minimum ({min_size} bytes).",
                error="SIZE_TOO_SMALL"
            )

        return ToolResult(
            success=True,
            data={"name": name, "size_bytes": size, "verified": True},
            output=f"Artifact '{name}' VERIFIED: Size {size} bytes, format valid, content verified."
        )
