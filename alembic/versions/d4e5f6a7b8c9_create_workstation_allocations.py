"""create_workstation_allocations

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-10-31 03:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # 1. Add organization_id column to agents and recruitment_records if not present
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    agent_cols = [c['name'] for c in inspector.get_columns('agents')]
    if 'organization_id' not in agent_cols:
        op.add_column('agents', sa.Column('organization_id', sa.String(length=64), server_default='org_default_company', nullable=False))
        op.create_index('ix_agents_org_status', 'agents', ['organization_id', 'status'])

    rec_cols = [c['name'] for c in inspector.get_columns('recruitment_records')]
    if 'organization_id' not in rec_cols:
        op.add_column('recruitment_records', sa.Column('organization_id', sa.String(length=64), server_default='org_default_company', nullable=False))
        op.create_index('ix_recruitment_org_spec', 'recruitment_records', ['organization_id', 'specialist_definition_id'])

    # 2. Create workstation_allocations table if not present
    tables = inspector.get_table_names()
    if 'workstation_allocations' not in tables:
        op.create_table(
            'workstation_allocations',
            sa.Column('id', sa.String(length=64), primary_key=True),
            sa.Column('organization_id', sa.String(length=64), server_default='org_default_company', nullable=False),
            sa.Column('agent_id', sa.String(length=64), sa.ForeignKey('agents.id', ondelete='CASCADE'), nullable=False),
            sa.Column('department', sa.String(length=64), nullable=False),
            sa.Column('logical_workstation_id', sa.String(length=64), nullable=False),
            sa.Column('office_zone', sa.String(length=64), nullable=False),
            sa.Column('desk_number', sa.Integer(), nullable=True),
            sa.Column('pos_x', sa.Float(), nullable=True, server_default='0.0'),
            sa.Column('pos_y', sa.Float(), nullable=True, server_default='1.0'),
            sa.Column('pos_z', sa.Float(), nullable=True, server_default='0.0'),
            sa.Column('allocation_status', sa.String(length=32), server_default='ASSIGNED', nullable=False),
            sa.Column('is_virtual', sa.Boolean(), server_default='0', nullable=False),
            sa.Column('notes', sa.String(length=255), nullable=True),
            sa.Column('allocated_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_workstation_allocations_agent_id', 'workstation_allocations', ['agent_id'], unique=True)
        op.create_index('ix_workstation_allocations_logical', 'workstation_allocations', ['logical_workstation_id'])
        op.create_index('ix_workstation_org_dept', 'workstation_allocations', ['organization_id', 'department'])
        op.create_index('ix_workstation_org_logical', 'workstation_allocations', ['organization_id', 'logical_workstation_id'])

def downgrade() -> None:
    op.drop_table('workstation_allocations')
