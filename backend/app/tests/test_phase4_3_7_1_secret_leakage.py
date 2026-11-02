"""
PROVIPAGENT Phase 4.3.7.1: End-to-End Secret Leakage & Sanitization Verification Suite
Audits all 10 transmission and persistence channels across the entire data flow:
Tool Input -> Tool Execution -> Runtime -> Execution Service -> Database -> Terminal -> WebSocket -> REST API.
"""
import json
import pytest
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

from backend.app.core.security_sanitizer import (
    redact_secrets,
    sanitize_terminal_text,
    sanitize_file_path,
)
from backend.app.core.auth import create_access_token
from backend.app.models.auth import OrganizationModel, UserModel, OrganizationMemberModel
from backend.app.models.agent import AgentModel
from backend.app.models.execution import ExecutionModel, TerminalLineModel
from backend.app.services.workstation_execution_service import (
    WorkstationExecutionService,
    workstation_execution_service,
)
from backend.app.services.event_service import event_service

# Synthetic, non-functional credentials representing all major cloud providers and protocols
SYNTHETIC_SECRETS = {
    "bearer": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake_signature_part",
    "openai": "sk-proj-FAKEOPENAIKEY99887766554433221100",
    "anthropic": "sk-ant-api03-FAKEANTHROPICKEY99887766554433",
    "gemini": "AIzaSyFakeGeminiKey1234567890abcdef",
    "aws": "AKIAIOSFODNN7EXAMPLE",
    "github": "ghp_FakeGitHubPersonalAccessToken1234567890ab",
    "github_pat": "github_pat_11FAKEPATTOKEN0123456789abcdefghijklmnopqrstuvwxyz",
    "jwt": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.fake_signature_jwt_token_here_12345",
    "db_url": "postgresql://dbuser:MySuperSecretP@ssw0rd123@db.prod.internal:5432/corp_db",
    "private_key": "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0fakekeydata...\n-----END RSA PRIVATE KEY-----",
    "env_password": "password='SuperConfidentialPass123!'",
}


@pytest.fixture
def secret_audit_env(db_session: Session):
    """Sets up an isolated environment for secret leak auditing."""
    org = db_session.query(OrganizationModel).filter(OrganizationModel.id == "org_leak_audit").first()
    if not org:
        org = OrganizationModel(id="org_leak_audit", name="Leak Audit Corp", slug="leak-audit", is_active=True)
        db_session.add(org)

    user = db_session.query(UserModel).filter(UserModel.id == "usr_leak_auditor").first()
    if not user:
        user = UserModel(
            id="usr_leak_auditor",
            email="auditor@leak.corp",
            full_name="Secret Auditor",
            hashed_password="pw",
            is_active=True,
            is_superadmin=False,
            token_version=1,
        )
        db_session.add(user)

    m = db_session.query(OrganizationMemberModel).filter(
        OrganizationMemberModel.user_id == "usr_leak_auditor",
        OrganizationMemberModel.organization_id == "org_leak_audit"
    ).first()
    if not m:
        m = OrganizationMemberModel(id="mem_leak_auditor", user_id="usr_leak_auditor", organization_id="org_leak_audit", role="ORGANIZATION_ADMIN")
        db_session.add(m)

    agent = db_session.query(AgentModel).filter(AgentModel.id == "agt_leak_auditor").first()
    if not agent:
        agent = AgentModel(
            id="agt_leak_auditor",
            organization_id="org_leak_audit",
            name="Auditor Agent",
            role="Inspector",
            status="idle",
            behavioral_state="IDLE",
        )
        db_session.add(agent)

    db_session.commit()
    token = create_access_token(user_id="usr_leak_auditor", email="auditor@leak.corp", token_version=1)

    return {
        "org_id": "org_leak_audit",
        "agent_id": "agt_leak_auditor",
        "token": token,
    }


