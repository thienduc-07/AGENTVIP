import asyncio
import time
import logging
from typing import Dict, Any, List, Optional, Set
from backend.app.agent_runtime.tools.base import (
    Tool, ToolResult, ToolPermissionLevel, ToolCategory, SideEffectLevel, ToolExecutionSemantics,
    ToolMetadata, ToolExecutionStatus, sanitize_for_audit
)
from backend.app.agent_runtime.tools.workspace.workspace_list import WorkspaceListTool
from backend.app.agent_runtime.tools.workspace.file_read import FileReadTool
from backend.app.agent_runtime.tools.workspace.file_search import FileSearchTool
from backend.app.agent_runtime.tools.workspace.workspace_write import WorkspaceWriteTool
from backend.app.agent_runtime.tools.workspace.verification import VerificationTool
from backend.app.agent_runtime.tools.workspace.calculator import CalculatorTool
from backend.app.agent_runtime.tools.artifact.artifact_tools import (
    ArtifactCreateTool, ArtifactGetTool, ArtifactListTool, ArtifactVerifyTool
)
from backend.app.agent_runtime.tools.data.data_tools import (
    DataInspectTool, DataProfileTool, DataSummarizeTool, DataValidateTool
)
from backend.app.agent_runtime.tools.web.web_tools import (
    WebSearchTool, WebFetchPageTool, WebExtractTextTool
)
from backend.app.agent_runtime.tools.api.api_tools import ApiCallTool
from backend.app.agent_runtime.tools.memory.memory_search import MemorySearchTool
from backend.app.agent_runtime.tools.memory.memory_get import MemoryGetTool
from backend.app.agent_runtime.tools.memory.memory_propose import MemoryProposeTool
from backend.app.agent_runtime.tools.memory.memory_archive import MemoryArchiveTool

logger = logging.getLogger("grandline.runtime.tools")

