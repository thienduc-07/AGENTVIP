import os
import json
import pytest
import uuid
import threading
import tempfile
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock, AsyncMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.core.config import settings, validate_signing_secret, FORBIDDEN_DEFAULT_SECRETS
from backend.app.core.database import Base, get_db
from backend.app.core.auth import (
    create_access_token,
    create_jwt_token,
    decode_jwt_token,
    get_jwt_secret,
    revoke_user_tokens,
    _b64encode,
    ROLE_PLATFORM_SUPERADMIN,
    ROLE_ORGANIZATION_OWNER,
    ROLE_ORGANIZATION_ADMIN,
    ROLE_ORGANIZATION_MEMBER,
    hash_password,
)
from backend.app.models.auth import UserModel, OrganizationModel, OrganizationMemberModel
from backend.app.models.agent import AgentModel
from backend.app.models.task import TaskModel
from backend.app.models.task_step import TaskStepModel
from backend.app.models.specialist import SpecialistDefinitionModel, SpecialistVersionModel
from backend.app.models.recruitment import RecruitmentRecordModel
from backend.app.models.workstation import WorkstationAllocationModel
from backend.app.models.approval import ApprovalModel
from backend.app.models.memory import MemoryModel
from backend.app.services.task_service import TaskService
from backend.app.services.recruitment_service import recruitment_service
from backend.app.services.workstation_service import workstation_service
from backend.app.agent_runtime.dispatcher.dispatcher import TaskDispatcher
from backend.app.agent_runtime.registry.agent_registry import default_agent_registry
from backend.app.websocket_manager import WebSocketManager
from backend.app.core.errors import ValidationError


def get_error_message(resp) -> str:
    """Helper to extract error message from standard error envelopes."""
    data = resp.json()
    if isinstance(data, dict):
        if "error" in data and isinstance(data["error"], dict):
            return data["error"].get("message", "")
        return data.get("detail", "")
    return str(data)


@pytest.fixture
def auth_tenants(db_session):
    """
    Sets up two isolated tenant organizations (Org A and Org B)
    with owners, admins, members, and a platform superadmin.
    """
    org_a = OrganizationModel(
        id="org_alpha_v2",
        name="Alpha Corporation V2",
        slug="alpha-v2",
        tier="enterprise",
        is_active=True,
    )
    org_b = OrganizationModel(
        id="org_beta_v2",
        name="Beta Inc V2",
        slug="beta-v2",
        tier="pro",
        is_active=True,
    )
    db_session.add_all([org_a, org_b])
    db_session.flush()

    u_super = UserModel(
        id="usr_super_v2",
        email="super_v2@agency.ai",
        hashed_password=hash_password("SuperSecret123!"),
        full_name="Super Admin V2",
        is_superadmin=True,
        is_active=True,
        token_version=1,
    )
    u_owner_a = UserModel(
        id="usr_owner_a_v2",
        email="owner_a_v2@alpha.corp",
        hashed_password=hash_password("OwnerASecret123!"),
        full_name="Owner A V2",
        is_superadmin=False,
        is_active=True,
        token_version=1,
    )
    u_admin_a = UserModel(
        id="usr_admin_a_v2",
        email="admin_a_v2@alpha.corp",
        hashed_password=hash_password("AdminASecret123!"),
        full_name="Admin A V2",
        is_superadmin=False,
        is_active=True,
        token_version=1,
    )
    u_member_a = UserModel(
        id="usr_member_a_v2",
        email="member_a_v2@alpha.corp",
        hashed_password=hash_password("MemberASecret123!"),
        full_name="Member A V2",
        is_superadmin=False,
        is_active=True,
        token_version=1,
    )
    u_owner_b = UserModel(
        id="usr_owner_b_v2",
        email="owner_b_v2@beta.inc",
        hashed_password=hash_password("OwnerBSecret123!"),
        full_name="Owner B V2",
        is_superadmin=False,
        is_active=True,
        token_version=1,
    )
    db_session.add_all([u_super, u_owner_a, u_admin_a, u_member_a, u_owner_b])
    db_session.flush()

    members = [
        OrganizationMemberModel(organization_id="org_alpha_v2", user_id="usr_super_v2", role=ROLE_PLATFORM_SUPERADMIN),
        OrganizationMemberModel(organization_id="org_alpha_v2", user_id="usr_owner_a_v2", role=ROLE_ORGANIZATION_OWNER),
        OrganizationMemberModel(organization_id="org_alpha_v2", user_id="usr_admin_a_v2", role=ROLE_ORGANIZATION_ADMIN),
        OrganizationMemberModel(organization_id="org_alpha_v2", user_id="usr_member_a_v2", role=ROLE_ORGANIZATION_MEMBER),
        OrganizationMemberModel(organization_id="org_beta_v2", user_id="usr_owner_b_v2", role=ROLE_ORGANIZATION_OWNER),
    ]
    db_session.add_all(members)
    db_session.commit()

    tokens = {
        "superadmin": create_access_token("usr_super_v2", "super_v2@agency.ai", token_version=1),
        "owner_a": create_access_token("usr_owner_a_v2", "owner_a_v2@alpha.corp", token_version=1),
        "admin_a": create_access_token("usr_admin_a_v2", "admin_a_v2@alpha.corp", token_version=1),
        "member_a": create_access_token("usr_member_a_v2", "member_a_v2@alpha.corp", token_version=1),
        "owner_b": create_access_token("usr_owner_b_v2", "owner_b_v2@beta.inc", token_version=1),
    }
    return tokens


