import os
import hashlib
from pathlib import Path
from typing import Dict, Any, List, Optional
from backend.app.core.config import settings

class VerificationOutcome:
    def __init__(self, passed: bool, reason: str, details: Optional[Dict[str, Any]] = None):
        self.passed = passed
        self.reason = reason
        self.details = details or {}

class ResultVerifier:
    """
    Verifies that the executed task produced real, non-empty, and verifiable outputs
    before allowing the task to transition to COMPLETED.
    Enforces sandbox containment, path traversal security, and SHA-256 content hashing.
    """
    @staticmethod
    def verify_execution(
        artifacts: List[Dict[str, Any]],
        tool_results: List[Dict[str, Any]],
        final_summary: str,
    ) -> VerificationOutcome:
        artifact_hashes: Dict[str, str] = {}
        workspace_root = settings.WORKSPACE_ROOT.resolve()

        # 1. If any artifact was recorded as created, verify physical file on disk & boundaries
        for artifact in artifacts:
            filepath = artifact.get("filepath")
            abs_path = artifact.get("absolute_path")

            if abs_path:
                target = Path(abs_path).resolve()
            elif filepath:
                target = (settings.WORKSPACE_ROOT / filepath).resolve()
            else:
                return VerificationOutcome(
                    passed=False,
                    reason="Artifact record is missing both filepath and absolute_path."
                )

            # Security verification: Ensure target is within workspace boundary
            try:
                target.relative_to(workspace_root)
            except ValueError:
                return VerificationOutcome(
                    passed=False,
                    reason=f"Security violation: Artifact path '{filepath}' attempts path traversal outside workspace boundary."
                )

            # Prevent accessing restricted system / credential files
            forbidden_patterns = [".env", "id_rsa", "credentials.json", "provipagent-secret"]
            if any(p in target.name.lower() for p in forbidden_patterns):
                return VerificationOutcome(
                    passed=False,
                    reason=f"Security violation: Artifact path '{filepath}' attempts access to restricted system files."
                )

            if not target.exists():
                return VerificationOutcome(
                    passed=False,
                    reason=f"Claimed output file does not physically exist on disk: '{filepath}'"
                )

            if not target.is_file():
                return VerificationOutcome(
                    passed=False,
                    reason=f"Claimed output path is not a file: '{filepath}'"
                )

            if target.stat().st_size <= 0:
                return VerificationOutcome(
                    passed=False,
                    reason=f"Claimed output file exists but is empty (0 bytes): '{filepath}'"
                )

            # Compute cryptographic SHA-256 hash
            try:
                content_bytes = target.read_bytes()
                artifact_hashes[str(filepath or target.name)] = hashlib.sha256(content_bytes).hexdigest()
            except Exception as e:
                return VerificationOutcome(
                    passed=False,
                    reason=f"Failed to read artifact for cryptographic hashing: {e}"
                )

        # 2. Check if at least one tool executed successfully
        successful_tools = [t for t in tool_results if t.get("success") is True]
        if not successful_tools and not artifacts:
            return VerificationOutcome(
                passed=False,
                reason="No tools executed successfully to verify task completion."
            )

        # 3. Check that the final summary is meaningful and not empty
        if not final_summary or len(final_summary.strip()) < 10:
            return VerificationOutcome(
                passed=False,
                reason="Task completion summary is empty or too short."
            )

        return VerificationOutcome(
            passed=True,
            reason="All execution criteria and physical artifacts verified successfully.",
            details={
                "verified_artifacts_count": len(artifacts),
                "successful_tool_count": len(successful_tools),
                "artifact_hashes": artifact_hashes,
            }
        )

    @staticmethod
    def verify_deliverable_integrity(
        deliverable_dict: Dict[str, Any],
        workspace_root: Optional[Path] = None,
    ) -> VerificationOutcome:
        """
        Validates an existing StructuredDeliverable against disk, verifying that:
        1. Referenced artifact files still physically exist on disk.
        2. Computed SHA-256 digests match the original artifact_hashes recorded at creation.
        3. No path traversal attacks exist.
        """
        root = (workspace_root or settings.WORKSPACE_ROOT).resolve()
        artifact_paths = deliverable_dict.get("artifact_paths") or []
        recorded_hashes = deliverable_dict.get("artifact_hashes") or {}

        for p_str in artifact_paths:
            target = (root / p_str).resolve()
            try:
                target.relative_to(root)
            except ValueError:
                return VerificationOutcome(
                    passed=False,
                    reason=f"Security violation: Artifact path '{p_str}' escapes workspace boundary."
                )
            if not target.exists() or not target.is_file():
                return VerificationOutcome(
                    passed=False,
                    reason=f"Deliverable artifact missing from disk: '{p_str}'."
                )
            expected_hash = recorded_hashes.get(p_str)
            if expected_hash:
                actual_hash = hashlib.sha256(target.read_bytes()).hexdigest()
                if actual_hash != expected_hash:
                    return VerificationOutcome(
                        passed=False,
                        reason=f"Integrity check failed: Artifact '{p_str}' was tampered with (hash mismatch: expected {expected_hash}, got {actual_hash})."
                    )

        return VerificationOutcome(passed=True, reason="Deliverable integrity verified.")

result_verifier = ResultVerifier()