class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, Tool] = {}
        self._aliases: Dict[str, str] = {}
        self._disabled_tools: Set[str] = set()

    def register(self, tool: Tool, aliases: Optional[List[str]] = None) -> None:
        canonical_name = tool.name
        self._tools[canonical_name] = tool
        all_aliases = list(aliases or [])
        if "." in canonical_name:
            all_aliases.append(canonical_name.replace(".", "_"))
        for alias in all_aliases:
            self._aliases[alias] = canonical_name
        logger.debug(f"Registered tool: {canonical_name} (aliases={all_aliases})")

    def get(self, name: str) -> Optional[Tool]:
        canonical = self._aliases.get(name, name)
        if canonical not in self._tools and "_" in name:
            dot_candidate = name.replace("_", ".")
            canonical = self._aliases.get(dot_candidate, dot_candidate)
        return self._tools.get(canonical)

    def is_enabled(self, name: str) -> bool:
        canonical = self._aliases.get(name, name)
        return canonical not in self._disabled_tools

    def enable_tool(self, name: str) -> bool:
        canonical = self._aliases.get(name, name)
        if canonical in self._tools:
            self._disabled_tools.discard(canonical)
            logger.info(f"Tool '{canonical}' enabled.")
            return True
        return False

    def disable_tool(self, name: str) -> bool:
        canonical = self._aliases.get(name, name)
        if canonical in self._tools:
            self._disabled_tools.add(canonical)
            logger.info(f"Tool '{canonical}' disabled.")
            return True
        return False

    def list_tools(self) -> List[Tool]:
        return list(self._tools.values())

    def get_metadata(self, name: str) -> Optional[ToolMetadata]:
        tool = self.get(name)
        if not tool:
            return None
        return ToolMetadata(
            name=tool.name,
            display_name=getattr(tool, "display_name", tool.name.replace("_", " ").title()),
            description=tool.description,
            version=getattr(tool, "version", "1.0.0"),
            category=getattr(tool, "category", ToolCategory.WORKSPACE),
            permission_level=tool.permission_level,
            side_effect_level=getattr(tool, "side_effect_level", SideEffectLevel.READ_ONLY),
            execution_semantics=getattr(
                tool,
                "execution_semantics",
                ToolExecutionSemantics.EFFECTIVELY_ONCE
                if getattr(tool, "side_effect_level", SideEffectLevel.READ_ONLY) == SideEffectLevel.READ_ONLY
                else ToolExecutionSemantics.AT_LEAST_ONCE
            ),
            requires_approval=getattr(tool, "requires_approval", False),
            is_enabled=self.is_enabled(tool.name),
            is_healthy=getattr(tool, "is_healthy", True),
            rate_limit=getattr(tool, "rate_limit", 60),
            timeout_seconds=getattr(tool, "timeout_seconds", 30),
            max_output_size=getattr(tool, "max_output_size", 100000),
            input_schema=getattr(tool, "input_schema", {}),
            output_schema=getattr(tool, "output_schema", {}),
        )

    def list_metadata(self) -> List[ToolMetadata]:
        result = []
        for tool in self._tools.values():
            meta = self.get_metadata(tool.name)
            if meta:
                result.append(meta)
        return result

    def get_schemas(self, allowed_tool_names: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        schemas: List[Dict[str, Any]] = []
        # Expand allowed names to canonical names
        allowed_canonical = set()
        if allowed_tool_names:
            for name in allowed_tool_names:
                canonical = self._aliases.get(name, name)
                if canonical not in self._tools and "_" in name:
                    canonical = self._aliases.get(name.replace("_", "."), name.replace("_", "."))
                allowed_canonical.add(canonical)
                allowed_canonical.add(name)
                if "." in name:
                    allowed_canonical.add(name.replace(".", "_"))

        for name, tool in self._tools.items():
            if allowed_tool_names and name not in allowed_canonical:
                continue
            if not self.is_enabled(name):
                continue
            # Ensure valid function identifier matching ^[a-zA-Z0-9_-]+$ for all cloud providers
            clean_func_name = tool.name.replace(".", "_")
            self._aliases[clean_func_name] = tool.name
            schemas.append({
                "type": "function",
                "function": {
                    "name": clean_func_name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                }
            })
        return schemas

    async def execute(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        context: Any = None,
        max_allowed_level: ToolPermissionLevel = ToolPermissionLevel.LEVEL_1_WORKSPACE_WRITE,
    ) -> ToolResult:
        start_time = time.time()
        canonical_name = self._aliases.get(tool_name, tool_name)
        tool = self.get(canonical_name)

        if not tool:
            return ToolResult(
                success=False,
                output=f"Tool '{tool_name}' is not registered in the system.",
                error="TOOL_NOT_FOUND"
            )

        # 1. Check if tool is dynamically enabled
        if not self.is_enabled(canonical_name):
            return ToolResult(
                success=False,
                output=f"Tool '{tool_name}' has been temporarily disabled by policy or administrator.",
                error="TOOL_DISABLED"
            )

        # 2. Permission clearance check
        if tool.permission_level > max_allowed_level:
            return ToolResult(
                success=False,
                output=(
                    f"Permission denied: Tool '{tool_name}' requires level {tool.permission_level}, "
                    f"but current agent/policy only permits level {max_allowed_level}."
                ),
                error="PERMISSION_DENIED"
            )

        # 3. Enforce execution timeout
        timeout = getattr(tool, "timeout_seconds", 30)
        max_size = getattr(tool, "max_output_size", 100000)

        try:
            result = await asyncio.wait_for(
                tool.execute(arguments, context=context),
                timeout=float(timeout)
            )
            duration_ms = int((time.time() - start_time) * 1000)
            result.duration_ms = duration_ms

            # 4. Clamp output size if needed
            if len(result.output) > max_size:
                result.output = result.output[:max_size] + f"\n... [Output truncated to {max_size} characters]"

            return result

        except asyncio.TimeoutError:
            duration_ms = int((time.time() - start_time) * 1000)
            logger.error(f"Tool '{tool_name}' timed out after {timeout}s")
            return ToolResult(
                success=False,
                output=f"Tool '{tool_name}' execution timed out after {timeout} seconds.",
                error="TOOL_TIMEOUT",
                duration_ms=duration_ms
            )
        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            logger.error(f"Unhandled error in tool '{tool_name}': {str(e)}", exc_info=True)
            return ToolResult(
                success=False,
                output=f"Unhandled exception executing tool '{tool_name}': {str(e)}",
                error="TOOL_EXECUTION_ERROR",
                duration_ms=duration_ms
            )

def create_default_tool_registry() -> ToolRegistry:
    registry = ToolRegistry()

    # 1. Workspace Suite
    registry.register(WorkspaceListTool(), aliases=["workspace.list_files"])
    registry.register(FileReadTool(), aliases=["workspace.read_file"])
    registry.register(FileSearchTool(), aliases=["workspace.search"])
    registry.register(WorkspaceWriteTool(), aliases=["workspace.write_file"])
    registry.register(VerificationTool(), aliases=["workspace.verify_file"])
    registry.register(CalculatorTool(), aliases=["math.calculator"])

    # 2. Document & Artifact Suite
    registry.register(ArtifactCreateTool(), aliases=["artifact_create"])
    registry.register(ArtifactGetTool(), aliases=["artifact_get"])
    registry.register(ArtifactListTool(), aliases=["artifact_list"])
    registry.register(ArtifactVerifyTool(), aliases=["artifact_verify"])

    # 3. Data Analysis Suite
    registry.register(DataInspectTool(), aliases=["data_inspect"])
    registry.register(DataProfileTool(), aliases=["data_profile"])
    registry.register(DataSummarizeTool(), aliases=["data_summarize"])
    registry.register(DataValidateTool(), aliases=["data_validate"])

    # 4. Web Research Suite
    registry.register(WebSearchTool(), aliases=["web_search"])
    registry.register(WebFetchPageTool(), aliases=["web_fetch_page"])
    registry.register(WebExtractTextTool(), aliases=["web_extract_text"])

    # 5. API Integration Suite
    registry.register(ApiCallTool(), aliases=["api_call"])

    # 6. Memory Suite
    registry.register(MemorySearchTool(), aliases=["memory.search"])
    registry.register(MemoryGetTool(), aliases=["memory.get"])
    registry.register(MemoryProposeTool(), aliases=["memory.propose"])
    registry.register(MemoryArchiveTool(), aliases=["memory.archive"])

    return registry

default_tool_registry = create_default_tool_registry()