# ==============================================================================
# P0 — SEC-01: JWT SIGNING SECRET SECURITY
# ==============================================================================

class TestSEC01SigningSecretSecurity:

    def test_missing_secret_fails_startup(self):
        with pytest.raises(ValueError, match="Startup aborted: SECRET_KEY is missing or empty"):
            validate_signing_secret("")

    def test_empty_secret_fails_startup(self):
        with pytest.raises(ValueError, match="Startup aborted: SECRET_KEY is missing or empty"):
            validate_signing_secret("   ")

    def test_forbidden_default_secret_fails_startup(self):
        for forbidden in FORBIDDEN_DEFAULT_SECRETS:
            with pytest.raises(ValueError, match="Startup aborted: Insecure default"):
                validate_signing_secret(forbidden)

    def test_short_secret_fails_startup(self):
        short = "short-secret-under-32-chars!"
        with pytest.raises(ValueError, match="Startup aborted: SECRET_KEY is too short"):
            validate_signing_secret(short)

    def test_valid_secret_permits_startup(self):
        valid = "a_very_secure_and_cryptographically_strong_signing_key_32bytes"
        assert validate_signing_secret(valid) == valid

    def test_tampered_signature_rejected(self):
        token = create_access_token("usr_owner_a_v2", "owner@alpha.corp", token_version=1)
        # Tamper with the signature portion
        parts = token.split(".")
        tampered_token = f"{parts[0]}.{parts[1]}.tampered_signature_xyz"
        with pytest.raises(ValueError, match="Invalid token signature"):
            decode_jwt_token(tampered_token)

    def test_forged_superadmin_claim_in_token_rejected_by_db_auth(self, client, db_session, auth_tenants):
        # A malicious client crafts a token with is_superadmin=True for a regular user
        forged_token = create_jwt_token({
            "sub": "usr_member_a_v2",
            "email": "member_a_v2@alpha.corp",
            "ver": 1,
            "is_superadmin": True,  # Forged claim in token!
        })

        # The user tries to access a superadmin-only endpoint (apply sync catalog)
        response = client.post(
            "/api/v1/specialists/sync/apply",
            headers={"Authorization": f"Bearer {forged_token}"},
        )
        # Server verifies is_superadmin authoritatively from DB, where usr_member_a_v2 is NOT superadmin
        assert response.status_code == 403
        assert "Superadmin" in get_error_message(response)

    def test_algorithm_confusion_rejected(self):
        # Craft a token with alg='none'
        header_b64 = _b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode("utf-8"))
        payload_b64 = _b64encode(json.dumps({"sub": "usr_owner_a_v2", "exp": int((datetime.utcnow() + timedelta(hours=1)).timestamp())}).encode("utf-8"))
        none_token = f"{header_b64}.{payload_b64}."
        with pytest.raises(ValueError, match="Algorithm confusion rejected"):
            decode_jwt_token(none_token)


# ==============================================================================
# P0 — SEC-02: USER REVOCATION AND DYNAMIC AUTHORIZATION
# ==============================================================================

