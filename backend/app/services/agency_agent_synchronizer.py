import os
import glob
import hashlib
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Set
from sqlalchemy.orm import Session
from sqlalchemy import or_

from backend.app.models.specialist import SpecialistDefinitionModel, SpecialistVersionModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.services.agency_agent_importer import agency_agent_importer, OFFICIAL_REPO_URL

logger = logging.getLogger("agency.synchronizer")

class AgencyAgentSynchronizer:
    """
    Controlled upstream synchronization engine for agency-agents:
    - Scans upstream repository and calculates SHA-256 hashes
    - Compares against local specialist catalog
    - Categorizes into: NEW, UNCHANGED, UPDATED, REMOVED_UPSTREAM, INVALID, CONFLICT
    - Generates a synchronization preview diff without modifying the database
    - Applies approved updates with explicit SpecialistVersionModel bumps
    - Never silently overwrites or deletes local records
    """

    def __init__(self, source_dir: Optional[str] = None):
        self.default_source_dir = source_dir or os.path.abspath(
            os.path.join(os.getcwd(), "scratch", "agency-agents")
        )

    def preview_sync(
        self,
        db: Session,
        source_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generates a non-destructive dry-run comparison between upstream repository and local database.
        """
        repo_dir = source_dir or self.default_source_dir
        if not os.path.exists(repo_dir):
            raise FileNotFoundError(f"Upstream repository directory '{repo_dir}' does not exist.")

        # Read commit SHA if git exists
        commit_sha = None
        try:
            import subprocess
            res_sha = subprocess.run(
                ["git", "-C", repo_dir, "rev-parse", "HEAD"],
                capture_output=True,
                text=True,
            )
            if res_sha.returncode == 0:
                commit_sha = res_sha.stdout.strip()
        except Exception:
            pass

        # Discover all markdown files
        md_pattern = os.path.join(repo_dir, "**", "*.md")
        files = glob.glob(md_pattern, recursive=True)

        excluded = {"readme.md", "contributing.md", "contributing_zh-cn.md", "license.md", "security.md"}
        candidate_files = [f for f in files if os.path.basename(f).lower() not in excluded]

        # Map local specialists by slug and source_path
        local_specialists = db.query(SpecialistDefinitionModel).all()
        local_by_slug: Dict[str, SpecialistDefinitionModel] = {s.slug: s for s in local_specialists}
        local_by_path: Dict[str, SpecialistDefinitionModel] = {s.source_path: s for s in local_specialists}

        # Track active recruitments per specialist
        recruited_counts: Dict[str, int] = {}
        recruitment_records = db.query(RecruitmentRecordModel).all()
        for r in recruitment_records:
            recruited_counts[r.specialist_definition_id] = recruited_counts.get(r.specialist_definition_id, 0) + 1

        seen_local_ids: Set[str] = set()
        items: List[Dict[str, Any]] = []
        summary_counts = {
            "NEW": 0,
            "UNCHANGED": 0,
            "UPDATED": 0,
            "REMOVED_UPSTREAM": 0,
            "INVALID": 0,
            "CONFLICT": 0,
        }

        for file_path in sorted(candidate_files):
            rel_path = os.path.relpath(file_path, repo_dir)
            parts = rel_path.split(os.sep)
            if len(parts) < 2:
                continue

            division = parts[0].lower()
            try:
                parsed = agency_agent_importer.parse_specialist_file(
                    file_path=file_path,
                    division=division,
                    repo_dir=repo_dir,
                    commit_sha=commit_sha,
                )
            except Exception as e:
                items.append({
                    "slug": os.path.splitext(os.path.basename(file_path))[0],
                    "name": os.path.basename(file_path),
                    "division": division,
                    "source_path": rel_path,
                    "status": "INVALID",
                    "error": str(e),
                })
                summary_counts["INVALID"] += 1
                continue

            slug = parsed["slug"]
            upstream_hash = parsed["content_hash"]
            local_spec = local_by_slug.get(slug) or local_by_path.get(rel_path)

            if not local_spec:
                # Upstream file does not exist locally
                status = "NEW"
                summary_counts["NEW"] += 1
                items.append({
                    "slug": slug,
                    "name": parsed["name"],
                    "division": parsed["division"],
                    "department": parsed["department"],
                    "source_path": rel_path,
                    "upstream_hash": upstream_hash,
                    "local_hash": None,
                    "local_version": None,
                    "status": status,
                    "active_recruitments": 0,
                    "change_summary": "New specialist added upstream",
                })
            else:
                seen_local_ids.add(local_spec.id)
                active_recs = recruited_counts.get(local_spec.id, 0)

                if local_spec.content_hash == upstream_hash:
                    status = "UNCHANGED"
                    summary_counts["UNCHANGED"] += 1
                else:
                    if active_recs > 0:
                        status = "CONFLICT"
                        summary_counts["CONFLICT"] += 1
                        change_summary = f"Content modified upstream; specialist is actively recruited in {active_recs} organization(s). Requires manual approval to avoid altering active employee personas."
                    else:
                        status = "UPDATED"
                        summary_counts["UPDATED"] += 1
                        change_summary = "Content modified upstream; safe to update."

                items.append({
                    "specialist_id": local_spec.id,
                    "slug": local_spec.slug or slug,
                    "name": parsed["name"],
                    "division": parsed["division"],
                    "department": parsed["department"],
                    "source_path": rel_path,
                    "upstream_hash": upstream_hash,
                    "local_hash": local_spec.content_hash,
                    "local_version": local_spec.version,
                    "status": status,
                    "active_recruitments": active_recs,
                    "change_summary": "Hash match (identical)" if status == "UNCHANGED" else change_summary,
                })

        # Check for specialists that exist locally but were removed upstream
        for local_spec in local_specialists:
            if local_spec.id not in seen_local_ids:
                status = "REMOVED_UPSTREAM"
                summary_counts["REMOVED_UPSTREAM"] += 1
                items.append({
                    "specialist_id": local_spec.id,
                    "slug": local_spec.slug,
                    "name": local_spec.name,
                    "division": local_spec.division,
                    "department": local_spec.department,
                    "source_path": local_spec.source_path,
                    "upstream_hash": None,
                    "local_hash": local_spec.content_hash,
                    "local_version": local_spec.version,
                    "status": status,
                    "active_recruitments": recruited_counts.get(local_spec.id, 0),
                    "change_summary": "Specialist file no longer exists in upstream repository. Local record preserved.",
                })

        return {
            "upstream_repo": repo_dir,
            "commit_sha": commit_sha,
            "scanned_upstream_files": len(candidate_files),
            "summary": summary_counts,
            "items": items,
        }

    def apply_sync(
        self,
        db: Session,
        approved_slugs: Optional[List[str]] = None,
        source_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Applies approved upstream changes:
        - Inserts NEW specialists with version 1
        - Bumps version and archives history for UPDATED specialists
        - Flags REMOVED_UPSTREAM specialists without deleting them
        """
        preview = self.preview_sync(db, source_dir=source_dir)
        approved_set = set(approved_slugs) if approved_slugs is not None else None

        applied_counts = {
            "created": 0,
            "updated": 0,
            "flagged_removed": 0,
            "skipped": 0,
        }

        repo_dir = preview["upstream_repo"]
        commit_sha = preview["commit_sha"]

        for item in preview["items"]:
            slug = item["slug"]
            status = item["status"]

            if approved_set is not None and slug not in approved_set:
                applied_counts["skipped"] += 1
                continue

            if status == "NEW":
                # Parse full file
                file_path = os.path.join(repo_dir, item["source_path"])
                parsed = agency_agent_importer.parse_specialist_file(
                    file_path=file_path,
                    division=item["division"],
                    repo_dir=repo_dir,
                    commit_sha=commit_sha,
                )
                spec = SpecialistDefinitionModel(
                    slug=parsed["slug"],
                    name=parsed["name"],
                    division=parsed["division"],
                    department=parsed["department"],
                    role=parsed["role"],
                    description=parsed["description"],
                    color=parsed["color"],
                    emoji=parsed["emoji"],
                    vibe=parsed["vibe"],
                    system_instructions=parsed["system_instructions"],
                    identity_and_memory=parsed["identity_and_memory"],
                    core_mission=parsed["core_mission"],
                    critical_rules=parsed["critical_rules"],
                    workflows=parsed["workflows"],
                    deliverables=parsed["deliverables"],
                    success_metrics=parsed["success_metrics"],
                    capabilities=parsed["capabilities"],
                    skills=parsed["skills"],
                    declared_tools=parsed["declared_tools"],
                    assigned_tools=parsed["assigned_tools"],
                    permission_level=parsed["permission_level"],
                    source_repo=OFFICIAL_REPO_URL,
                    source_path=parsed["source_path"],
                    source_commit_sha=commit_sha,
                    content_hash=parsed["content_hash"],
                    raw_content=parsed["raw_content"],
                    raw_frontmatter=parsed["raw_frontmatter"],
                    validation_status=parsed["validation_status"],
                    validation_errors=parsed["validation_errors"],
                    lifecycle_state="AVAILABLE",
                    version=1,
                    imported_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                db.add(spec)
                db.flush()

                snapshot = {
                    "name": parsed.get("name"),
                    "role": parsed.get("role"),
                    "division": parsed.get("division"),
                    "department": parsed.get("department"),
                    "assigned_tools": parsed.get("assigned_tools", []),
                    "declared_tools": parsed.get("declared_tools", []),
                    "permission_level": parsed.get("permission_level", 0),
                    "critical_rules": parsed.get("critical_rules", ""),
                    "system_instructions": parsed.get("system_instructions", ""),
                    "core_mission": parsed.get("core_mission", ""),
                    "workflows": parsed.get("workflows", ""),
                    "deliverables": parsed.get("deliverables", ""),
                    "success_metrics": parsed.get("success_metrics", ""),
                    "capabilities": parsed.get("capabilities", []),
                    "skills": parsed.get("skills", []),
                }

                # Create initial version record
                ver = SpecialistVersionModel(
                    specialist_id=spec.id,
                    version=1,
                    source_commit_sha=commit_sha,
                    content_hash=spec.content_hash,
                    raw_content=spec.raw_content,
                    parsed_metadata=snapshot,
                    change_summary="Initial synchronization from upstream",
                    created_at=datetime.utcnow(),
                )
                db.add(ver)
                applied_counts["created"] += 1

            elif status in ("UPDATED", "CONFLICT"):
                spec_id = item.get("specialist_id")
                local_spec = None
                if spec_id:
                    local_spec = db.query(SpecialistDefinitionModel).filter(SpecialistDefinitionModel.id == spec_id).first()
                if not local_spec:
                    local_spec = (
                        db.query(SpecialistDefinitionModel)
                        .filter(SpecialistDefinitionModel.slug == slug)
                        .first()
                    )
                if not local_spec:
                    continue

                file_path = os.path.join(repo_dir, item["source_path"])
                parsed = agency_agent_importer.parse_specialist_file(
                    file_path=file_path,
                    division=item["division"],
                    repo_dir=repo_dir,
                    commit_sha=commit_sha,
                )

                # Bump version and preserve in specialist_versions
                new_version = local_spec.version + 1
                local_spec.version = new_version
                local_spec.name = parsed["name"]
                local_spec.role = parsed["role"]
                local_spec.description = parsed["description"]
                local_spec.system_instructions = parsed["system_instructions"]
                local_spec.identity_and_memory = parsed["identity_and_memory"]
                local_spec.core_mission = parsed["core_mission"]
                local_spec.critical_rules = parsed["critical_rules"]
                local_spec.workflows = parsed["workflows"]
                local_spec.deliverables = parsed["deliverables"]
                local_spec.success_metrics = parsed["success_metrics"]
                local_spec.capabilities = parsed["capabilities"]
                local_spec.skills = parsed["skills"]
                local_spec.declared_tools = parsed["declared_tools"]
                local_spec.assigned_tools = parsed["assigned_tools"]
                local_spec.permission_level = parsed["permission_level"]
                local_spec.content_hash = parsed["content_hash"]
                local_spec.raw_content = parsed["raw_content"]
                local_spec.raw_frontmatter = parsed["raw_frontmatter"]
                local_spec.source_commit_sha = commit_sha
                local_spec.updated_at = datetime.utcnow()

                update_snapshot = {
                    "name": parsed.get("name"),
                    "role": parsed.get("role"),
                    "division": parsed.get("division"),
                    "department": parsed.get("department"),
                    "assigned_tools": parsed.get("assigned_tools", []),
                    "declared_tools": parsed.get("declared_tools", []),
                    "permission_level": parsed.get("permission_level", 0),
                    "critical_rules": parsed.get("critical_rules", ""),
                    "system_instructions": parsed.get("system_instructions", ""),
                    "core_mission": parsed.get("core_mission", ""),
                    "workflows": parsed.get("workflows", ""),
                    "deliverables": parsed.get("deliverables", ""),
                    "success_metrics": parsed.get("success_metrics", ""),
                    "capabilities": parsed.get("capabilities", []),
                    "skills": parsed.get("skills", []),
                }

                ver = SpecialistVersionModel(
                    specialist_id=local_spec.id,
                    version=new_version,
                    source_commit_sha=commit_sha,
                    content_hash=parsed["content_hash"],
                    raw_content=parsed["raw_content"],
                    parsed_metadata=update_snapshot,
                    change_summary=f"Upstream update synchronized (v{new_version})",
                    created_at=datetime.utcnow(),
                )
                db.add(ver)
                applied_counts["updated"] += 1

            elif status == "REMOVED_UPSTREAM":
                local_spec = (
                    db.query(SpecialistDefinitionModel)
                    .filter(SpecialistDefinitionModel.slug == slug)
                    .first()
                )
                if local_spec:
                    local_spec.validation_status = "WARNING"
                    local_spec.validation_errors = (local_spec.validation_errors or []) + [
                        "Removed from upstream repository; preserved in local catalog."
                    ]
                    local_spec.updated_at = datetime.utcnow()
                    applied_counts["flagged_removed"] += 1

        db.commit()
        return {
            "success": True,
            "applied": applied_counts,
            "commit_sha": commit_sha,
        }

agency_agent_synchronizer = AgencyAgentSynchronizer()
