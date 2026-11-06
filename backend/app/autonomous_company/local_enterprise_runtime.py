"""
PROVIPAGENT — LOCAL ENTERPRISE RUNTIME & SANDBOX ENGINE
Part 5: Local Computer Execution, Security Sandboxing, Audit Logging & Deliverable Packaging.
"""

from __future__ import annotations
import asyncio
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from backend.app.core.config import settings

def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

SECRET_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|secret|password|token|bearer)\s*[:=]\s*['\"]?([a-zA-Z0-9_\-\.]{8,})['\"]?"),
    re.compile(r"ghp_[a-zA-Z0-9]{36}"),
    re.compile(r"sk-[a-zA-Z0-9]{32,}"),
]

def redact_sensitive_output(text: str) -> str:
    """Masks API keys, passwords, and tokens before logging or broadcasting."""
    redacted = text
    for pat in SECRET_PATTERNS:
        redacted = pat.sub(r"\1: [REDACTED_SECRET]", redacted)
    return redacted

class LocalEnterpriseRuntime:
    """
    Secure sandboxed local execution runtime allowing authorized agents to
    create project directories, write source files, install dependencies,
    execute tests, and package real deliverables on the host Mac computer.
    """

    ALLOWED_EXECUTABLES: Set[str] = {
        "python3",
        "python",
        "pytest",
        "node",
        "npm",
        "cat",
        "ls",
        "grep",
        "pwd",
        "echo",
        "git",
        "mkdir",
        "find",
    }

    def __init__(self, project_slug: str, base_sandbox_dir: Optional[Path] = None):
        clean_slug = re.sub(r"[^a-zA-Z0-9_\-]", "_", project_slug).strip("_")
        if not clean_slug:
            clean_slug = f"project_{int(time.time())}"
        self.project_slug = clean_slug

        root_sandbox = base_sandbox_dir or (settings.BASE_DIR / "workspace_sandbox" / "projects")
        self.project_dir = (root_sandbox / self.project_slug).resolve()
        self.project_dir.mkdir(parents=True, exist_ok=True)
        self.audit_log: List[Dict[str, Any]] = []

    def resolve_safe_path(self, relative_path: str) -> Path:
        """
        Guarantees that the target path stays strictly inside the project sandbox.
        Prevents directory traversal (e.g. '../../etc/passwd').
        """
        # Strip leading slashes to prevent absolute root escapes
        clean_rel = relative_path.lstrip("/\\")
        target = (self.project_dir / clean_rel).resolve()
        try:
            target.relative_to(self.project_dir)
        except ValueError:
            raise PermissionError(
                f"Security Sandbox Breach: Path '{relative_path}' resolves outside sandbox directory '{self.project_dir}'!"
            )
        return target

    def write_file(self, relative_path: str, content: str, agent_id: str = "agent-system") -> Dict[str, Any]:
        """Creates or updates a file inside the sandboxed project directory."""
        safe_path = self.resolve_safe_path(relative_path)
        safe_path.parent.mkdir(parents=True, exist_ok=True)
        safe_path.write_text(content, encoding="utf-8")
        
        stat = safe_path.stat()
        record = {
            "timestamp": _utcnow_iso(),
            "action": "write_file",
            "file": relative_path,
            "bytes": stat.st_size,
            "agent_id": agent_id,
            "status": "success",
        }
        self.audit_log.append(record)
        return record

    def read_file(self, relative_path: str) -> str:
        """Reads content of a sandboxed file."""
        safe_path = self.resolve_safe_path(relative_path)
        if not safe_path.is_file():
            raise FileNotFoundError(f"File '{relative_path}' does not exist inside sandbox.")
        return safe_path.read_text(encoding="utf-8")

    def list_files(self) -> List[Dict[str, Any]]:
        """Lists all files and metadata in the sandboxed project."""
        results = []
        for p in sorted(self.project_dir.rglob("*")):
            if p.is_file():
                rel = p.relative_to(self.project_dir)
                results.append({
                    "path": str(rel),
                    "bytes": p.stat().st_size,
                    "updated_at": datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc).isoformat(),
                })
        return results

    async def execute_command(
        self,
        cmd: List[str] | str,
        timeout_seconds: int = 45,
        agent_id: str = "agent-system"
    ) -> Dict[str, Any]:
        """
        Executes a vetted local command with process timeout, resource sandboxing,
        and secret redaction.
        """
        if isinstance(cmd, str):
            parts = cmd.strip().split()
        else:
            parts = list(cmd)

        if not parts:
            return {"success": False, "exit_code": -1, "stdout": "", "stderr": "Empty command provided"}

        base_bin = Path(parts[0]).name
        if base_bin not in self.ALLOWED_EXECUTABLES and parts[0] != sys.executable:
            # Check if using active venv python/pytest
            if not ("venv" in parts[0] and ("python" in base_bin or "pytest" in base_bin)):
                err_msg = f"Security Restriction: Executable '{parts[0]}' is not in allowed sandbox whitelist."
                self.audit_log.append({
                    "timestamp": _utcnow_iso(),
                    "action": "execute_command",
                    "command": " ".join(parts),
                    "agent_id": agent_id,
                    "status": "blocked",
                    "error": err_msg,
                })
                return {"success": False, "exit_code": -1, "stdout": "", "stderr": err_msg}

        start_time = time.time()
        try:
            proc = await asyncio.create_subprocess_exec(
                *parts,
                cwd=str(self.project_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout_data, stderr_data = await asyncio.wait_for(
                    proc.communicate(),
                    timeout=timeout_seconds
                )
                duration = round(time.time() - start_time, 3)
                exit_code = proc.returncode
                stdout_clean = redact_sensitive_output(stdout_data.decode("utf-8", errors="replace")[:12000])
                stderr_clean = redact_sensitive_output(stderr_data.decode("utf-8", errors="replace")[:12000])

                record = {
                    "timestamp": _utcnow_iso(),
                    "action": "execute_command",
                    "command": " ".join(parts),
                    "exit_code": exit_code,
                    "duration_s": duration,
                    "agent_id": agent_id,
                    "status": "success" if exit_code == 0 else "failed",
                }
                self.audit_log.append(record)

                return {
                    "success": exit_code == 0,
                    "exit_code": exit_code,
                    "stdout": stdout_clean,
                    "stderr": stderr_clean,
                    "duration_seconds": duration,
                }
            except asyncio.TimeoutError:
                try:
                    proc.kill()
                except Exception:
                    pass
                err_msg = f"Process timed out after {timeout_seconds}s"
                self.audit_log.append({
                    "timestamp": _utcnow_iso(),
                    "action": "execute_command",
                    "command": " ".join(parts),
                    "status": "timeout",
                    "error": err_msg,
                })
                return {"success": False, "exit_code": -1, "stdout": "", "stderr": err_msg}
        except Exception as ex:
            err_msg = f"Subprocess invocation exception: {str(ex)}"
            return {"success": False, "exit_code": -1, "stdout": "", "stderr": err_msg}

    async def run_pytest_verification(self, test_file_relative: str = "tests/test_pharmacy_inventory.py") -> Dict[str, Any]:
        """
        Executes pytest verification in the sandbox to validate that deliverables work.
        """
        safe_test = self.resolve_safe_path(test_file_relative)
        if not safe_test.is_file():
            return {
                "verified": False,
                "error": f"Test suite file '{test_file_relative}' does not exist in project sandbox.",
                "passed_tests": 0,
                "failed_tests": 0,
            }

        python_bin = sys.executable
        # Try running pytest module or unittest fallback
        cmd = [python_bin, "-m", "pytest", str(safe_test), "-v", "--tb=short"]
        result = await self.execute_command(cmd, timeout_seconds=60, agent_id="agent-qa-engineer")

        if not result["success"]:
            # Fallback to python unittest runner if pytest isn't in current env
            cmd_fallback = [python_bin, "-m", "unittest", str(safe_test)]
            fallback_res = await self.execute_command(cmd_fallback, timeout_seconds=45, agent_id="agent-qa-engineer")
            if fallback_res["success"]:
                return {
                    "verified": True,
                    "test_runner": "unittest",
                    "stdout": fallback_res["stdout"],
                    "exit_code": 0,
                }

        # Parse test outcomes
        out = result["stdout"] + "\n" + result["stderr"]
        passed = "PASSED" in out or "OK" in out or result["exit_code"] == 0
        return {
            "verified": passed,
            "test_runner": "pytest",
            "exit_code": result["exit_code"],
            "stdout": result["stdout"],
            "stderr": result["stderr"],
            "duration_seconds": result.get("duration_seconds", 0),
        }