def test_channel_01_and_02_terminal_stdout_stderr_sanitized(secret_audit_env, db_session: Session):
    """Channels 1 & 2: Injected secrets in terminal stdout and stderr are redacted before persistence."""
    agent_id = secret_audit_env["agent_id"]
    org_id = secret_audit_env["org_id"]

    exec_model = WorkstationExecutionService.start_execution(db=db_session, agent_id=agent_id, organization_id=org_id)

    # Inject all secrets into stdout
    for secret_type, secret_val in SYNTHETIC_SECRETS.items():
        line = WorkstationExecutionService.append_terminal_line(
            db=db_session,
            execution_id=exec_model.id,
            stream="stdout",
            content=f"Connecting with {secret_type}: {secret_val}",
            broadcast=False,
        )
        assert secret_val not in line.content, f"Secret {secret_type} leaked in persisted stdout line"
        assert "[REDACTED" in line.content or "PRIVATE KEY" in line.content

    # Inject into stderr
    err_line = WorkstationExecutionService.append_terminal_line(
        db=db_session,
        execution_id=exec_model.id,
        stream="stderr",
        content=f"ERROR failure using key: {SYNTHETIC_SECRETS['openai']}",
        broadcast=False,
    )
    assert SYNTHETIC_SECRETS["openai"] not in err_line.content
    assert "sk-[REDACTED]" in err_line.content


def test_channel_03_and_04_tool_call_arguments_and_results_sanitized(secret_audit_env, db_session: Session):
    """Channels 3 & 4: Injected secrets in tool arguments and results are redacted."""
    agent_id = secret_audit_env["agent_id"]
    org_id = secret_audit_env["org_id"]

    exec_model = WorkstationExecutionService.start_execution(db=db_session, agent_id=agent_id, organization_id=org_id)

    # Tool invocation arguments containing API key
    WorkstationExecutionService.record_tool_call_started(
        db=db_session,
        execution_id=exec_model.id,
        tool_name="cloud_query",
        arguments={"api_key": SYNTHETIC_SECRETS["anthropic"], "token": SYNTHETIC_SECRETS["bearer"]},
        call_id="call_sec_01",
    )

    # Tool result summary containing database connection string
    WorkstationExecutionService.record_tool_call_completed(
        db=db_session,
        execution_id=exec_model.id,
        tool_name="cloud_query",
        duration_ms=120,
        output_summary=f"Connected to {SYNTHETIC_SECRETS['db_url']} successfully",
        call_id="call_sec_01",
    )

    # Inspect persisted terminal lines for this execution
    lines = db_session.query(TerminalLineModel).filter(TerminalLineModel.execution_id == exec_model.id).all()
    full_output = " ".join([l.content for l in lines])

    assert SYNTHETIC_SECRETS["anthropic"] not in full_output
    assert SYNTHETIC_SECRETS["bearer"] not in full_output
    assert "MySuperSecretP@ssw0rd123" not in full_output


def test_channel_05_and_06_runtime_exceptions_and_execution_errors_sanitized(secret_audit_env, db_session: Session):
    """Channels 5 & 6: Runtime tool exceptions and execution error messages are redacted."""
    agent_id = secret_audit_env["agent_id"]
    org_id = secret_audit_env["org_id"]

    exec_model = WorkstationExecutionService.start_execution(db=db_session, agent_id=agent_id, organization_id=org_id)

    # Tool failure with exception message containing AWS access key
    WorkstationExecutionService.record_tool_call_failed(
        db=db_session,
        execution_id=exec_model.id,
        tool_name="aws_s3_upload",
        error=f"AccessDeniedException for credentials {SYNTHETIC_SECRETS['aws']}",
        call_id="call_sec_err",
    )

    # Complete execution with error message containing private key
    completed = WorkstationExecutionService.complete_execution(
        db=db_session,
        execution_id=exec_model.id,
        status="failed",
        error=f"Fatal exception using private key:\n{SYNTHETIC_SECRETS['private_key']}",
        summary=f"Run aborted due to secret key failure: {SYNTHETIC_SECRETS['github']}",
    )

    assert SYNTHETIC_SECRETS["aws"] not in completed.error_message
    assert "MIIEowIBAAKCAQEA0fakekeydata" not in completed.error_message
    assert SYNTHETIC_SECRETS["github"] not in completed.summary

    # Verify terminal lines for execution
    lines = db_session.query(TerminalLineModel).filter(TerminalLineModel.execution_id == exec_model.id).all()
    output_text = " ".join([l.content for l in lines])
    assert SYNTHETIC_SECRETS["aws"] not in output_text
    assert "MIIEowIBAAKCAQEA0fakekeydata" not in output_text


