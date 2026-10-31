import hashlib
import logging
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.app.models.specialist import SpecialistDefinitionModel, SpecialistVersionModel

logger = logging.getLogger("agency.specialist_integrity")

VALID_DIVISIONS = {
    "engineering",
    "specialized",
    "marketing",
    "gis",
    "security",
    "design",
    "sales",
    "testing",
    "paid-media",
    "project-management",
    "academic",
    "game-development",
    "product",
    "spatial-computing",
    "support",
    "finance",
    "healthcare",
    "research",
}

class SpecialistIntegrityChecker:
    """
    Audits and validates the specialist catalog integrity:
    - Stable IDs and unique slugs
    - Division validity and mapping
    - Source provenance and hash matching
    - Version history consistency
    - Non-destructive issue flagging (no silent deletions)
    """

    def audit_catalog(self, db: Session) -> Dict[str, Any]:
        specialists = db.query(SpecialistDefinitionModel).all()
        total_count = len(specialists)

        valid_count = 0
        warning_count = 0
        invalid_count = 0
        issues: List[Dict[str, Any]] = []

        seen_slugs: Dict[str, str] = {}
        seen_ids: Dict[str, str] = {}

        for spec in specialists:
            spec_issues: List[str] = []
            severity = "VALID"

            # 1. Identity & Slug Uniqueness Check
            if not spec.id:
                spec_issues.append("Missing primary key ID")
                severity = "INVALID"
            elif spec.id in seen_ids:
                spec_issues.append(f"Duplicate specialist ID detected: {spec.id}")
                severity = "INVALID"
            else:
                seen_ids[spec.id] = spec.slug

            if not spec.slug:
                spec_issues.append("Missing specialist slug")
                severity = "INVALID"
            elif spec.slug in seen_slugs:
                spec_issues.append(f"Duplicate slug detected: '{spec.slug}' (shared with ID {seen_slugs[spec.slug]})")
                severity = "INVALID"
            else:
                seen_slugs[spec.slug] = spec.id

            # 2. Division & Department Validation
            if not spec.division or spec.division.lower() not in VALID_DIVISIONS:
                spec_issues.append(f"Unknown or non-standard division: '{spec.division}'")
                if severity != "INVALID":
                    severity = "WARNING"

            if not spec.department:
                spec_issues.append("Missing corporate department assignment")
                if severity != "INVALID":
                    severity = "WARNING"

            # 3. Required Metadata
            if not spec.name or not spec.name.strip():
                spec_issues.append("Missing or empty specialist display name")
                severity = "INVALID"

            if not spec.role or not spec.role.strip():
                spec_issues.append("Missing role definition")
                severity = "INVALID"

            if not spec.system_instructions or len(spec.system_instructions.strip()) < 20:
                spec_issues.append("Empty or truncated system instructions (< 20 chars)")
                severity = "INVALID"

            # 4. Source Metadata & Provenance
            if not spec.source_path:
                spec_issues.append("Missing source file path")
                if severity != "INVALID":
                    severity = "WARNING"

            if not spec.content_hash:
                spec_issues.append("Missing content SHA-256 hash")
                severity = "INVALID"
            elif spec.raw_content:
                expected_hash = hashlib.sha256(spec.raw_content.encode("utf-8")).hexdigest()
                if spec.content_hash != expected_hash:
                    spec_issues.append("Content hash mismatch against stored raw_content")
                    if severity != "INVALID":
                        severity = "WARNING"

            # 5. Version Consistency
            version_count = (
                db.query(func.count(SpecialistVersionModel.id))
                .filter(SpecialistVersionModel.specialist_id == spec.id)
                .scalar()
                or 0
            )
            if version_count == 0:
                spec_issues.append("No version history records found in specialist_versions")
                if severity != "INVALID":
                    severity = "WARNING"

            # Categorize
            if severity == "INVALID":
                invalid_count += 1
            elif severity == "WARNING":
                warning_count += 1
            else:
                valid_count += 1

            if spec_issues:
                issues.append({
                    "specialist_id": spec.id,
                    "slug": spec.slug,
                    "name": spec.name,
                    "division": spec.division,
                    "severity": severity,
                    "errors": spec_issues,
                })

        return {
            "total_specialists": total_count,
            "valid_count": valid_count,
            "warning_count": warning_count,
            "invalid_count": invalid_count,
            "health_score": round((valid_count / total_count * 100.0), 2) if total_count > 0 else 0.0,
            "issues": issues,
        }

specialist_integrity_checker = SpecialistIntegrityChecker()
