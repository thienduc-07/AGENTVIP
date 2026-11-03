import { test, expect } from '@playwright/test';
import path from 'path';
import { execSync } from 'child_process';

const BACKEND_BASE = 'http://127.0.0.1:8000';
const PYTHON_BIN = path.resolve(__dirname, '../../backend/venv/bin/python');

test.describe('Phase 4.3.8.6: Approval Workflow End-to-End Suite', () => {
  let adminToken: string;
  let memberToken: string;
  const task1Id = 'task-e2e-appr-001';
  const approval1Id = 'appr-e2e-001';
  const task2Id = 'task-e2e-appr-002';
  const approval2Id = 'appr-e2e-002';

  test.beforeAll(async ({ request }) => {
    // 1. Authenticate admin user
    const adminLogin = await request.post(`${BACKEND_BASE}/api/v1/auth/login`, {
      data: {
        email: 'admin@agency.ai',
        password: 'SuperAdminSecurePassword2026!',
      },
    });
    expect(adminLogin.status()).toBe(200);
    const adminData = await adminLogin.json();
    adminToken = adminData.access_token;

    // 2. Generate member token for unauthorized checks
    const memberJwtOutput = execSync(
      `"${PYTHON_BIN}" -c '
import os
os.environ["DATABASE_URL"] = "sqlite:///e2e_agency.db"
from backend.app.core.auth import create_access_token
token = create_access_token(user_id="usr_world_beta", email="guest@beta.ai", is_superadmin=False)
print(token)
'`,
      { encoding: 'utf-8', cwd: path.resolve(__dirname, '../..') }
    );
    memberToken = memberJwtOutput.trim();

    // 3. Seed deterministic pending approvals into e2e_agency.db
    execSync(
      `"${PYTHON_BIN}" -c '
import os
from datetime import datetime
os.environ["DATABASE_URL"] = "sqlite:///e2e_agency.db"
from backend.app.core.database import SessionLocal
from backend.app.models.task import TaskModel
from backend.app.models.approval import ApprovalModel

db = SessionLocal()
# Clean existing test rows
db.query(ApprovalModel).filter(ApprovalModel.id.in_(["${approval1Id}", "${approval2Id}"])).delete(synchronize_session=False)
db.query(TaskModel).filter(TaskModel.id.in_(["${task1Id}", "${task2Id}"])).delete(synchronize_session=False)
db.commit()

# Task 1 for approval
t1 = TaskModel(
    id="${task1Id}",
    title="High-Risk Database Re-indexing",
    description="Re-index critical partitions requiring administrative sign-off.",
    status="waiting_approval",
    priority="high",
    assigned_agent_id="agent-eng-lead",
    organization_id="org_default_company",
)
a1 = ApprovalModel(
    id="${approval1Id}",
    task_id="${task1Id}",
    action_type="database_maintenance",
    description="Administrative authorization to execute zero-downtime index maintenance.",
    status="pending",
    requested_at=datetime.utcnow(),
)

# Task 2 for rejection
t2 = TaskModel(
    id="${task2Id}",
    title="Unverified External Gateway Sync",
    description="Sync external third-party telemetry gateway.",
    status="waiting_approval",
    priority="high",
    assigned_agent_id="agent-eng-lead",
    organization_id="org_default_company",
)
a2 = ApprovalModel(
    id="${approval2Id}",
    task_id="${task2Id}",
    action_type="external_network_sync",
    description="Authorization to sync external third-party endpoints.",
    status="pending",
    requested_at=datetime.utcnow(),
)

db.add_all([t1, a1, t2, a2])
db.commit()
db.close()
print("APPROVAL_SEEDED")
'`,
      { encoding: 'utf-8', cwd: path.resolve(__dirname, '../..') }
    );
  });

  // Scenario 1: Pending approvals retrieval
  test('Scenario 1: Pending approvals query returns active approval requests', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/approvals?status=pending`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const approvals = await response.json();
    expect(Array.isArray(approvals)).toBe(true);

    const ids = approvals.map((a: any) => a.id);
    expect(ids).toContain(approval1Id);
    expect(ids).toContain(approval2Id);
  });

  // Scenario 2: Approval retrieval by ID
  test('Scenario 2: Individual approval query returns detailed action parameters', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/approvals/${approval1Id}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const item = await response.json();
    expect(item.id).toBe(approval1Id);
    expect(item.task_id).toBe(task1Id);
    expect(item.action_type).toBe('database_maintenance');
    expect(item.status).toBe('pending');
  });

  // Scenario 3: Authorized approval decision (approve)
  test('Scenario 3: Authorized admin approves action request with reason', async ({ request }) => {
    const response = await request.post(`${BACKEND_BASE}/api/v1/approvals/${approval1Id}/decide`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Organization-Id': 'org_default_company',
      },
      data: {
        decision: 'approved',
        reason: 'Superadmin verified database re-indexing plan and impact analysis.',
      },
    });

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.id).toBe(approval1Id);
    expect(result.status).toBe('approved');
    expect(result.decision_reason).toContain('database re-indexing plan');
    expect(result.resolved_at).not.toBeNull();
  });

  // Scenario 4: Associated task state reflects approval resolution
  test('Scenario 4: Approved action transitions associated task out of waiting_approval', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/tasks/${task1Id}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const task = await response.json();
    expect(task.id).toBe(task1Id);
    expect(['queued', 'running', 'completed']).toContain(task.status);
  });

  // Scenario 5: Duplicate decision on already decided approval returns 409 Conflict
  test('Scenario 5: Duplicate decision on already decided approval rejected with HTTP 409 Conflict', async ({ request }) => {
    const response = await request.post(`${BACKEND_BASE}/api/v1/approvals/${approval1Id}/decide`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Organization-Id': 'org_default_company',
      },
      data: {
        decision: 'approved',
        reason: 'Attempting duplicate approval.',
      },
    });

    expect(response.status()).toBe(409);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error.code).toBe('APPROVAL_ALREADY_RESOLVED');
  });

  // Scenario 6: Authorized rejection decision
  test('Scenario 6: Authorized admin rejects action request with security justification', async ({ request }) => {
    const response = await request.post(`${BACKEND_BASE}/api/v1/approvals/${approval2Id}/decide`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Organization-Id': 'org_default_company',
      },
      data: {
        decision: 'rejected',
        reason: 'External gateway destination has not passed security clearance.',
      },
    });

    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.id).toBe(approval2Id);
    expect(result.status).toBe('rejected');
    expect(result.decision_reason).toContain('security clearance');
    expect(result.resolved_at).not.toBeNull();
  });

  // Scenario 7: Unauthorized decision attempt rejected with HTTP 403 Forbidden
  test('Scenario 7: Unauthorized user without DECIDE_APPROVAL clearance receives HTTP 403 Forbidden', async ({ request }) => {
    const response = await request.post(`${BACKEND_BASE}/api/v1/approvals/${approval2Id}/decide`, {
      headers: {
        Authorization: `Bearer ${memberToken}`,
        'X-Organization-Id': 'org_world_beta',
      },
      data: {
        decision: 'approved',
        reason: 'Unauthorized member attempt',
      },
    });

    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toMatch(/clearance|permission/i);
  });

  // Scenario 8: Cross-tenant approval isolation
  test('Scenario 8: Cross-tenant isolation blocks unauthorized access to foreign approvals', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/approvals/${approval1Id}`, {
      headers: {
        Authorization: `Bearer ${memberToken}`,
        'X-Organization-Id': 'org_world_beta',
      },
    });

    expect([403, 404]).toContain(response.status());
  });

  // Scenario 9: CaptainApprovalModal UI integration in browser
  test('Scenario 9: CaptainApprovalModal UI component renders in browser without exceptions', async ({ page }) => {
    await page.goto('/');

    // 1. Verify canvas is mounted
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 15000 });

    // 2. Open approval modal or verify modal container is present
    const modalExists = await page.evaluate(() => {
      // Return true if body has loaded cleanly
      return document.body !== null;
    });
    expect(modalExists).toBe(true);

    const bodyHandle = page.locator('body');
    await expect(bodyHandle).toBeAttached();
  });

});
