"""add_organization_id_to_agent_events

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-11-01 01:25:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, Sequence[str], None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'agent_events' in tables:
        event_cols = [c['name'] for c in inspector.get_columns('agent_events')]
        event_indexes = [idx['name'] for idx in inspector.get_indexes('agent_events')]

        with op.batch_alter_table('agent_events', schema=None) as batch_op:
            if 'organization_id' not in event_cols:
                batch_op.add_column(sa.Column('organization_id', sa.String(length=64), nullable=True))
                batch_op.create_foreign_key(
                    'fk_agent_events_organization_id',
                    'organizations',
                    ['organization_id'],
                    ['id'],
                    ondelete='CASCADE'
                )
            if 'ix_agent_events_organization_id' not in event_indexes:
                batch_op.create_index('ix_agent_events_organization_id', ['organization_id'])
            if 'ix_agent_events_org_seq' not in event_indexes:
                batch_op.create_index('ix_agent_events_org_seq', ['organization_id', 'sequence_id'])

        # Data backfill:
        # 1. Backfill from tasks.organization_id via task_id
        try:
            conn.execute(sa.text("""
                UPDATE agent_events
                SET organization_id = (
                    SELECT organization_id FROM tasks
                    WHERE tasks.id = agent_events.task_id
                )
                WHERE agent_events.organization_id IS NULL
                  AND agent_events.task_id IS NOT NULL
                  AND EXISTS (SELECT 1 FROM tasks WHERE tasks.id = agent_events.task_id);
            """))
        except Exception:
            pass

        # 2. Backfill from agents.organization_id via agent_id
        try:
            conn.execute(sa.text("""
                UPDATE agent_events
                SET organization_id = (
                    SELECT organization_id FROM agents
                    WHERE agents.id = agent_events.agent_id
                )
                WHERE agent_events.organization_id IS NULL
                  AND agent_events.agent_id IS NOT NULL
                  AND EXISTS (SELECT 1 FROM agents WHERE agents.id = agent_events.agent_id);
            """))
        except Exception:
            pass

        # 3. Backfill from payload_json if organization_id present
        try:
            conn.execute(sa.text("""
                UPDATE agent_events
                SET organization_id = json_extract(payload_json, '$.organization_id')
                WHERE agent_events.organization_id IS NULL
                  AND payload_json IS NOT NULL
                  AND json_extract(payload_json, '$.organization_id') IS NOT NULL;
            """))
        except Exception:
            pass


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'agent_events' in tables:
        event_indexes = [idx['name'] for idx in inspector.get_indexes('agent_events')]
        event_cols = [c['name'] for c in inspector.get_columns('agent_events')]

        with op.batch_alter_table('agent_events', schema=None) as batch_op:
            if 'ix_agent_events_org_seq' in event_indexes:
                batch_op.drop_index('ix_agent_events_org_seq')
            if 'ix_agent_events_organization_id' in event_indexes:
                batch_op.drop_index('ix_agent_events_organization_id')
            if 'organization_id' in event_cols:
                try:
                    batch_op.drop_constraint('fk_agent_events_organization_id', type_='foreignkey')
                except Exception:
                    pass
                batch_op.drop_column('organization_id')
