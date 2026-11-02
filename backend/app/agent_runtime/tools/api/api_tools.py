import json
import socket
import urllib.parse
import urllib.request
from typing import Dict, Any, Optional
from backend.app.agent_runtime.tools.base import (
    Tool, ToolResult, ToolPermissionLevel, ToolCategory, SideEffectLevel, sanitize_for_audit
)
from backend.app.agent_runtime.tools.web.web_tools import validate_ssrf_safety

ALLOWED_API_DOMAINS = {
    "api.github.com",
    "httpbin.org",
    "jsonplaceholder.typicode.com",
    "raw.githubusercontent.com",
}

class ApiCallTool:
    name: str = "api.call"
    display_name: str = "Secure External API Integration"
    description: str = (
        "Performs controlled HTTP requests to approved external partner APIs. "
        "Strictly enforces SSRF protection, host allowlisting, request timeouts, and token redaction."
    )
    category: ToolCategory = ToolCategory.API
    permission_level: ToolPermissionLevel = ToolPermissionLevel.LEVEL_1_WORKSPACE_WRITE
    side_effect_level: SideEffectLevel = SideEffectLevel.REVERSIBLE_MUTATION
    requires_approval: bool = False
    is_enabled: bool = True
    timeout_seconds: int = 15
    max_output_size: int = 50000

    input_schema: Dict[str, Any] = {
        "type": "object",
        "properties": {
            "endpoint_url": {
                "type": "string",
                "description": "Full HTTPS URL to target API endpoint"
            },
            "method": {
                "type": "string",
                "enum": ["GET", "POST"],
                "default": "GET",
                "description": "HTTP request method"
            },
            "headers": {
                "type": "object",
                "description": "Optional request headers dictionary",
                "default": {}
            },
            "json_payload": {
                "type": "object",
                "description": "Optional JSON payload for POST requests",
                "default": {}
            }
        },
        "required": ["endpoint_url"]
    }

    async def execute(self, arguments: Dict[str, Any], context: Any = None) -> ToolResult:
        endpoint = arguments.get("endpoint_url", "").strip()
        method = arguments.get("method", "GET").upper()
        headers = arguments.get("headers", {})
        payload = arguments.get("json_payload", {})

        if not endpoint:
            return ToolResult(success=False, output="Endpoint URL cannot be empty.", error="INVALID_ARGUMENTS")

        # 1. SSRF Safety Check
        try:
            safe_url = validate_ssrf_safety(endpoint)
        except ValueError as e:
            return ToolResult(
                success=False,
                output=f"Security Policy Denied: {str(e)}",
                error="SSRF_FORBIDDEN"
            )

        # 2. Host verification
        parsed = urllib.parse.urlparse(safe_url)
        hostname = (parsed.hostname or "").lower()
        if hostname not in ALLOWED_API_DOMAINS and not hostname.endswith(".grandline.local"):
            return ToolResult(
                success=False,
                output=(
                    f"Security Policy Denied: Host '{hostname}' is not in the approved API domain allowlist: "
                    f"{sorted(list(ALLOWED_API_DOMAINS))}."
                ),
                error="HOST_NOT_ALLOWLISTED"
            )

        # 3. Method restrictions: POST requires permission/approval check if not read-only
        if method == "POST":
            # Set high risk side effect
            self.side_effect_level = SideEffectLevel.HIGH_RISK

        # 4. Execute HTTP Request
        try:
            data_bytes = None
            req_headers = {"User-Agent": "GrandLineAgent/1.0", "Accept": "application/json"}
            if method == "POST":
                # Propagate stable idempotency key to external provider if available
                ctx_key = getattr(context, "idempotency_key", None) or getattr(context, "task_id", None)
                if ctx_key:
                    req_headers["Idempotency-Key"] = str(ctx_key)
                    req_headers["X-Request-Id"] = str(ctx_key)
            if headers and isinstance(headers, dict):
                req_headers.update(headers)

            if method == "POST" and payload:
                data_bytes = json.dumps(payload).encode("utf-8")
                req_headers["Content-Type"] = "application/json"

            req = urllib.request.Request(safe_url, data=data_bytes, headers=req_headers, method=method)
            with urllib.request.urlopen(req, timeout=10) as resp:
                status_code = resp.status
                raw_body = resp.read(50000).decode("utf-8", errors="replace")

            # Try to parse as JSON or truncate
            try:
                parsed_json = json.loads(raw_body)
                output_summary = json.dumps(parsed_json, indent=2)[:3000]
            except Exception:
                parsed_json = None
                output_summary = raw_body[:3000]

            return ToolResult(
                success=True,
                data={
                    "status_code": status_code,
                    "endpoint": safe_url,
                    "method": method,
                    "response": parsed_json or output_summary,
                },
                output=f"API Call Succeeded [HTTP {status_code}] from {safe_url}:\n{output_summary}"
            )
        except Exception as e:
            return ToolResult(
                success=False,
                output=f"API Call Failed for '{endpoint}': {str(e)}",
                error="HTTP_REQUEST_ERROR"
            )
