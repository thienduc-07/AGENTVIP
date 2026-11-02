import os
import uuid
from pathlib import Path
from typing import Dict, Any, Optional
from backend.app.core.config import settings
from backend.app.agent_runtime.tools.base import Tool, ToolResult, ToolPermissionLevel
from backend.app.agent_runtime.tools.security import safe_resolve_path, PathSecurityError

class WorkspaceWriteTool:
    name: str = "workspace_write"
    description: str = (
        "Creates or overwrites a file inside the designated workspace_sandbox directory. "
        "Strictly prevents writing to system files, source root, or secret configurations."
    )
    permission_level: ToolPermissionLevel = ToolPermissionLevel.LEVEL_1_WORKSPACE_WRITE
    timeout_seconds: int = 15
    input_schema: Dict[str, Any] = {
        "type": "object",
        "properties": {
            "filepath": {
                "type": "string",
                "description": "Relative filename or path within workspace_sandbox (e.g. 'summary.md', 'reports/analysis.txt')"
            },
            "content": {
                "type": "string",
                "description": "Textual content to write into the file"
            },
            "overwrite": {
                "type": "boolean",
                "description": "Whether to overwrite if file already exists (default: true)",
                "default": True
            }
        },
        "required": ["filepath", "content"]
    }

    async def execute(self, arguments: Dict[str, Any], context: Any = None) -> ToolResult:
        filepath = arguments.get("filepath", "").strip()
        content = arguments.get("content", "")
        overwrite = arguments.get("overwrite", True)

        if not filepath:
            return ToolResult(success=False, output="Filepath argument cannot be empty.", error="INVALID_ARGUMENTS")

        try:
            # Write operations are strictly scoped to SANDBOX_DIR
            target_path = safe_resolve_path(
                filepath,
                base_root=settings.SANDBOX_DIR,
                must_exist=False,
                allow_write=True
            )

            file_existed = target_path.exists()
            if file_existed and not overwrite:
                return ToolResult(
                    success=False,
                    output=f"File '{filepath}' already exists and overwrite is set to false.",
                    error="FILE_ALREADY_EXISTS"
                )

            # Ensure parent directories exist
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

            written_bytes = target_path.stat().st_size
            rel_path = str(target_path.relative_to(settings.WORKSPACE_ROOT))

            return ToolResult(
                success=True,
                data={
                    "filepath": rel_path,
                    "filename": target_path.name,
                    "size_bytes": written_bytes,
                    "is_overwrite": file_existed,
                    "absolute_path": str(target_path),
                },
                output=(
                    f"Successfully wrote {written_bytes} bytes to '{rel_path}' "
                    f"({'updated existing file' if file_existed else 'created new file'})."
                )
            )

        except PathSecurityError as e:
            return ToolResult(success=False, output=str(e), error="SECURITY_VIOLATION")
        except Exception as e:
            return ToolResult(success=False, output=f"Write failed: {str(e)}", error="EXECUTION_ERROR")
