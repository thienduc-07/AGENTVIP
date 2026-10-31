"""create_specialist_definitions_and_versions

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-10-31 01:45:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # 1. Create specialist_definitions table
    op.create_table(
        'specialist_definitions',
        sa.Column('id', sa.String(length=64), primary_key=True),
        sa.Column('slug', sa.String(length=128), nullable=False),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('division', sa.String(length=64), nullable=False),
        sa.Column('department', sa.String(length=64), nullable=False),
        sa.Column('role', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('color', sa.String(length=32), nullable=True, server_default='blue'),
        sa.Column('emoji', sa.String(length=16), nullable=True, server_default='🤖'),
        sa.Column('vibe', sa.Text(), nullable=True),
        sa.Column('system_instructions', sa.Text(), nullable=False),
        sa.Column('identity_and_memory', sa.Text(), nullable=True),
        sa.Column('core_mission', sa.Text(), nullable=True),
        sa.Column('critical_rules', sa.Text(), nullable=True),
        sa.Column('workflows', sa.Text(), nullable=True),
        sa.Column('deliverables', sa.Text(), nullable=True),
        sa.Column('success_metrics', sa.Text(), nullable=True),
        sa.Column('capabilities', sa.JSON(), nullable=True),
        sa.Column('skills', sa.JSON(), nullable=True),
        sa.Column('declared_tools', sa.JSON(), nullable=True),
        sa.Column('assigned_tools', sa.JSON(), nullable=True),
        sa.Column('permission_level', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('source_repo', sa.String(length=255), nullable=False, server_default='https://github.com/msitarzewski/agency-agents'),
        sa.Column('source_path', sa.String(length=255), nullable=False),
        sa.Column('source_commit_sha', sa.String(length=64), nullable=True),
        sa.Column('content_hash', sa.String(length=64), nullable=False),
        sa.Column('raw_content', sa.Text(), nullable=False),
        sa.Column('raw_frontmatter', sa.JSON(), nullable=True),
        sa.Column('validation_status', sa.String(length=32), nullable=False, server_default='VALID'),
        sa.Column('validation_errors', sa.JSON(), nullable=True),
        sa.Column('lifecycle_state', sa.String(length=32), nullable=False, server_default='AVAILABLE'),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('imported_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_specialist_definitions_slug', 'specialist_definitions', ['slug'], unique=True)
    op.create_index('ix_specialist_definitions_name', 'specialist_definitions', ['name'])
    op.create_index('ix_specialist_definitions_division', 'specialist_definitions', ['division'])
    op.create_index('ix_specialist_definitions_department', 'specialist_definitions', ['department'])
    op.create_index('ix_specialist_definitions_content_hash', 'specialist_definitions', ['content_hash'])
    op.create_index('ix_specialist_definitions_validation_status', 'specialist_definitions', ['validation_status'])
    op.create_index('ix_specialist_definitions_lifecycle_state', 'specialist_definitions', ['lifecycle_state'])
    op.create_index('ix_specialist_dept_div', 'specialist_definitions', ['department', 'division'])
    op.create_index('ix_specialist_lifecycle_valid', 'specialist_definitions', ['lifecycle_state', 'validation_status'])

    # 2. Create specialist_versions table
    op.create_table(
        'specialist_versions',
        sa.Column('id', sa.String(length=64), primary_key=True),
        sa.Column('specialist_id', sa.String(length=64), sa.ForeignKey('specialist_definitions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('source_commit_sha', sa.String(length=64), nullable=True),
        sa.Column('content_hash', sa.String(length=64), nullable=False),
        sa.Column('raw_content', sa.Text(), nullable=False),
        sa.Column('change_summary', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_specialist_versions_specialist_id', 'specialist_versions', ['specialist_id'])
    op.create_index('ix_spec_version_lookup', 'specialist_versions', ['specialist_id', 'version'])

def downgrade() -> None:
    op.drop_table('specialist_versions')
    op.drop_table('specialist_definitions')
