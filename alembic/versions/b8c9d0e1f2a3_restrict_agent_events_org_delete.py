"""restrict_agent_events_org_delete

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-11-01 02:15:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8c9d0e1f2a3'
down_revision: Union[str, Sequence[str], None] = 'a7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'agent_events' in tables:
        # 1. Hardening & quarantine before constraint upgrade:
        # Quarantine events with conflicting task and agent organizations
        try:
            conn.execute(sa.text("""
                UPDATE agent_events
                SET organization_id = NULL
                WHERE id IN (
                    SELECT ae.id FROM agent_events ae
                    JOIN tasks t ON ae.task_id = t.id
                    JOIN agents a ON ae.agent_id = a.id
                    WHERE t.organization_id != a.organization_id
                );
            """))
        except Exception:
            pass

        # Quarantine events pointing to non-existent organizations
        try:
            conn.execute(sa.text("""
                UPDATE agent_events
                SET organization_id = NULL
                WHERE organization_id IS NOT NULL
                  AND organization_id NOT IN (SELECT id FROM organizations);
            """))
        except Exception:
            pass

        # 2. Re-create foreign key with RESTRICT
        with op.batch_alter_table('agent_events', schema=None) as batch_op:
            batch_op.drop_constraint('fk_agent_events_organization_id', type_='foreignkey')
            batch_op.create_foreign_key(
                'fk_agent_events_organization_id',
                'organizations',
                ['organization_id'],
                ['id'],
                ondelete='RESTRICT'
            )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'agent_events' in tables:
        with op.batch_alter_table('agent_events', schema=None) as batch_op:
            batch_op.drop_constraint('fk_agent_events_organization_id', type_='foreignkey')
            batch_op.create_foreign_key(
                'fk_agent_events_organization_id',
                'organizations',
                ['organization_id'],
                ['id'],
                ondelete='CASCADE'
            )
