"""create_recruitment_and_performance_tables

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-10-31 02:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # 1. Create recruitment_records table
    op.create_table(
        'recruitment_records',
        sa.Column('id', sa.String(length=64), primary_key=True),
        sa.Column('specialist_definition_id', sa.String(length=64), sa.ForeignKey('specialist_definitions.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('agent_id', sa.String(length=64), sa.ForeignKey('agents.id', ondelete='CASCADE'), nullable=False),
        sa.Column('department', sa.String(length=64), nullable=False),
        sa.Column('manager_agent_id', sa.String(length=64), sa.ForeignKey('agents.id', ondelete='SET NULL'), nullable=True),
        sa.Column('recruited_by', sa.String(length=64), nullable=False, server_default='agent-exec-ceo'),
        sa.Column('lifecycle_state', sa.String(length=32), nullable=False, server_default='ACTIVE'),
        sa.Column('permission_profile', sa.String(length=64), nullable=False, server_default='standard_specialist'),
        sa.Column('budget_limit_usd', sa.Float(), nullable=False, server_default='50.0'),
        sa.Column('budget_spent_usd', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('max_daily_tasks', sa.Integer(), nullable=False, server_default='100'),
        sa.Column('model_preference', sa.String(length=64), nullable=False, server_default='auto'),
        sa.Column('memory_policy', sa.JSON(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('recruited_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_recruitment_records_agent_id', 'recruitment_records', ['agent_id'], unique=True)
    op.create_index('ix_recruitment_records_spec_id', 'recruitment_records', ['specialist_definition_id'])
    op.create_index('ix_recruitment_records_dept', 'recruitment_records', ['department'])
    op.create_index('ix_recruitment_dept_state', 'recruitment_records', ['department', 'lifecycle_state'])
    op.create_index('ix_recruitment_manager', 'recruitment_records', ['manager_agent_id'])

    # 2. Create agent_performance table
    op.create_table(
        'agent_performance',
        sa.Column('id', sa.String(length=64), primary_key=True),
        sa.Column('agent_id', sa.String(length=64), sa.ForeignKey('agents.id', ondelete='CASCADE'), nullable=False),
        sa.Column('tasks_completed', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('tasks_failed', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('avg_duration_ms', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('avg_quality_score', sa.Float(), nullable=False, server_default='100.0'),
        sa.Column('total_tokens_used', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('total_cost_usd', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('last_active_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_agent_performance_agent_id', 'agent_performance', ['agent_id'], unique=True)

def downgrade() -> None:
    op.drop_table('agent_performance')
    op.drop_table('recruitment_records')
