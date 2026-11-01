"""add_behavioral_state_and_navigation_to_agents

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-11-02 00:56:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, Sequence[str], None] = 'b8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'agents' in tables:
        agent_cols = [c['name'] for c in inspector.get_columns('agents')]
        agent_indexes = [idx['name'] for idx in inspector.get_indexes('agents')]

        with op.batch_alter_table('agents', schema=None) as batch_op:
            if 'behavioral_state' not in agent_cols:
                batch_op.add_column(
                    sa.Column(
                        'behavioral_state',
                        sa.String(length=32),
                        nullable=False,
                        server_default='IDLE',
                    )
                )
            if 'target_pos_x' not in agent_cols:
                batch_op.add_column(sa.Column('target_pos_x', sa.Float(), nullable=True))
            if 'target_pos_y' not in agent_cols:
                batch_op.add_column(sa.Column('target_pos_y', sa.Float(), nullable=True))
            if 'target_pos_z' not in agent_cols:
                batch_op.add_column(sa.Column('target_pos_z', sa.Float(), nullable=True))
            if 'target_destination' not in agent_cols:
                batch_op.add_column(sa.Column('target_destination', sa.String(length=64), nullable=True))
            if 'active_movement_id' not in agent_cols:
                batch_op.add_column(sa.Column('active_movement_id', sa.String(length=64), nullable=True))

            if 'ix_agents_behavioral_state' not in agent_indexes:
                batch_op.create_index('ix_agents_behavioral_state', ['behavioral_state'])
            if 'ix_agents_org_behavioral_state' not in agent_indexes:
                batch_op.create_index('ix_agents_org_behavioral_state', ['organization_id', 'behavioral_state'])

        # Backfill behavioral_state from existing operational status
        try:
            conn.execute(sa.text("""
                UPDATE agents
                SET behavioral_state = CASE
                    WHEN status = 'working' THEN 'WORKING'
                    WHEN status = 'waiting_approval' THEN 'WAITING'
                    WHEN status = 'error' THEN 'ERROR'
                    ELSE 'IDLE'
                END
                WHERE behavioral_state IS NULL OR behavioral_state = '';
            """))
        except Exception:
            pass


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'agents' in tables:
        agent_cols = [c['name'] for c in inspector.get_columns('agents')]
        agent_indexes = [idx['name'] for idx in inspector.get_indexes('agents')]

        with op.batch_alter_table('agents', schema=None) as batch_op:
            if 'ix_agents_org_behavioral_state' in agent_indexes:
                batch_op.drop_index('ix_agents_org_behavioral_state')
            if 'ix_agents_behavioral_state' in agent_indexes:
                batch_op.drop_index('ix_agents_behavioral_state')
            if 'active_movement_id' in agent_cols:
                batch_op.drop_column('active_movement_id')
            if 'target_destination' in agent_cols:
                batch_op.drop_column('target_destination')
            if 'target_pos_z' in agent_cols:
                batch_op.drop_column('target_pos_z')
            if 'target_pos_y' in agent_cols:
                batch_op.drop_column('target_pos_y')
            if 'target_pos_x' in agent_cols:
                batch_op.drop_column('target_pos_x')
            if 'behavioral_state' in agent_cols:
                batch_op.drop_column('behavioral_state')

