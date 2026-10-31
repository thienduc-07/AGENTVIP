"""security_versioning_and_desk_uniqueness

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-10-31 14:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # 1. Create organizations table if not present
    if 'organizations' not in tables:
        op.create_table(
            'organizations',
            sa.Column('id', sa.String(length=64), primary_key=True),
            sa.Column('name', sa.String(length=128), nullable=False),
            sa.Column('slug', sa.String(length=64), nullable=False),
            sa.Column('tier', sa.String(length=32), server_default='pro', nullable=False),
            sa.Column('is_active', sa.Boolean(), server_default='1', nullable=False),
            sa.Column('settings', sa.JSON(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_organizations_slug', 'organizations', ['slug'], unique=True)

    # 2. Create users table if not present
    if 'users' not in tables:
        op.create_table(
            'users',
            sa.Column('id', sa.String(length=64), primary_key=True),
            sa.Column('email', sa.String(length=255), nullable=False),
            sa.Column('hashed_password', sa.String(length=255), nullable=False),
            sa.Column('full_name', sa.String(length=128), nullable=False),
            sa.Column('is_superadmin', sa.Boolean(), server_default='0', nullable=False),
            sa.Column('is_active', sa.Boolean(), server_default='1', nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_users_email', 'users', ['email'], unique=True)

    # 3. Create organization_members table if not present
    if 'organization_members' not in tables:
        op.create_table(
            'organization_members',
            sa.Column('id', sa.String(length=64), primary_key=True),
            sa.Column('organization_id', sa.String(length=64), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.String(length=64), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('role', sa.String(length=32), server_default='ORGANIZATION_MEMBER', nullable=False),
            sa.Column('is_active', sa.Boolean(), server_default='1', nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('organization_id', 'user_id', name='uq_org_user'),
        )
        op.create_index('ix_org_members_user', 'organization_members', ['user_id'])
        op.create_index('ix_org_members_org', 'organization_members', ['organization_id'])

    # 4. Add specialist_version_id and specialist_version_num to recruitment_records
    rec_cols = [c['name'] for c in inspector.get_columns('recruitment_records')]
    with op.batch_alter_table('recruitment_records') as batch_op:
        if 'specialist_version_id' not in rec_cols:
            batch_op.add_column(sa.Column('specialist_version_id', sa.String(length=64), nullable=True))
            batch_op.create_foreign_key('fk_recruitment_spec_ver', 'specialist_versions', ['specialist_version_id'], ['id'], ondelete='SET NULL')
            batch_op.create_index('ix_recruitment_spec_ver', ['specialist_version_id'])
        if 'specialist_version_num' not in rec_cols:
            batch_op.add_column(sa.Column('specialist_version_num', sa.Integer(), server_default='1', nullable=False))

    # 5. Add partial unique index on workstation_allocations for occupied physical desks
    indexes = [idx['name'] for idx in inspector.get_indexes('workstation_allocations')]
    if 'uq_assigned_physical_desk' not in indexes:
        op.create_index(
            'uq_assigned_physical_desk',
            'workstation_allocations',
            ['organization_id', 'department', 'desk_number'],
            unique=True,
            sqlite_where=sa.text("allocation_status = 'ASSIGNED' AND desk_number IS NOT NULL"),
        )


def downgrade() -> None:
    # 1. Drop partial unique index on workstation_allocations
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    indexes = [idx['name'] for idx in inspector.get_indexes('workstation_allocations')]
    if 'uq_assigned_physical_desk' in indexes:
        op.drop_index('uq_assigned_physical_desk', table_name='workstation_allocations')

    # 2. Drop specialist_version columns from recruitment_records
    with op.batch_alter_table('recruitment_records') as batch_op:
        rec_cols = [c['name'] for c in inspector.get_columns('recruitment_records')]
        if 'specialist_version_id' in rec_cols:
            batch_op.drop_index('ix_recruitment_spec_ver')
            batch_op.drop_constraint('fk_recruitment_spec_ver', type_='foreignkey')
            batch_op.drop_column('specialist_version_id')
        if 'specialist_version_num' in rec_cols:
            batch_op.drop_column('specialist_version_num')

    # 3. Drop auth tables
    tables = inspector.get_table_names()
    if 'organization_members' in tables:
        op.drop_table('organization_members')
    if 'users' in tables:
        op.drop_table('users')
    if 'organizations' in tables:
        op.drop_table('organizations')
