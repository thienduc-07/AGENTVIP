"""create_execution_and_terminal_tables

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-11-03 01:40:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, Sequence[str], None] = 'd0e1f2a3b4c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # 1. executions table
    if 'executions' not in tables:
        op.create_table(
            'executions',
            sa.Column('id', sa.String(length=64), primary_key=True),
            sa.Column('organization_id', sa.String(length=64), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
            sa.Column('agent_id', sa.String(length=64), sa.ForeignKey('agents.id', ondelete='CASCADE'), nullable=False),
            sa.Column('task_id', sa.String(length=64), sa.ForeignKey('tasks.id', ondelete='SET NULL'), nullable=True),
            sa.Column('status', sa.String(length=32), nullable=False, server_default='running'),
            sa.Column('started_at', sa.DateTime(), nullable=False),
            sa.Column('completed_at', sa.DateTime(), nullable=True),
            sa.Column('error_message', sa.Text(), nullable=True),
            sa.Column('summary', sa.Text(), nullable=True),
            sa.Column('prompt_tokens', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('completion_tokens', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('total_tokens', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('estimated_cost_usd', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('tool_calls_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('total_lines', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('files_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_executions_organization_id', 'executions', ['organization_id'])
        op.create_index('ix_executions_agent_id', 'executions', ['agent_id'])
        op.create_index('ix_executions_task_id', 'executions', ['task_id'])
        op.create_index('ix_executions_status', 'executions', ['status'])
        op.create_index('ix_executions_started_at', 'executions', ['started_at'])
        op.create_index('ix_executions_org_agent_status', 'executions', ['organization_id', 'agent_id', 'status'])
        op.create_index('ix_executions_org_started', 'executions', ['organization_id', 'started_at'])

    # 2. terminal_lines table
    if 'terminal_lines' not in tables:
        op.create_table(
            'terminal_lines',
            sa.Column('id', sa.String(length=64), primary_key=True),
            sa.Column('execution_id', sa.String(length=64), sa.ForeignKey('executions.id', ondelete='CASCADE'), nullable=False),
            sa.Column('organization_id', sa.String(length=64), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
            sa.Column('agent_id', sa.String(length=64), sa.ForeignKey('agents.id', ondelete='CASCADE'), nullable=False),
            sa.Column('task_id', sa.String(length=64), sa.ForeignKey('tasks.id', ondelete='SET NULL'), nullable=True),
            sa.Column('line_number', sa.Integer(), nullable=False),
            sa.Column('stream', sa.String(length=16), nullable=False, server_default='stdout'),
            sa.Column('content', sa.Text(), nullable=False),
            sa.Column('metadata_json', sa.JSON(), nullable=True),
            sa.Column('timestamp', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_terminal_lines_execution_id', 'terminal_lines', ['execution_id'])
        op.create_index('ix_terminal_lines_org_id', 'terminal_lines', ['organization_id'])
        op.create_index('ix_terminal_lines_agent_id', 'terminal_lines', ['agent_id'])
        op.create_index('ix_terminal_lines_stream', 'terminal_lines', ['stream'])
        op.create_index('ix_terminal_lines_timestamp', 'terminal_lines', ['timestamp'])
        op.create_index('ix_terminal_exec_seq', 'terminal_lines', ['execution_id', 'line_number'])

    # 3. Add execution_id column to agent_events table
    if 'agent_events' in tables:
        event_cols = [c['name'] for c in inspector.get_columns('agent_events')]
        event_indexes = [idx['name'] for idx in inspector.get_indexes('agent_events')]
        with op.batch_alter_table('agent_events', schema=None) as batch_op:
            if 'execution_id' not in event_cols:
                batch_op.add_column(sa.Column('execution_id', sa.String(length=64), nullable=True))
            if 'ix_agent_events_exec_created' not in event_indexes:
                batch_op.create_index('ix_agent_events_exec_created', ['execution_id', 'created_at'])

    # 4. Add idempotency_key and lease_token columns to tasks table
    if 'tasks' in tables:
        task_cols = [c['name'] for c in inspector.get_columns('tasks')]
        task_indexes = [idx['name'] for idx in inspector.get_indexes('tasks')]
        with op.batch_alter_table('tasks', schema=None) as batch_op:
            if 'idempotency_key' not in task_cols:
                batch_op.add_column(sa.Column('idempotency_key', sa.String(length=64), nullable=True))
            if 'lease_token' not in task_cols:
                batch_op.add_column(sa.Column('lease_token', sa.String(length=64), nullable=True))
            if 'ix_tasks_org_idempotency' not in task_indexes:
                batch_op.create_index('ix_tasks_org_idempotency', ['organization_id', 'idempotency_key'])
            if 'ix_tasks_lease_token' not in task_indexes:
                batch_op.create_index('ix_tasks_lease_token', ['lease_token'])

    # 5. Add resolved_by_user_id column to approvals table
    if 'approvals' in tables:
        approval_cols = [c['name'] for c in inspector.get_columns('approvals')]
        with op.batch_alter_table('approvals', schema=None) as batch_op:
            if 'resolved_by_user_id' not in approval_cols:
                batch_op.add_column(sa.Column('resolved_by_user_id', sa.String(length=64), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # 1. Drop approvals.resolved_by_user_id
    if 'approvals' in tables:
        approval_cols = [c['name'] for c in inspector.get_columns('approvals')]
        if 'resolved_by_user_id' in approval_cols:
            with op.batch_alter_table('approvals', schema=None) as batch_op:
                batch_op.drop_column('resolved_by_user_id')

    # 2. Drop tasks columns
    if 'tasks' in tables:
        task_cols = [c['name'] for c in inspector.get_columns('tasks')]
        task_indexes = [idx['name'] for idx in inspector.get_indexes('tasks')]
        with op.batch_alter_table('tasks', schema=None) as batch_op:
            if 'ix_tasks_lease_token' in task_indexes:
                batch_op.drop_index('ix_tasks_lease_token')
            if 'ix_tasks_org_idempotency' in task_indexes:
                batch_op.drop_index('ix_tasks_org_idempotency')
            if 'lease_token' in task_cols:
                batch_op.drop_column('lease_token')
            if 'idempotency_key' in task_cols:
                batch_op.drop_column('idempotency_key')

    # 3. Drop agent_events columns
    if 'agent_events' in tables:
        event_cols = [c['name'] for c in inspector.get_columns('agent_events')]
        event_indexes = [idx['name'] for idx in inspector.get_indexes('agent_events')]
        with op.batch_alter_table('agent_events', schema=None) as batch_op:
            if 'ix_agent_events_exec_created' in event_indexes:
                batch_op.drop_index('ix_agent_events_exec_created')
            if 'execution_id' in event_cols:
                batch_op.drop_column('execution_id')

    # 4. Drop terminal_lines table
    if 'terminal_lines' in tables:
        op.drop_table('terminal_lines')

    # 5. Drop executions table
    if 'executions' in tables:
        op.drop_table('executions')

