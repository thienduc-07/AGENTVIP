"""create_meeting_subsystem_tables

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-11-02 21:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd0e1f2a3b4c5'
down_revision: Union[str, Sequence[str], None] = 'c9d0e1f2a3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # 1. meetings
    if 'meetings' not in tables:
        op.create_table(
            'meetings',
            sa.Column('id', sa.String(length=64), primary_key=True),
            sa.Column('organization_id', sa.String(length=64), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
            sa.Column('title', sa.String(length=200), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('meeting_type', sa.String(length=64), nullable=False, server_default='GENERAL'),
            sa.Column('status', sa.String(length=32), nullable=False, server_default='DRAFT'),
            sa.Column('objective', sa.Text(), nullable=True),
            sa.Column('created_by', sa.String(length=64), nullable=True),
            sa.Column('moderator_agent_id', sa.String(length=64), sa.ForeignKey('agents.id', ondelete='SET NULL'), nullable=True),
            sa.Column('started_at', sa.DateTime(), nullable=True),
            sa.Column('ended_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.Column('metadata_json', sa.JSON(), nullable=True),
        )
        op.create_index('ix_meetings_org_id', 'meetings', ['organization_id'])
        op.create_index('ix_meetings_status', 'meetings', ['status'])
        op.create_index('ix_meetings_type', 'meetings', ['meeting_type'])
        op.create_index('ix_meetings_moderator', 'meetings', ['moderator_agent_id'])
        op.create_index('ix_meetings_created', 'meetings', ['created_at'])
        op.create_index('ix_meetings_org_status', 'meetings', ['organization_id', 'status'])
        op.create_index('ix_meetings_org_created', 'meetings', ['organization_id', 'created_at'])

    # 2. meeting_participants
    if 'meeting_participants' not in tables:
        op.create_table(
            'meeting_participants',
            sa.Column('id', sa.String(length=64), primary_key=True),
            sa.Column('meeting_id', sa.String(length=64), sa.ForeignKey('meetings.id', ondelete='CASCADE'), nullable=False),
            sa.Column('agent_id', sa.String(length=64), sa.ForeignKey('agents.id', ondelete='RESTRICT'), nullable=False),
            sa.Column('role', sa.String(length=32), nullable=False, server_default='SPECIALIST'),
            sa.Column('participation_status', sa.String(length=32), nullable=False, server_default='INVITED'),
            sa.Column('joined_at', sa.DateTime(), nullable=True),
            sa.Column('left_at', sa.DateTime(), nullable=True),
            sa.Column('speaking_order', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('contribution_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('metadata_json', sa.JSON(), nullable=True),
            sa.UniqueConstraint('meeting_id', 'agent_id', name='uq_meeting_participant'),
        )
        op.create_index('ix_meeting_participants_meeting_id', 'meeting_participants', ['meeting_id'])
        op.create_index('ix_meeting_participants_agent_id', 'meeting_participants', ['agent_id'])
        op.create_index('ix_meeting_participants_status', 'meeting_participants', ['meeting_id', 'participation_status'])

    # 3. meeting_messages
    if 'meeting_messages' not in tables:
        op.create_table(
            'meeting_messages',
            sa.Column('id', sa.String(length=64), primary_key=True),
            sa.Column('meeting_id', sa.String(length=64), sa.ForeignKey('meetings.id', ondelete='CASCADE'), nullable=False),
            sa.Column('participant_id', sa.String(length=64), sa.ForeignKey('meeting_participants.id', ondelete='CASCADE'), nullable=True),
            sa.Column('agent_id', sa.String(length=64), sa.ForeignKey('agents.id', ondelete='SET NULL'), nullable=True),
            sa.Column('message_type', sa.String(length=32), nullable=False, server_default='STATEMENT'),
            sa.Column('content', sa.Text(), nullable=False),
            sa.Column('sequence_number', sa.Integer(), nullable=False),
            sa.Column('reply_to_message_id', sa.String(length=64), sa.ForeignKey('meeting_messages.id', ondelete='SET NULL'), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('metadata_json', sa.JSON(), nullable=True),
            sa.UniqueConstraint('meeting_id', 'sequence_number', name='uq_meeting_seq_num'),
        )
        op.create_index('ix_meeting_messages_meeting_id', 'meeting_messages', ['meeting_id'])
        op.create_index('ix_meeting_messages_participant_id', 'meeting_messages', ['participant_id'])
        op.create_index('ix_meeting_messages_agent_id', 'meeting_messages', ['agent_id'])
        op.create_index('ix_meeting_messages_type', 'meeting_messages', ['message_type'])
        op.create_index('ix_meeting_messages_seq', 'meeting_messages', ['sequence_number'])
        op.create_index('ix_meeting_messages_created', 'meeting_messages', ['meeting_id', 'created_at'])

    # 4. meeting_decisions
    if 'meeting_decisions' not in tables:
        op.create_table(
            'meeting_decisions',
            sa.Column('id', sa.String(length=64), primary_key=True),
            sa.Column('meeting_id', sa.String(length=64), sa.ForeignKey('meetings.id', ondelete='CASCADE'), nullable=False),
            sa.Column('title', sa.String(length=200), nullable=False),
            sa.Column('description', sa.Text(), nullable=False),
            sa.Column('decision_type', sa.String(length=64), nullable=False, server_default='STRATEGIC'),
            sa.Column('status', sa.String(length=32), nullable=False, server_default='PROPOSED'),
            sa.Column('proposed_by', sa.String(length=64), sa.ForeignKey('agents.id', ondelete='SET NULL'), nullable=True),
            sa.Column('approved_by', sa.String(length=64), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('resolved_at', sa.DateTime(), nullable=True),
            sa.Column('metadata_json', sa.JSON(), nullable=True),
        )
        op.create_index('ix_meeting_decisions_meeting_id', 'meeting_decisions', ['meeting_id'])
        op.create_index('ix_meeting_decisions_meeting_status', 'meeting_decisions', ['meeting_id', 'status'])
        op.create_index('ix_meeting_decisions_type', 'meeting_decisions', ['decision_type'])

    # 5. meeting_votes
    if 'meeting_votes' not in tables:
        op.create_table(
            'meeting_votes',
            sa.Column('id', sa.String(length=64), primary_key=True),
            sa.Column('decision_id', sa.String(length=64), sa.ForeignKey('meeting_decisions.id', ondelete='CASCADE'), nullable=False),
            sa.Column('agent_id', sa.String(length=64), sa.ForeignKey('agents.id', ondelete='CASCADE'), nullable=False),
            sa.Column('vote', sa.String(length=32), nullable=False),
            sa.Column('reasoning', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('decision_id', 'agent_id', name='uq_decision_agent_vote'),
        )
        op.create_index('ix_meeting_votes_decision_id', 'meeting_votes', ['decision_id'])
        op.create_index('ix_meeting_votes_agent_id', 'meeting_votes', ['agent_id'])

    # 6. meeting_action_items
    if 'meeting_action_items' not in tables:
        op.create_table(
            'meeting_action_items',
            sa.Column('id', sa.String(length=64), primary_key=True),
            sa.Column('meeting_id', sa.String(length=64), sa.ForeignKey('meetings.id', ondelete='CASCADE'), nullable=False),
            sa.Column('decision_id', sa.String(length=64), sa.ForeignKey('meeting_decisions.id', ondelete='SET NULL'), nullable=True),
            sa.Column('title', sa.String(length=200), nullable=False),
            sa.Column('description', sa.Text(), nullable=False),
            sa.Column('assigned_agent_id', sa.String(length=64), sa.ForeignKey('agents.id', ondelete='RESTRICT'), nullable=False),
            sa.Column('assigned_by', sa.String(length=64), nullable=True),
            sa.Column('linked_task_id', sa.String(length=64), sa.ForeignKey('tasks.id', ondelete='SET NULL'), nullable=True),
            sa.Column('priority', sa.String(length=20), nullable=False, server_default='normal'),
            sa.Column('status', sa.String(length=32), nullable=False, server_default='PENDING'),
            sa.Column('due_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('completed_at', sa.DateTime(), nullable=True),
        )
        op.create_index('ix_meeting_actions_meeting_id', 'meeting_action_items', ['meeting_id'])
        op.create_index('ix_meeting_actions_decision_id', 'meeting_action_items', ['decision_id'])
        op.create_index('ix_meeting_actions_agent', 'meeting_action_items', ['assigned_agent_id', 'status'])
        op.create_index('ix_meeting_actions_meeting', 'meeting_action_items', ['meeting_id', 'status'])
        op.create_index('ix_meeting_actions_task', 'meeting_action_items', ['linked_task_id'])

    # 7. meeting_transcripts
    if 'meeting_transcripts' not in tables:
        op.create_table(
            'meeting_transcripts',
            sa.Column('id', sa.String(length=64), primary_key=True),
            sa.Column('meeting_id', sa.String(length=64), sa.ForeignKey('meetings.id', ondelete='CASCADE'), nullable=False),
            sa.Column('transcript_version', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('content', sa.Text(), nullable=False),
            sa.Column('summary', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('meeting_id', 'transcript_version', name='uq_meeting_transcript_ver'),
        )
        op.create_index('ix_meeting_transcripts_meeting_id', 'meeting_transcripts', ['meeting_id'])


def downgrade() -> None:
    op.drop_table('meeting_transcripts')
    op.drop_table('meeting_action_items')
    op.drop_table('meeting_votes')
    op.drop_table('meeting_decisions')
    op.drop_table('meeting_messages')
    op.drop_table('meeting_participants')
    op.drop_table('meetings')
