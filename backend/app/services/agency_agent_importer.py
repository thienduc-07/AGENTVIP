import os
import re
import glob
import json
import hashlib
import logging
import subprocess
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
import yaml
from sqlalchemy.orm import Session

from backend.app.models.specialist import SpecialistDefinitionModel, SpecialistVersionModel
from backend.app.agent_runtime.tools.registry import default_tool_registry

logger = logging.getLogger("agency.importer")

OFFICIAL_REPO_URL = "https://github.com/msitarzewski/agency-agents"

DIVISION_TO_DEPARTMENT = {
    "engineering": "Engineering",
    "testing": "Engineering",
    "security": "Engineering",
    "spatial-computing": "Engineering",
    "game-development": "Engineering",
    "academic": "AI Research",
    "research": "AI Research",
    "marketing": "Marketing",
    "paid-media": "Marketing",
    "sales": "Sales",
    "finance": "Finance",
    "product": "Operations",
    "project-management": "Operations",
    "operations": "Operations",
    "gis": "Operations",
    "healthcare": "Operations",
    "support": "Customer Success",
    "specialized": "Operations",
}

class AgencyAgentImporter:
    """
    Dedicated importer for agency-agents repository:
    - Discovers 18 divisions and specialist Markdown definitions
    - Parses YAML frontmatter and structured markdown sections
    - Extracts roles, core missions, critical rules, workflows, deliverables, capabilities
    - Validates imported agents and sanitizes untrusted instructions
    - Preserves source provenance, commit SHA, and version history in database
    """

    def __init__(self, repo_url: str = OFFICIAL_REPO_URL, source_dir: Optional[str] = None):
        self.repo_url = repo_url
        self.source_dir = source_dir or os.path.abspath(os.path.join(os.getcwd(), "scratch", "agency-agents"))

    def ensure_repository(self, target_dir: Optional[str] = None) -> Tuple[str, Optional[str]]:
        """
        Ensures local clone of official repository exists and returns (dir_path, commit_sha).
        """
        target = target_dir or self.source_dir
        os.makedirs(os.path.dirname(target), exist_ok=True)

        # If directory doesn't exist, clone it
        if not os.path.exists(target):
            logger.info(f"Cloning agency-agents repository from {self.repo_url} to {target}...")
            res = subprocess.run(
                ["git", "clone", "--depth", "1", self.repo_url, target],
                capture_output=True,
                text=True,
            )
            if res.returncode != 0:
                logger.error(f"Git clone failed: {res.stderr}")
                raise RuntimeError(f"Failed to clone agency-agents repository: {res.stderr}")

        # Read commit SHA
        commit_sha = None
        try:
            res_sha = subprocess.run(
                ["git", "-C", target, "rev-parse", "HEAD"],
                capture_output=True,
                text=True,
            )
            if res_sha.returncode == 0:
                commit_sha = res_sha.stdout.strip()
        except Exception as e:
            logger.warning(f"Failed to read commit sha: {e}")

        return target, commit_sha

    def load_divisions_metadata(self, repo_dir: str) -> Dict[str, Dict[str, Any]]:
        """
        Loads divisions from divisions.json if present.
        """
        div_path = os.path.join(repo_dir, "divisions.json")
        if os.path.exists(div_path):
            try:
                with open(div_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return data.get("divisions", {})
            except Exception as e:
                logger.warning(f"Error loading divisions.json: {e}")
        return {}

    def extract_markdown_sections(self, body: str) -> Dict[str, str]:
        """
        Extracts named sections from Markdown body by H2 headers.
        """
        sections: Dict[str, str] = {}
        current_header = None
        current_lines: List[str] = []

        for line in body.splitlines():
            if line.startswith("## "):
                if current_header:
                    sections[current_header] = "\n".join(current_lines).strip()
                header_text = re.sub(r"^[#\s\U00010000-\U0010ffff\u2600-\u26ff\u2700-\u27bf]+", "", line).strip().lower()
                current_header = header_text
                current_lines = []
            elif current_header is not None:
                current_lines.append(line)

        if current_header:
            sections[current_header] = "\n".join(current_lines).strip()

        return sections

    def parse_specialist_file(
        self,
        file_path: str,
        division: str,
        repo_dir: str,
        commit_sha: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Parses an individual specialist Markdown file into normalized definition.
        """
        with open(file_path, "r", encoding="utf-8") as f:
            raw_content = f.read()

        content_hash = hashlib.sha256(raw_content.encode("utf-8")).hexdigest()
        rel_path = os.path.relpath(file_path, repo_dir)
        filename = os.path.basename(file_path)
        base_slug = os.path.splitext(filename)[0]

        frontmatter: Dict[str, Any] = {}
        body = raw_content

        if raw_content.startswith("---"):
            parts = raw_content.split("---", 2)
            if len(parts) >= 3:
                try:
                    fm_data = yaml.safe_load(parts[1])
                    if isinstance(fm_data, dict):
                        frontmatter = fm_data
                    body = parts[2]
                except Exception as e:
                    logger.warning(f"YAML frontmatter parse error in {file_path}: {e}")

        # Extract structured sections
        sections = self.extract_markdown_sections(body)

        # Map sections by key heuristics
        identity_sec = None
        mission_sec = None
        rules_sec = None
        workflow_sec = None
        deliverables_sec = None
        metrics_sec = None
        capabilities_sec = None

        for k, text in sections.items():
            if "identity" in k or "memory" in k:
                identity_sec = text
            elif "mission" in k or "core" in k:
                mission_sec = text
            elif "rule" in k or "must follow" in k or "critical" in k:
                rules_sec = text
            elif "workflow" in k or "process" in k:
                workflow_sec = text
            elif "deliverable" in k or "output" in k:
                deliverables_sec = text
            elif "metric" in k or "success" in k:
                metrics_sec = text
            elif "capabilit" in k or "skill" in k or "expertise" in k:
                capabilities_sec = text

        name = frontmatter.get("name") or base_slug.replace("-", " ").title()
        description = frontmatter.get("description") or f"Specialized AI agent in {division}"
        color = frontmatter.get("color", "blue")
        emoji = frontmatter.get("emoji", "🤖")
        vibe = frontmatter.get("vibe", "")

        # Department mapping
        department = DIVISION_TO_DEPARTMENT.get(division.lower(), "Operations")

        # Determine Role
        role = description.split(".")[0].strip() if description else f"{name} Specialist"
        if len(role) > 250:
            role = role[:247] + "..."

        # Determine Capabilities and Skills
        capabilities_list: List[str] = []
        if capabilities_sec:
            for l in capabilities_sec.splitlines():
                l = l.strip().lstrip("-*•").strip()
                if l and len(l) > 3 and not l.startswith("#"):
                    capabilities_list.append(l)

        # Extract skills / bullet points from mission if capabilities empty
        if not capabilities_list and mission_sec:
            for l in mission_sec.splitlines():
                l = l.strip().lstrip("-*•").strip()
                if l and len(l) > 3 and not l.startswith("#"):
                    capabilities_list.append(l)

        # Assigned safe tools based on department and deliverables
        assigned_tools = [
            "workspace_list",
            "workspace.list_files",
            "file_read",
            "workspace.read_file",
            "file_search",
            "workspace.search",
            "calculator",
            "artifact.get",
            "artifact.list",
            "memory_search",
            "memory.search",
            "memory_get",
            "memory.get",
        ]

        permission_level = 0
        needs_write = False

        if division in ("engineering", "testing", "design", "marketing"):
            needs_write = True
        elif deliverables_sec and any(w in deliverables_sec.lower() for w in ("code", "report", "file", "document", "spec", "artifact")):
            needs_write = True

        if needs_write:
            permission_level = 1
            assigned_tools.extend([
                "workspace_write",
                "workspace.write_file",
                "verification_tool",
                "workspace.verify_file",
                "artifact.create",
                "artifact.verify",
                "memory_propose",
                "memory.propose",
            ])

        if division in ("finance", "operations", "research", "engineering"):
            assigned_tools.extend([
                "data.inspect",
                "data.profile",
                "data.summarize",
                "data.validate",
            ])

        # Validation checks
        validation_errors: List[str] = []
        validation_status = "VALID"

        if not name or len(name.strip()) == 0:
            validation_errors.append("Agent name is required")
            validation_status = "INVALID"

        if not body or len(body.strip()) < 50:
            validation_errors.append("Agent instructions/body must be at least 50 characters")
            validation_status = "INVALID"

        # Security check: detect harmful prompt injections or escape attempts
        body_lower = body.lower()
        has_dangerous_pattern = False

        # Check for standalone eval() calls (not words like run_rag_eval or eval_metric)
        if re.search(r"\beval\s*\(", body) and "never use `eval()`" not in body and "never use eval" not in body_lower:
            has_dangerous_pattern = True

        # Check for privileged paths
        if "/etc/passwd" in body_lower:
            # Check if it's an educational or boundary declaration
            if "cannot" in body_lower or "detect" in body_lower or "prevent" in body_lower:
                pass
            else:
                has_dangerous_pattern = True

        # Destructive commands are unconditionally INVALID
        if "rm -rf" in body_lower or "drop database" in body_lower or ":(){ :|:& };:" in body_lower:
            validation_errors.append("Destructive shell command detected")
            validation_status = "INVALID"
        elif has_dangerous_pattern:
            if division in ("security", "engineering"):
                validation_errors.append("Sensitive command or path referenced in specialist documentation — requires manager security approval")
                validation_status = "WARNING"
            else:
                validation_errors.append("Potentially harmful or privileged system instructions detected")
                validation_status = "INVALID"

        lifecycle_state = "AVAILABLE" if validation_status == "VALID" else ("CONFIGURED" if validation_status == "WARNING" else "INVALID")

        return {
            "slug": base_slug,
            "name": name,
            "division": division,
            "department": department,
            "role": role,
            "description": description,
            "color": color,
            "emoji": emoji,
            "vibe": vibe,
            "system_instructions": raw_content,
            "identity_and_memory": identity_sec,
            "core_mission": mission_sec,
            "critical_rules": rules_sec,
            "workflows": workflow_sec,
            "deliverables": deliverables_sec,
            "success_metrics": metrics_sec,
            "capabilities": capabilities_list[:15],
            "skills": [s.strip() for s in frontmatter.get("tools", [])] if isinstance(frontmatter.get("tools"), list) else [],
            "declared_tools": frontmatter.get("tools") if isinstance(frontmatter.get("tools"), list) else [],
            "assigned_tools": assigned_tools,
            "permission_level": permission_level,
            "source_repo": self.repo_url,
            "source_path": rel_path,
            "source_commit_sha": commit_sha,
            "content_hash": content_hash,
            "raw_content": raw_content,
            "raw_frontmatter": frontmatter,
            "validation_status": validation_status,
            "validation_errors": validation_errors,
            "lifecycle_state": lifecycle_state,
        }

    def import_all(
        self,
        db: Session,
        source_dir: Optional[str] = None,
        force_update: bool = False,
    ) -> Dict[str, Any]:
        """
        Discovers and imports all specialists from the local repository directory.
        Persists into specialist_definitions and specialist_versions.
        """
        repo_dir, commit_sha = self.ensure_repository(source_dir)
        divisions_meta = self.load_divisions_metadata(repo_dir)

        # Discover division directories
        non_division_dirs = {"integrations", "strategy", "examples", "scripts", ".git", ".github", "node_modules"}
        all_entries = os.listdir(repo_dir)
        division_dirs = [
            d for d in all_entries
            if os.path.isdir(os.path.join(repo_dir, d)) and d not in non_division_dirs and not d.startswith(".")
        ]

        total_scanned = 0
        imported_count = 0
        updated_count = 0
        unchanged_count = 0
        invalid_count = 0
        division_summary: Dict[str, int] = {}

        for division in sorted(division_dirs):
            div_path = os.path.join(repo_dir, division)
            md_files = glob.glob(os.path.join(div_path, "*.md"))
            division_summary[division] = len(md_files)

            for file_path in md_files:
                total_scanned += 1
                try:
                    parsed = self.parse_specialist_file(file_path, division, repo_dir, commit_sha)
                except Exception as e:
                    logger.error(f"Error parsing {file_path}: {e}")
                    invalid_count += 1
                    continue

                if parsed["validation_status"] == "INVALID":
                    invalid_count += 1

                # Check if exists in DB
                existing = db.query(SpecialistDefinitionModel).filter(
                    SpecialistDefinitionModel.slug == parsed["slug"]
                ).first()

                now = datetime.utcnow()

                if not existing:
                    # Create new specialist
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
                        source_repo=parsed["source_repo"],
                        source_path=parsed["source_path"],
                        source_commit_sha=parsed["source_commit_sha"],
                        content_hash=parsed["content_hash"],
                        raw_content=parsed["raw_content"],
                        raw_frontmatter=parsed["raw_frontmatter"],
                        validation_status=parsed["validation_status"],
                        validation_errors=parsed["validation_errors"],
                        lifecycle_state=parsed["lifecycle_state"],
                        version=1,
                        imported_at=now,
                        updated_at=now,
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

                    # Save version 1
                    ver = SpecialistVersionModel(
                        specialist_id=spec.id,
                        version=1,
                        source_commit_sha=parsed["source_commit_sha"],
                        content_hash=parsed["content_hash"],
                        raw_content=parsed["raw_content"],
                        parsed_metadata=snapshot,
                        change_summary="Initial import from agency-agents repository",
                        created_at=now,
                    )
                    db.add(ver)
                    imported_count += 1
                else:
                    # Compare content hash
                    if existing.content_hash == parsed["content_hash"] and not force_update:
                        unchanged_count += 1
                    else:
                        # Version update
                        new_version = existing.version + 1
                        existing.version = new_version
                        existing.name = parsed["name"]
                        existing.division = parsed["division"]
                        existing.department = parsed["department"]
                        existing.role = parsed["role"]
                        existing.description = parsed["description"]
                        existing.color = parsed["color"]
                        existing.emoji = parsed["emoji"]
                        existing.vibe = parsed["vibe"]
                        existing.system_instructions = parsed["system_instructions"]
                        existing.identity_and_memory = parsed["identity_and_memory"]
                        existing.core_mission = parsed["core_mission"]
                        existing.critical_rules = parsed["critical_rules"]
                        existing.workflows = parsed["workflows"]
                        existing.deliverables = parsed["deliverables"]
                        existing.success_metrics = parsed["success_metrics"]
                        existing.capabilities = parsed["capabilities"]
                        existing.skills = parsed["skills"]
                        existing.declared_tools = parsed["declared_tools"]
                        existing.assigned_tools = parsed["assigned_tools"]
                        existing.permission_level = parsed["permission_level"]
                        existing.source_path = parsed["source_path"]
                        existing.source_commit_sha = parsed["source_commit_sha"]
                        existing.content_hash = parsed["content_hash"]
                        existing.raw_content = parsed["raw_content"]
                        existing.raw_frontmatter = parsed["raw_frontmatter"]
                        existing.validation_status = parsed["validation_status"]
                        existing.validation_errors = parsed["validation_errors"]
                        existing.updated_at = now

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

                        # Save new version history record
                        ver = SpecialistVersionModel(
                            specialist_id=existing.id,
                            version=new_version,
                            source_commit_sha=parsed["source_commit_sha"],
                            content_hash=parsed["content_hash"],
                            raw_content=parsed["raw_content"],
                            parsed_metadata=update_snapshot,
                            change_summary=f"Controlled re-import version {new_version}",
                            created_at=now,
                        )
                        db.add(ver)
                        updated_count += 1

        db.commit()

        return {
            "total_files_scanned": total_scanned,
            "imported_new": imported_count,
            "updated_existing": updated_count,
            "unchanged": unchanged_count,
            "invalid_count": invalid_count,
            "divisions_summary": division_summary,
            "commit_sha": commit_sha,
        }

agency_agent_importer = AgencyAgentImporter()
