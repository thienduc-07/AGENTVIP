"""core_security_and_tenant_isolation

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-10-31 22:15:00.000000

"""
from typing import Sequence, Union
import json
import re
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _extract_metadata_from_raw(raw_content: str) -> dict:
    """Helper to extract structured metadata snapshot from specialist version markdown."""
    metadata = {}
    if not raw_content:
        return metadata

    # Parse YAML frontmatter if present
    if raw_content.startswith("---"):
        parts = raw_content.split("---", 2)
        if len(parts) >= 3:
            fm_text = parts[1]
            for line in fm_text.splitlines():
                if ":" in line:
                    key, val = line.split(":", 1)
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key in ("name", "role", "department", "division", "description", "color", "emoji", "vibe"):
                        metadata[key] = val
                    elif key == "permission_level":
                        try:
                            metadata[key] = int(val)
                        except ValueError:
                            metadata[key] = 0

    # Extract Mission & Critical Rules from body
    mission_match = re.search(r"##\s*(?:Core Mission|Mission|Overview)\s*\n(.*?)(?=\n##|\Z)", raw_content, re.DOTALL | re.IGNORECASE)
    if mission_match:
        metadata["core_mission"] = mission_match.group(1).strip()

    rules_match = re.search(r"##\s*(?:Critical Rules|Rules|Operational Rules)\s*\n(.*?)(?=\n##|\Z)", raw_content, re.DOTALL | re.IGNORECASE)
    if rules_match:
        metadata["critical_rules"] = rules_match.group(1).strip()

    # Default tool whitelists based on department / permission level
    perm = metadata.get("permission_level", 0)
    dept = metadata.get("department", "Operations")
    if perm >= 2:
        tools = ["workspace_list", "file_read", "file_search", "workspace_write", "calculator", "verification_tool"]
    elif perm == 1:
        tools = ["workspace_list", "file_read", "file_search", "workspace_write", "verification_tool"]
    else:
        tools = ["workspace_list", "file_read", "file_search", "calculator"]

    metadata["assigned_tools"] = tools
    metadata["declared_tools"] = tools
    return metadata


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # 1. Add token_version to users table
    if 'users' in tables:
        user_cols = [c['name'] for c in inspector.get_columns('users')]
        if 'token_version' not in user_cols:
            with op.batch_alter_table('users') as batch_op:
                batch_op.add_column(sa.Column('token_version', sa.Integer(), server_default='1', nullable=False))

    # 2. Add is_legacy_unpinned to recruitment_records table
    if 'recruitment_records' in tables:
        rec_cols = [c['name'] for c in inspector.get_columns('recruitment_records')]
        if 'is_legacy_unpinned' not in rec_cols:
            with op.batch_alter_table('recruitment_records') as batch_op:
                batch_op.add_column(sa.Column('is_legacy_unpinned', sa.Boolean(), server_default='0', nullable=False))

    # 3. Add parsed_metadata to specialist_versions table
    if 'specialist_versions' in tables:
        ver_cols = [c['name'] for c in inspector.get_columns('specialist_versions')]
        if 'parsed_metadata' not in ver_cols:
            with op.batch_alter_table('specialist_versions') as batch_op:
                batch_op.add_column(sa.Column('parsed_metadata', sa.JSON(), nullable=True))

    # 4. Add organization_id to tasks table
    if 'tasks' in tables:
        task_cols = [c['name'] for c in inspector.get_columns('tasks')]
        task_indexes = [idx['name'] for idx in inspector.get_indexes('tasks')]
        with op.batch_alter_table('tasks') as batch_op:
            if 'organization_id' not in task_cols:
                batch_op.add_column(sa.Column('organization_id', sa.String(length=64), server_default='org_default_company', nullable=False))
                batch_op.create_foreign_key('fk_tasks_organization_id', 'organizations', ['organization_id'], ['id'], ondelete='CASCADE')
                batch_op.create_index('ix_tasks_organization_id', ['organization_id'])
            if 'ix_tasks_org_status' not in task_indexes:
                batch_op.create_index('ix_tasks_org_status', ['organization_id', 'status'])

    # 5. Data backfill:
    # 5.1 Backfill tasks.organization_id from recruitment_records where assigned_agent_id matches
    try:
        conn.execute(sa.text("""
            UPDATE tasks
            SET organization_id = (
                SELECT organization_id FROM recruitment_records
                WHERE recruitment_records.agent_id = tasks.assigned_agent_id
            )
            WHERE EXISTS (
                SELECT 1 FROM recruitment_records
                WHERE recruitment_records.agent_id = tasks.assigned_agent_id
            );
        """))
    except Exception:
        pass

    # 5.2 Flag legacy unpinned recruitment records
    try:
        conn.execute(sa.text("""
            UPDATE recruitment_records
            SET is_legacy_unpinned = 1
            WHERE specialist_version_id IS NULL;
        """))
    except Exception:
        pass

    # 5.3 Backfill specialist_versions.parsed_metadata
    try:
        rows = conn.execute(sa.text("SELECT id, raw_content FROM specialist_versions WHERE parsed_metadata IS NULL;")).fetchall()
        for r_id, r_content in rows:
            meta = _extract_metadata_from_raw(r_content or "")
            meta_json = json.dumps(meta)
            conn.execute(
                sa.text("UPDATE specialist_versions SET parsed_metadata = :meta WHERE id = :vid"),
                {"meta": meta_json, "vid": r_id}
            )
    except Exception:
        pass


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # 1. Revert tasks table changes
    if 'tasks' in tables:
        task_indexes = [idx['name'] for idx in inspector.get_indexes('tasks')]
        task_cols = [c['name'] for c in inspector.get_columns('tasks')]
        with op.batch_alter_table('tasks') as batch_op:
            if 'ix_tasks_org_status' in task_indexes:
                batch_op.drop_index('ix_tasks_org_status')
            if 'ix_tasks_organization_id' in task_indexes:
                batch_op.drop_index('ix_tasks_organization_id')
            if 'organization_id' in task_cols:
                batch_op.drop_constraint('fk_tasks_organization_id', type_='foreignkey')
                batch_op.drop_column('organization_id')

    # 2. Revert specialist_versions table changes
    if 'specialist_versions' in tables:
        ver_cols = [c['name'] for c in inspector.get_columns('specialist_versions')]
        if 'parsed_metadata' in ver_cols:
            with op.batch_alter_table('specialist_versions') as batch_op:
                batch_op.drop_column('parsed_metadata')

    # 3. Revert recruitment_records table changes
    if 'recruitment_records' in tables:
        rec_cols = [c['name'] for c in inspector.get_columns('recruitment_records')]
        if 'is_legacy_unpinned' in rec_cols:
            with op.batch_alter_table('recruitment_records') as batch_op:
                batch_op.drop_column('is_legacy_unpinned')

    # 4. Revert users table changes
    if 'users' in tables:
        user_cols = [c['name'] for c in inspector.get_columns('users')]
        if 'token_version' in user_cols:
            with op.batch_alter_table('users') as batch_op:
                batch_op.drop_column('token_version')
