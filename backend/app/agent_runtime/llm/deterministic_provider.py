import json
import logging
from typing import List, Dict, Any, Optional
from backend.app.agent_runtime.llm.base import (
    LLMProvider,
    LLMResponse,
    LLMHealthCheckResult,
    ToolCallRequest,
    LLMUsage,
)

logger = logging.getLogger("grandline.llm.deterministic")

class DeterministicProvider:
    """
    High-reliability, zero-cost deterministic local reasoning engine.
    Parses intent, generates structured plans and dispatches real tool calls
    according to user instructions, enabling offline operation and CI testing.
    NOTE: DeterministicProvider is NEVER counted as a live LLM provider.
    """
    def __init__(self, model: str = "deterministic-v1"):
        self.provider_name = "deterministic"
        self.model = model
        self.is_live_provider = False

    async def check_health(self) -> LLMHealthCheckResult:
        return LLMHealthCheckResult(
            healthy=True,
            provider=self.provider_name,
            model=self.model,
            base_url=None,
            is_live_provider=False,
            latency_ms=0.0,
        )

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        *,
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
    ) -> LLMResponse:
        last_message = messages[-1] if messages else {"role": "user", "content": ""}
        content_in = str(last_message.get("content", ""))
        available_tools = {t.get("function", {}).get("name") for t in (tools or [])}

        # Check conversation history to understand current stage
        has_any_tool_result = any(m.get("role") == "tool" for m in messages)
        has_write_result = any(
            m.get("role") == "tool" and "workspace_write" in str(m.get("content", ""))
            for m in messages
        )
        has_verification_result = any(
            m.get("role") == "tool" and ("verification_tool" in str(m.get("content", "")) or "exists" in str(m.get("content", "")))
            for m in messages
        )
        has_list_result = any(
            m.get("role") == "tool" and "workspace_list" in str(m.get("content", ""))
            for m in messages
        )
        has_read_result = any(
            m.get("role") == "tool" and "file_read" in str(m.get("content", ""))
            for m in messages
        )
        has_calc_result = any(
            m.get("role") == "tool" and "calculator" in str(m.get("content", ""))
            for m in messages
        )
        has_memory_search_result = any(
            m.get("role") == "tool" and ("memory_search" in str(m.get("content", "")) or "memories found" in str(m.get("content", "")))
            for m in messages
        )

        user_prompt = ""
        for m in messages:
            if m.get("role") == "user":
                user_prompt += " " + str(m.get("content", ""))
        user_prompt = user_prompt.lower()

        # 1. If this is a planning prompt (asking for structured JSON plan)
        if "generate an execution plan" in content_in.lower() or "json plan" in content_in.lower():
            if "report" in user_prompt or "báo cáo" in user_prompt or "summary" in user_prompt or "structure" in user_prompt or "cấu trúc" in user_prompt:
                plan_json = json.dumps({
                    "objective": "Analyze workspace files, compile report, and verify artifact",
                    "steps": [
                        {
                            "step_index": 1,
                            "title": "Inspect workspace directory structure",
                            "description": "List files in workspace to locate relevant project files",
                            "expected_output": "List of discovered files",
                            "required_tool": "workspace_list"
                        },
                        {
                            "step_index": 2,
                            "title": "Read key files for analysis",
                            "description": "Read project files to analyze architecture and configuration",
                            "expected_output": "Extracted file content",
                            "required_tool": "file_read"
                        },
                        {
                            "step_index": 3,
                            "title": "Generate comprehensive report",
                            "description": "Write analysis report to workspace_sandbox directory",
                            "expected_output": "Saved report artifact",
                            "required_tool": "workspace_write"
                        },
                        {
                            "step_index": 4,
                            "title": "Verify report integrity",
                            "description": "Verify generated report exists and has valid content",
                            "expected_output": "Verification confirmed",
                            "required_tool": "verification_tool"
                        }
                    ]
                })
            else:
                plan_json = json.dumps({
                    "objective": "Execute requested workspace inspection and verification",
                    "steps": [
                        {
                            "step_index": 1,
                            "title": "Inspect workspace contents",
                            "description": "List and locate target files in workspace",
                            "expected_output": "Discovered workspace items",
                            "required_tool": "workspace_list"
                        },
                        {
                            "step_index": 2,
                            "title": "Verify target conditions",
                            "description": "Verify workspace artifacts and integrity",
                            "expected_output": "Verification check complete",
                            "required_tool": "verification_tool"
                        }
                    ]
                })

            return LLMResponse(
                content=plan_json,
                thought="Deterministic reasoning: Generated structured execution plan.",
                finish_reason="stop",
                usage=LLMUsage(prompt_tokens=120, completion_tokens=180, total_tokens=300)
            )

        # 2. Specialized Tool Execution Sequences

        # Writer Agent: Write report -> Verify report
        if "workspace_write" in available_tools and not has_write_result:
            filename = "multiagent_report.md"
            report_content = (
                "# AI Agent City — Multi-Agent Fleet Execution Report\n\n"
                "## 1. Executive Summary\n"
                "Multi-agent collaborative workflow successfully orchestrated across specialized Grand Line stations.\n\n"
                "## 2. Research & Findings\n"
                "- Verified workspace architecture and repository boundaries.\n"
                "- Validated database models, state machines, and event streaming mechanisms.\n\n"
                "## 3. Quality & Policy Compliance\n"
                "All actions executed strictly within assigned permission levels and sandbox constraints.\n"
            )
            return LLMResponse(
                thought="Writer agent executing: Generating comprehensive verified markdown report.",
                tool_calls=[
                    ToolCallRequest(
                        tool_name="workspace_write",
                        arguments={"filepath": filename, "content": report_content}
                    )
                ],
                usage=LLMUsage(prompt_tokens=140, completion_tokens=70, total_tokens=210)
            )

        if has_write_result and "verification_tool" in available_tools and not has_verification_result:
            return LLMResponse(
                thought="Verifying created report artifact in workspace_sandbox.",
                tool_calls=[
                    ToolCallRequest(
                        tool_name="verification_tool",
                        arguments={"filepath": "multiagent_report.md", "min_size_bytes": 10}
                    )
                ],
                usage=LLMUsage(prompt_tokens=100, completion_tokens=35, total_tokens=135)
            )

        # Analyst Agent: Calculator
        if "calculator" in available_tools and not has_calc_result and any(w in user_prompt for w in ["calc", "metric", "analy", "số"]):
            return LLMResponse(
                thought="Data Analyst executing: Performing quantitative metric calculation via safe AST calculator.",
                tool_calls=[
                    ToolCallRequest(
                        tool_name="calculator",
                        arguments={"expression": "(1024 * 768) / 60"}
                    )
                ],
                usage=LLMUsage(prompt_tokens=90, completion_tokens=30, total_tokens=120)
            )

        # Reviewer Agent: Auditing files or verification
        if "reviewer" in content_in.lower() or "audit" in user_prompt:
            if "verification_tool" in available_tools and not has_verification_result:
                return LLMResponse(
                    thought="Reviewer executing: Inspecting and auditing verified artifacts.",
                    tool_calls=[
                        ToolCallRequest(
                            tool_name="verification_tool",
                            arguments={"filepath": "multiagent_report.md", "min_size_bytes": 10}
                        )
                    ],
                    usage=LLMUsage(prompt_tokens=90, completion_tokens=30, total_tokens=120)
                )

        # Memory Search Tool invocation
        if "memory_search" in available_tools and not has_memory_search_result and any(w in user_prompt for w in ["memory", "bộ nhớ", "prior", "knowledge", "truy xuất"]):
            return LLMResponse(
                thought="Searching persistent memory for relevant prior task findings.",
                tool_calls=[
                    ToolCallRequest(
                        tool_name="memory_search",
                        arguments={"query": "architecture report analysis"}
                    )
                ],
                usage=LLMUsage(prompt_tokens=90, completion_tokens=30, total_tokens=120)
            )

        # Research Agent or General Agent: Workspace List
        if "workspace_list" in available_tools and not has_list_result and not has_any_tool_result:
            return LLMResponse(
                thought="Research Agent executing: Scanning workspace repository directory.",
                tool_calls=[
                    ToolCallRequest(
                        tool_name="workspace_list",
                        arguments={"subpath": "", "max_depth": 2}
                    )
                ],
                usage=LLMUsage(prompt_tokens=80, completion_tokens=30, total_tokens=110)
            )

        # Read tool if file read is available and no tools run yet
        if "file_read" in available_tools and not has_read_result and not has_any_tool_result:
            return LLMResponse(
                thought="Reading documentation to extract source facts.",
                tool_calls=[
                    ToolCallRequest(
                        tool_name="file_read",
                        arguments={"filepath": "README.md", "max_bytes": 2000}
                    )
                ],
                usage=LLMUsage(prompt_tokens=90, completion_tokens=30, total_tokens=120)
            )

        # Fallback Verification tool if available and not yet run
        if "verification_tool" in available_tools and not has_any_tool_result:
            return LLMResponse(
                thought="Verifying environment status.",
                tool_calls=[
                    ToolCallRequest(
                        tool_name="verification_tool",
                        arguments={"filepath": "README.md", "min_size_bytes": 10}
                    )
                ],
                usage=LLMUsage(prompt_tokens=90, completion_tokens=30, total_tokens=120)
            )

        # Final Synthesis: At least one tool has run
        summary = (
            "Nhiệm vụ chuyên biệt đã hoàn thành thành công và được xác minh độc lập:\n"
            "- Các công cụ được cấp phép đã thực thi và hoàn trả dữ liệu chuẩn xác.\n"
            "- Đã trích xuất bằng chứng xác thực và tuân thủ tuyệt đối ranh giới quyền hạn."
        )
        return LLMResponse(
            content=summary,
            thought="Task execution verified. Synthesized final response.",
            finish_reason="stop",
            usage=LLMUsage(prompt_tokens=180, completion_tokens=90, total_tokens=270)
        )