class TestSEC02UserRevocationDynamicAuth:

    def test_active_user_succeeds(self, client, auth_tenants):
        response = client.get(
            "/api/v1/recruitment/workforce",
            headers={"Authorization": f"Bearer {auth_tenants['owner_a']}"},
        )
        assert response.status_code == 200

    def test_inactive_user_receives_401(self, client, db_session, auth_tenants):
        # Deactivate user in DB
        u = db_session.query(UserModel).filter(UserModel.id == "usr_owner_a_v2").first()
        u.is_active = False
        db_session.commit()

        response = client.get(
            "/api/v1/recruitment/workforce",
            headers={"Authorization": f"Bearer {auth_tenants['owner_a']}"},
        )
        assert response.status_code == 401
        assert "deactivated" in get_error_message(response).lower()

        # Restore
        u.is_active = True
        db_session.commit()

    def test_deleted_user_receives_401(self, client, db_session):
        # Create temp user, issue token, then delete user
        temp_user = UserModel(
            id="usr_to_delete",
            email="temp@alpha.corp",
            hashed_password=hash_password("TempSecret123!"),
            full_name="Temp User",
            is_active=True,
            token_version=1,
        )
        db_session.add(temp_user)
        db_session.commit()

        token = create_access_token("usr_to_delete", "temp@alpha.corp", token_version=1)

        db_session.delete(temp_user)
        db_session.commit()

        response = client.get(
            "/api/v1/recruitment/workforce",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 401

    def test_revoked_org_membership_receives_403(self, client, db_session, auth_tenants):
        # Remove usr_admin_a_v2 membership from org_alpha_v2
        mem = db_session.query(OrganizationMemberModel).filter(
            OrganizationMemberModel.user_id == "usr_admin_a_v2",
            OrganizationMemberModel.organization_id == "org_alpha_v2",
        ).first()
        db_session.delete(mem)
        db_session.commit()

        # Attempt to access Org A workforce
        response = client.get(
            "/api/v1/recruitment/workforce",
            headers={"Authorization": f"Bearer {auth_tenants['admin_a']}"},
        )
        assert response.status_code == 403
        assert "not belong to any organization" in get_error_message(response)

    def test_downgraded_role_loses_privileged_access_immediately(self, client, db_session, auth_tenants):
        # Owner A downgrades Admin A to Member A in DB
        mem = db_session.query(OrganizationMemberModel).filter(
            OrganizationMemberModel.user_id == "usr_admin_a_v2",
            OrganizationMemberModel.organization_id == "org_alpha_v2",
        ).first()
        mem.role = ROLE_ORGANIZATION_MEMBER
        db_session.commit()

        # Admin A attempts to recruit a specialist (requires PERM_RECRUIT_SPECIALIST which requires ADMIN/OWNER)
        response = client.post(
            "/api/v1/recruitment/recruit",
            json={"specialist_id": "test-spec"},
            headers={"Authorization": f"Bearer {auth_tenants['admin_a']}"},
        )
        assert response.status_code == 403
        assert "Permission" in get_error_message(response)

    def test_token_version_revocation_invalidates_session(self, client, db_session, auth_tenants):
        # User owner_a currently has valid token with ver=1
        resp1 = client.get(
            "/api/v1/recruitment/workforce",
            headers={"Authorization": f"Bearer {auth_tenants['owner_a']}"},
        )
        assert resp1.status_code == 200

        # Revoke user tokens (increments token_version to 2)
        revoke_user_tokens(db_session, "usr_owner_a_v2")

        # Previous token with ver=1 must now be rejected with 401
        resp2 = client.get(
            "/api/v1/recruitment/workforce",
            headers={"Authorization": f"Bearer {auth_tenants['owner_a']}"},
        )
        assert resp2.status_code == 401
        assert "revoked" in get_error_message(resp2).lower()


# ==============================================================================
# P0 — SEC-03: COMPLETE TENANT ISOLATION FOR CORE EXECUTION APIs
# ==============================================================================

class TestSEC03TenantIsolationExecutionAPIs:

    def test_anonymous_request_rejected(self, client):
        for path in ["/api/v1/tasks", "/api/v1/agents", "/api/v1/workflows", "/api/v1/approvals", "/api/v1/memories"]:
            resp = client.get(path)
            assert resp.status_code in (401, 403), f"Path {path} did not reject anonymous request"

    def test_org_a_cannot_read_or_mutate_org_b_task(self, client, db_session, auth_tenants):
        # Create Agent and Task for Org B
        agent_b = AgentModel(
            id="agent_b_task_worker",
            organization_id="org_beta_v2",
            name="Beta Task Worker",
            role="Specialist",
        )
        task_b = TaskModel(
            id="task_beta_isolated_1",
            organization_id="org_beta_v2",
            assigned_agent_id=agent_b.id,
            title="Secret Project Beta",
            description="Beta confidential",
            status="pending",
        )
        db_session.add_all([agent_b, task_b])
        db_session.commit()

        # Org A tries to GET task B detail -> 404
        resp_get = client.get(
            f"/api/v1/tasks/{task_b.id}",
            headers={"Authorization": f"Bearer {auth_tenants['owner_a']}"},
        )
        assert resp_get.status_code == 404

        # Org A tries to CANCEL task B -> 404
        resp_cancel = client.post(
            f"/api/v1/tasks/{task_b.id}/cancel",
            headers={"Authorization": f"Bearer {auth_tenants['owner_a']}"},
        )
        assert resp_cancel.status_code == 404

        # Org A lists tasks -> task_b is NOT present
        resp_list = client.get(
            "/api/v1/tasks",
            headers={"Authorization": f"Bearer {auth_tenants['owner_a']}"},
        )
        assert resp_list.status_code == 200
        task_ids = [t["id"] for t in resp_list.json()]
        assert task_b.id not in task_ids

    def test_org_a_cannot_inspect_org_b_agent(self, client, db_session, auth_tenants):
        agent_b = AgentModel(
            id="agent_beta_secret",
            organization_id="org_beta_v2",
            name="Beta Specialist",
            role="Finance Specialist",
            status="idle",
        )
        db_session.add(agent_b)
        db_session.commit()

        resp = client.get(
            f"/api/v1/agents/{agent_b.id}",
            headers={"Authorization": f"Bearer {auth_tenants['owner_a']}"},
        )
        assert resp.status_code == 404

    def test_org_a_cannot_access_org_b_workflow(self, client, db_session, auth_tenants):
        agent_b = AgentModel(
            id="agent_beta_wf_worker",
            organization_id="org_beta_v2",
            name="Beta WF Worker",
            role="Specialist",
        )
        wf_b = TaskModel(
            id="wf_beta_secret",
            organization_id="org_beta_v2",
            assigned_agent_id=agent_b.id,
            task_type="workflow",
            title="Beta Workflow",
            description="Beta confidential workflow",
            status="pending",
        )
        db_session.add_all([agent_b, wf_b])
        db_session.commit()

        resp = client.get(
            f"/api/v1/workflows/{wf_b.id}",
            headers={"Authorization": f"Bearer {auth_tenants['owner_a']}"},
        )
        assert resp.status_code == 404

    def test_org_a_cannot_approve_org_b_task(self, client, db_session, auth_tenants):
        agent_b = AgentModel(
            id="agent_beta_appr_worker",
            organization_id="org_beta_v2",
            name="Beta Appr Worker",
            role="Specialist",
        )
        task_b = TaskModel(
            id="task_beta_appr_1",
            organization_id="org_beta_v2",
            assigned_agent_id=agent_b.id,
            title="Beta Approval Task",
            description="Beta test",
            status="waiting_approval",
        )
        appr_b = ApprovalModel(
            id="appr_beta_1",
            task_id=task_b.id,
            action_type="high_risk_spend",
            description="Approve beta spend",
            status="pending",
        )
        db_session.add_all([agent_b, task_b, appr_b])
        db_session.commit()

        resp = client.post(
            f"/api/v1/approvals/{appr_b.id}/approve",
            headers={"Authorization": f"Bearer {auth_tenants['owner_a']}"},
        )
        assert resp.status_code == 404

    def test_org_a_cannot_search_org_b_memories(self, client, db_session, auth_tenants):
        mem_b = MemoryModel(
            id="mem_beta_secret",
            title="Secret Beta Knowledge",
            content="Beta secret financial figures",
            status="active",
            memory_type="shared",
            scope_type="shared",
            scope_id="org_beta_v2",
            owner_agent_id=None,
        )
        db_session.add(mem_b)
        db_session.commit()

        # Org A searches memories
        resp = client.get(
            "/api/v1/memories?query=financial",
            headers={"Authorization": f"Bearer {auth_tenants['owner_a']}"},
        )
        assert resp.status_code == 200
        mem_ids = [m["memory"]["id"] for m in resp.json().get("items", [])]
        assert mem_b.id not in mem_ids

    def test_cross_tenant_agent_assignment_rejected(self, db_session, auth_tenants):
        agent_b = AgentModel(
            id="agent_b_cross_test",
            organization_id="org_beta_v2",
            name="Beta Agent",
            role="Specialist",
        )
        db_session.add(agent_b)
        db_session.commit()

        svc = TaskService()
        from backend.app.schemas.task import TaskCreate
        with pytest.raises(ValidationError, match="does not belong to tenant"):
            svc.create_task(
                db=db_session,
                task_in=TaskCreate(
                    title="Cross Tenant Attempt",
                    description="Trying to assign agent B",
                    assigned_agent_id=agent_b.id,
                ),
                organization_id="org_alpha_v2",
            )

    def test_client_supplied_org_id_in_body_ignored(self, client, auth_tenants, db_session):
        agent_a = AgentModel(
            id="agent_alpha_task_worker",
            organization_id="org_alpha_v2",
            name="Alpha Task Worker",
            role="Specialist",
        )
        db_session.add(agent_a)
        db_session.commit()

        resp = client.post(
            "/api/v1/tasks",
            json={
                "title": "Org A Task with Forged Body Org ID",
                "description": "Attempting to spoof tenant",
                "assigned_agent_id": agent_a.id,
                "organization_id": "org_beta_v2",  # Client tries to spoof Org B!
            },
            headers={"Authorization": f"Bearer {auth_tenants['owner_a']}"},
        )
        assert resp.status_code == 201
        created = resp.json()
        assert created["organization_id"] == "org_alpha_v2"

    @pytest.mark.asyncio
    async def test_websocket_tenant_isolation(self):
        wm = WebSocketManager()
        ws_a = AsyncMock()
        ws_b = AsyncMock()
        wm.active_connections.add(ws_a)
        wm.active_connections.add(ws_b)
        wm.connection_metadata[ws_a] = {"organization_id": "org_alpha_v2", "is_superadmin": False}
        wm.connection_metadata[ws_b] = {"organization_id": "org_beta_v2", "is_superadmin": False}

        envelope_a = {
            "event_id": "evt_test_1",
            "event_type": "task.created",
            "payload": {"organization_id": "org_alpha_v2"},
        }
        await wm.broadcast_envelope(envelope_a)

        assert ws_a.send_text.called
        assert not ws_b.send_text.called


# ==============================================================================
# P0 — VER-01: PINNED SPECIALIST PROMPT MUST REACH MODEL INVOCATION
# ==============================================================================

class TestVER01PinnedSpecialistPromptExecution:

    @pytest.mark.asyncio
    async def test_pinned_specialist_prompt_reaches_provider_e2e(self, db_session, auth_tenants):
        # 1. Create Specialist Definition with all non-null fields
        spec = SpecialistDefinitionModel(
            id="spec_prompt_test_1",
            slug="data-analyst-pinned",
            name="Data Analyst Pinned",
            role="Data Analyst",
            division="engineering",
            department="Engineering",
            system_instructions="Default Unpinned System Prompt",
            core_mission="Initial Mission",
            critical_rules="Do not leak data.",
            assigned_tools=["workspace_list"],
            permission_level=0,
            lifecycle_state="AVAILABLE",
            source_path="specialists/engineering/data-analyst-pinned.md",
            content_hash="hash_spec_test_1",
            raw_content="---\nname: Data Analyst Pinned\n---\nInitial Mission",
            version=1,
        )
        db_session.add(spec)
        db_session.flush()

        # 2. Create Specialist Version 1 (with pinned prompt A)
        v1_instructions = "PINNED_SPECIALIST_PROMPT_VERSION_1_UNIQUE_SIGNATURE"
        ver1 = SpecialistVersionModel(
            id="spec_ver_prompt_1",
            specialist_id=spec.id,
            version=1,
            content_hash="hash_ver_1",
            raw_content=f"---\nname: Data Analyst Pinned\n---\n{v1_instructions}",
            parsed_metadata={
                "system_instructions": v1_instructions,
                "core_mission": v1_instructions,
                "critical_rules": "Rule V1",
                "assigned_tools": ["workspace_list"],
                "permission_level": 0,
            },
            change_summary="v1 creation",
        )
        db_session.add(ver1)
        db_session.commit()

        # 3. Recruit Employee on Version 1
        agent_id = f"ag_pinned_test_{uuid.uuid4().hex[:6]}"
        agent = AgentModel(
            id=agent_id,
            organization_id="org_alpha_v2",
            name="Pinned Agent Alice",
            role="Data Analyst",
            status="idle",
        )
        rec = RecruitmentRecordModel(
            agent_id=agent_id,
            organization_id="org_alpha_v2",
            specialist_definition_id=spec.id,
            specialist_version_id=ver1.id,
            specialist_version_num=1,
            department="Engineering",
            lifecycle_state="ACTIVE",
        )
        db_session.add_all([agent, rec])
        db_session.commit()

        # 4. Update Catalog to Version 2 (upstream update)
        v2_instructions = "PINNED_SPECIALIST_PROMPT_VERSION_2_UPDATED"
        ver2 = SpecialistVersionModel(
            id="spec_ver_prompt_2",
            specialist_id=spec.id,
            version=2,
            content_hash="hash_ver_2",
            raw_content=f"---\nname: Data Analyst Pinned\n---\n{v2_instructions}",
            parsed_metadata={
                "system_instructions": v2_instructions,
                "core_mission": v2_instructions,
                "critical_rules": "Rule V2",
                "assigned_tools": ["workspace_list", "file_read"],
                "permission_level": 1,
            },
            change_summary="v2 update",
        )
        spec.version = 2
        spec.system_instructions = v2_instructions
        db_session.add(ver2)
        db_session.commit()

        # 5. Create Task assigned to Alice
        task = TaskModel(
            id=f"task_pinned_{uuid.uuid4().hex[:6]}",
            organization_id="org_alpha_v2",
            assigned_agent_id=agent.id,
            title="Analyze Sales Data",
            description="Run analysis",
            status="pending",
        )
        db_session.add(task)
        db_session.commit()

        # 6. Capture exact system_instruction received by Executor / LLM Provider
        captured_system_instructions = []

        async def fake_executor_run(*args, **kwargs):
            from backend.app.agent_runtime.executor import ExecutionResult
            captured_system_instructions.append(kwargs.get("system_instruction"))
            return ExecutionResult(status="completed", result_summary="Executed successfully")

        dispatcher = TaskDispatcher()
        with patch.object(dispatcher.executor, "run", side_effect=fake_executor_run), \
             patch.object(dispatcher.planner, "create_plan", new_callable=AsyncMock) as mock_plan:
            mock_plan.return_value = MagicMock(objective="test", steps=[])
            await dispatcher._process_task(task.id, db=db_session)

        # 7. Assert that Version 1's instruction was forwarded to executor!
        assert len(captured_system_instructions) == 1
        delivered_instruction = captured_system_instructions[0]
        assert delivered_instruction is not None
        assert v1_instructions in delivered_instruction
        assert v2_instructions not in delivered_instruction
        assert "You are the autonomous AI Agent" not in delivered_instruction  # No generic fallback

    @pytest.mark.asyncio
    async def test_cross_tenant_task_execution_blocked_in_dispatcher(self, db_session, auth_tenants):
        agent_b = AgentModel(
            id="agent_beta_worker_exec",
            organization_id="org_beta_v2",
            name="Beta Worker Exec",
            role="Specialist",
            status="idle",
        )
        task_a = TaskModel(
            id="task_alpha_illicit_assign",
            organization_id="org_alpha_v2",
            assigned_agent_id=agent_b.id,  # Mismatched tenant!
            title="Cross Tenant Run",
            description="Cross tenant run description",
            status="pending",
        )
        db_session.add_all([agent_b, task_a])
        db_session.commit()

        dispatcher = TaskDispatcher()
        await dispatcher._process_task(task_a.id, db=db_session)

        # Task must be cancelled immediately with cross-tenant error
        refreshed_task = db_session.query(TaskModel).filter(TaskModel.id == task_a.id).first()
        assert refreshed_task.status == "cancelled"
        assert "cross-tenant violation" in refreshed_task.error_message


# ==============================================================================
# P1 — VER-02: LEGACY VERSION VISIBILITY
# ==============================================================================

class TestVER02LegacyVersionVisibility:

    @pytest.mark.asyncio
    async def test_unpinned_legacy_employee_execution_blocked(self, db_session, auth_tenants):
        legacy_spec = SpecialistDefinitionModel(
            id="legacy-spec-block",
            slug="legacy-spec-block-slug",
            name="Legacy Spec Block",
            role="Worker",
            division="operations",
            department="Operations",
            system_instructions="Legacy prompt",
            source_path="specialists/operations/legacy_block.md",
            content_hash="legacy_hash_block",
            raw_content="legacy raw content",
            version=1,
        )
        db_session.add(legacy_spec)
        db_session.flush()

        agent_legacy = AgentModel(
            id="agent_legacy_unpinned_1",
            organization_id="org_alpha_v2",
            name="Legacy Unpinned Agent",
            role="Legacy Worker",
            status="idle",
        )
        rec_legacy = RecruitmentRecordModel(
            agent_id=agent_legacy.id,
            organization_id="org_alpha_v2",
            specialist_definition_id=legacy_spec.id,
            specialist_version_id=None,  # Missing version!
            is_legacy_unpinned=True,     # Flagged legacy unpinned!
            department="Operations",
            lifecycle_state="ACTIVE",
        )
        task_legacy = TaskModel(
            id="task_legacy_blocked_1",
            organization_id="org_alpha_v2",
            assigned_agent_id=agent_legacy.id,
            title="Legacy Worker Task",
            description="Legacy worker task description",
            status="pending",
        )
        db_session.add_all([agent_legacy, rec_legacy, task_legacy])
        db_session.commit()

        dispatcher = TaskDispatcher()
        await dispatcher._process_task(task_legacy.id, db=db_session)

        refreshed_task = db_session.query(TaskModel).filter(TaskModel.id == task_legacy.id).first()
        assert refreshed_task.status == "cancelled"
        assert "unpinned legacy version" in refreshed_task.error_message

    def test_legacy_audit_endpoint(self, client, auth_tenants, db_session):
        legacy_spec = SpecialistDefinitionModel(
            id="legacy-spec-audit",
            slug="legacy-spec-audit-slug",
            name="Legacy Spec Audit",
            role="Worker",
            division="operations",
            department="Operations",
            system_instructions="Legacy prompt",
            source_path="specialists/operations/legacy_audit.md",
            content_hash="legacy_hash_audit",
            raw_content="legacy raw content",
            version=1,
        )
        db_session.add(legacy_spec)
        db_session.flush()

        agent_legacy = AgentModel(
            id="agent_legacy_audit_1",
            organization_id="org_alpha_v2",
            name="Legacy Audit Agent",
            role="Worker",
        )
        rec_legacy = RecruitmentRecordModel(
            agent_id=agent_legacy.id,
            organization_id="org_alpha_v2",
            specialist_definition_id=legacy_spec.id,
            specialist_version_id=None,
            is_legacy_unpinned=True,
            department="Operations",
            lifecycle_state="ACTIVE",
        )
        db_session.add_all([agent_legacy, rec_legacy])
        db_session.commit()

        resp = client.get(
            "/api/v1/recruitment/legacy-audit",
            headers={"Authorization": f"Bearer {auth_tenants['owner_a']}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["organization_id"] == "org_alpha_v2"
        assert "unpinned_count" in data
        assert "unpinned_employees" in data
        legacy_agents = [e["agent_id"] for e in data["unpinned_employees"]]
        assert "agent_legacy_audit_1" in legacy_agents
        for emp in data["unpinned_employees"]:
            assert emp["execution_blocked"] is True


# ==============================================================================
# P1 — VER-03: IMMUTABLE SPECIALIST CONFIGURATION SNAPSHOTS
# ==============================================================================

class TestVER03ImmutableSpecialistVersionSnapshots:

    def test_specialist_version_parsed_metadata_snapshot(self, db_session):
        spec = SpecialistDefinitionModel(
            id="spec_test_snap_def",
            slug="security-auditor-snap",
            name="Security Auditor Specialist",
            division="security",
            department="Security",
            role="Security Auditor",
            system_instructions="Review code strictly within workspace.",
            source_path="specialists/security/auditor.md",
            content_hash="hash_spec_snap",
            raw_content="raw content",
            version=1,
        )
        db_session.add(spec)
        db_session.flush()

        snapshot_data = {
            "name": "Security Auditor Specialist",
            "role": "Security Auditor",
            "division": "security",
            "department": "Security",
            "assigned_tools": ["workspace_list", "file_read"],
            "declared_tools": ["file_read"],
            "permission_level": 0,
            "critical_rules": "Never execute external binaries.",
            "system_instructions": "Review code for vulnerabilities strictly within workspace.",
            "core_mission": "Audit application security.",
            "workflows": "Step 1: Check AST. Step 2: Report.",
            "deliverables": "Security report",
            "success_metrics": "Zero false negatives",
            "capabilities": ["code review", "static analysis"],
            "skills": ["file_read"],
        }
        ver = SpecialistVersionModel(
            id="spec_ver_snapshot_test",
            specialist_id=spec.id,
            version=1,
            content_hash="hash_ver_snap",
            raw_content="--- frontmatter ---",
            parsed_metadata=snapshot_data,
            change_summary="Initial snapshot test",
        )
        db_session.add(ver)
        db_session.commit()

        refreshed_ver = db_session.query(SpecialistVersionModel).filter(SpecialistVersionModel.id == ver.id).first()
        assert refreshed_ver.parsed_metadata == snapshot_data
        assert refreshed_ver.parsed_metadata["assigned_tools"] == ["workspace_list", "file_read"]
        assert refreshed_ver.parsed_metadata["permission_level"] == 0

    def test_markdown_cannot_grant_platform_or_tenant_privileges(self):
        from backend.app.agent_runtime.tools.base import ToolPermissionLevel

        agent = AgentModel(id="ag_perm_test", name="Perm Test", role="Analyst")
        spec = SpecialistDefinitionModel(
            id="spec_perm_test",
            slug="perm-test-spec",
            name="Perm Test",
            division="engineering",
            department="Engineering",
            role="Analyst",
            system_instructions="test",
            source_path="test.md",
            content_hash="hash",
            raw_content="raw",
            permission_level=1,
        )
        ver = SpecialistVersionModel(
            id="ver_perm_test",
            specialist_id=spec.id,
            version=1,
            content_hash="hash_v1",
            raw_content="raw",
            parsed_metadata={
                "assigned_tools": ["workspace_write"],
                "permission_level": 1,
                "role": "PLATFORM_SUPERADMIN_FORGERY",  # Malicious text in markdown
            }
        )
        # Registering agent in runtime creates ToolPermissionLevel(1)
        recruitment_service._register_in_runtime(agent, spec, "Engineering", ver)
        agent_def = default_agent_registry.get(agent.id)
        assert agent_def is not None
        assert agent_def.permission_level == ToolPermissionLevel.LEVEL_1_WORKSPACE_WRITE


# ==============================================================================
# P2 — CONC-01: MULTI-THREADED WORKSTATION STRESS TESTS
# ==============================================================================

class TestCONC01WorkstationConcurrencyStress:

    def test_multithreaded_workstation_allocation_stress(self):
        """
        Stress test with 10 concurrent threads competing for 4 physical desks
        in Executive department in an isolated SQLite database using real database connections.
        Verifies:
        - Exactly 4 physical desks allocated (desk numbers 1 through 4, unique).
        - Exactly 6 virtual overflow allocations (is_virtual == True).
        - Zero duplicate physical desks.
        - Zero unhandled exceptions or transaction deadlocks.
        """
        temp_dir = tempfile.mkdtemp()
        db_path = os.path.join(temp_dir, "stress_workstation.db")
        stress_engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False, "timeout": 30},
        )
        Base.metadata.create_all(bind=stress_engine)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=stress_engine)

        # Seed organization
        init_db = SessionLocal()
        org = OrganizationModel(id="org_stress_test", name="Stress Corp", slug="stress-corp", is_active=True)
        init_db.add(org)
        init_db.commit()
        init_db.close()

        num_threads = 10
        results = []
        errors = []

        def allocate_worker(worker_id):
            db = SessionLocal()
            agent_id = f"stress_agent_{worker_id}"
            try:
                # Add agent row
                agent = AgentModel(id=agent_id, organization_id="org_stress_test", name=f"Stress Agent {worker_id}", role="Executive")
                db.add(agent)
                db.commit()

                # Allocate workstation in Executive department (max_physical_desks = 4)
                alloc = workstation_service.allocate_workstation(
                    db=db,
                    agent_id=agent_id,
                    department="Executive",
                    organization_id="org_stress_test",
                    force_virtual=False,
                )
                db.commit()
                results.append({
                    "agent_id": alloc.agent_id,
                    "is_virtual": alloc.is_virtual,
                    "desk_number": alloc.desk_number,
                    "status": alloc.allocation_status,
                })
            except Exception as e:
                errors.append(f"Worker {worker_id} failed: {str(e)}")
            finally:
                db.close()

        threads = [threading.Thread(target=allocate_worker, args=(i,)) for i in range(num_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0, f"Encountered concurrency errors: {errors}"
        assert len(results) == num_threads, f"Expected {num_threads} allocations, got {len(results)}"

        # Analyze physical vs virtual allocations
        physical_allocs = [r for r in results if not r["is_virtual"]]
        virtual_allocs = [r for r in results if r["is_virtual"]]

        assert len(physical_allocs) == 4, f"Expected exactly 4 physical desks, got {len(physical_allocs)}"
        assert len(virtual_allocs) == 6, f"Expected exactly 6 virtual desks, got {len(virtual_allocs)}"

        physical_desk_numbers = [r["desk_number"] for r in physical_allocs]
        assert sorted(physical_desk_numbers) == [1, 2, 3, 4], f"Unexpected desk numbers: {physical_desk_numbers}"
        assert len(set(physical_desk_numbers)) == 4, "Duplicate physical desk numbers allocated!"

        for v in virtual_allocs:
            assert v["is_virtual"] is True

        stress_engine.dispose()