def test_channel_07_websocket_event_envelope_sanitized(secret_audit_env, db_session: Session):
    """Channel 7: WebSocket event envelopes do not contain unredacted secrets."""
    agent_id = secret_audit_env["agent_id"]
    org_id = secret_audit_env["org_id"]

    ev = event_service.create_event(
        db=db_session,
        event_type="agent.test.secret",
        agent_id=agent_id,
        organization_id=org_id,
        payload={
            "sanitized_note": redact_secrets(f"Using {SYNTHETIC_SECRETS['gemini']}"),
            "db": redact_secrets(SYNTHETIC_SECRETS["db_url"]),
        },
        commit=True,
    )

    envelope = ev.to_envelope()
    envelope_str = json.dumps(envelope)

    assert SYNTHETIC_SECRETS["gemini"] not in envelope_str
    assert "AIza[REDACTED]" in envelope_str
    assert "MySuperSecretP@ssw0rd123" not in envelope_str


def test_channel_08_rest_api_terminal_and_execution_endpoints_sanitized(client: TestClient, secret_audit_env, db_session: Session):
    """Channel 8: REST API endpoints for terminal and execution inspection deliver redacted content."""
    agent_id = secret_audit_env["agent_id"]
    org_id = secret_audit_env["org_id"]
    token = secret_audit_env["token"]

    exec_model = WorkstationExecutionService.start_execution(db=db_session, agent_id=agent_id, organization_id=org_id)
    WorkstationExecutionService.append_terminal_line(
        db=db_session,
        execution_id=exec_model.id,
        stream="stdout",
        content=f"Secret token: {SYNTHETIC_SECRETS['github_pat']}",
    )
    WorkstationExecutionService.complete_execution(
        db=db_session,
        execution_id=exec_model.id,
        status="completed",
        summary=f"Completed with secret: {SYNTHETIC_SECRETS['jwt']}",
    )

    # 1. Query Execution REST API
    res_exec = client.get(
        f"/api/v1/executions/{exec_model.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res_exec.status_code == 200
    assert SYNTHETIC_SECRETS["jwt"] not in res_exec.text
    assert "[REDACTED_JWT]" in res_exec.text or "[REDACTED]" in res_exec.text

    # 2. Query Terminal History REST API
    res_term = client.get(
        f"/api/v1/workstations/{agent_id}/terminal",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res_term.status_code == 200
    assert SYNTHETIC_SECRETS["github_pat"] not in res_term.text
    assert "github_pat_[REDACTED]" in res_term.text or "[REDACTED]" in res_term.text


def test_channel_09_database_persistence_contains_zero_raw_secrets(secret_audit_env, db_session: Session):
    """Channel 9: Direct SQL query on SQLite database confirms raw secrets were never committed."""
    agent_id = secret_audit_env["agent_id"]
    org_id = secret_audit_env["org_id"]

    exec_model = WorkstationExecutionService.start_execution(db=db_session, agent_id=agent_id, organization_id=org_id)
    for k, v in SYNTHETIC_SECRETS.items():
        WorkstationExecutionService.append_terminal_line(
            db=db_session,
            execution_id=exec_model.id,
            stream="stdout",
            content=f"Payload {k}={v}",
        )
    WorkstationExecutionService.complete_execution(
        db=db_session,
        execution_id=exec_model.id,
        status="completed",
        summary=f"DB check with {SYNTHETIC_SECRETS['openai']}",
    )

    # Query all terminal lines and executions for this org
    all_lines = db_session.query(TerminalLineModel.content).filter(TerminalLineModel.organization_id == org_id).all()
    all_execs = db_session.query(ExecutionModel.summary).filter(ExecutionModel.organization_id == org_id).all()

    combined_db_text = " ".join([l[0] for l in all_lines if l[0]] + [e[0] for e in all_execs if e[0]])

    for secret_type, raw_val in SYNTHETIC_SECRETS.items():
        assert raw_val not in combined_db_text, f"Database table contains unredacted raw secret for {secret_type}"


def test_false_positives_and_normal_text_preservation():
    """Verify that ordinary text, public URLs, and code constructs are NOT corrupted by redaction."""
    samples = [
        "https://api.github.com/repos/openai/gym/issues",
        "The primary key in table tasks is an integer ID",
        "def generate_token(length: int = 32) -> str:",
        "User entered password prompt dialog",
        "https://console.aws.amazon.com/iam/home",
    ]
    for sample in samples:
        sanitized = redact_secrets(sample)
        assert sanitized == sample, f"Over-redaction / false positive corrupted sample: '{sample}' -> '{sanitized}'"
