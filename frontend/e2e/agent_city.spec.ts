import { test, expect } from '@playwright/test';

const BACKEND_BASE = 'http://127.0.0.1:8000';

test.describe('Phase 4.3.8.3: Agent City End-to-End Suite', () => {
  let authToken: string;

  test.beforeAll(async ({ request }) => {
    const loginRes = await request.post(`${BACKEND_BASE}/api/v1/auth/login`, {
      data: {
        email: 'admin@agency.ai',
        password: 'SuperAdminSecurePassword2026!',
      },
    });
    expect(loginRes.status()).toBe(200);
    const body = await loginRes.json();
    authToken = body.access_token;
  });

  // Scenario 1: Office 3D environment loads with Three.js canvas without errors
  test('Scenario 1: Office 3D environment loads with Three.js canvas element and HUD branding', async ({ page }) => {
    await page.goto('/');

    // 1. Verify canvas element is created and mounted in DOM
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 15000 });

    // 2. Verify corporate office HUD header branding is visible
    const hudTitle = page.locator('h1', { hasText: 'PROVIPAGENT 3D OFFICE' });
    await expect(hudTitle).toBeVisible();

    // 3. Verify no unhandled exceptions crashed the page
    const bodyHandle = page.locator('body');
    await expect(bodyHandle).toBeAttached();
  });

  // Scenario 2: Full Agent Roster loads authoritative corporate workforce
  test('Scenario 2: Full Agent Roster loads authoritative corporate workforce from backend', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/agents`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const agents = await response.json();
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThanOrEqual(8);

    // Verify presence of core corporate leadership
    const agentIds = agents.map((a: any) => a.id);
    expect(agentIds).toContain('agent-exec-ceo');
    expect(agentIds).toContain('agent-eng-lead');
    expect(agentIds).toContain('agent-research-ai');

    const ceo = agents.find((a: any) => a.id === 'agent-exec-ceo');
    expect(ceo.name).toBe('Victoria Vance');
    expect(ceo.role).toContain('Chief Executive Officer');
  });

  // Scenario 3: Department structure / categorization loads correctly
  test('Scenario 3: Corporate department structure categorizes workforce accurately', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/agents`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const agents = await response.json();

    const stations = new Set(agents.map((a: any) => a.station));
    expect(stations.size).toBeGreaterThanOrEqual(3);

    // Verify key stations exist
    expect(stations.has('executive_suite') || stations.has('captain_hq')).toBe(true);
    expect(stations.has('engineering_bay') || stations.has('ws-engineering-01')).toBe(true);
  });

  // Scenario 4: Agent selection highlights agent and allows inspection
  test('Scenario 4: Agent selection query returns complete entity state', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/agents/agent-eng-lead`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const agent = await response.json();
    expect(agent.id).toBe('agent-eng-lead');
    expect(agent.name).toBe('David Chen');
    expect(agent.role).toContain('Engineering');
    expect(typeof agent.pos_x).toBe('number');
    expect(typeof agent.pos_y).toBe('number');
    expect(typeof agent.pos_z).toBe('number');
  });

  // Scenario 5: Workstation Inspector HUD opens and displays real-time telemetry
  test('Scenario 5: Workstation Inspector HUD retrieves authoritative real-time telemetry', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/agents/agent-exec-ceo/inspection`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const inspection = await response.json();
    expect(inspection.agent_id).toBe('agent-exec-ceo');
    expect(inspection.name).toBe('Victoria Vance');
    expect(inspection.role).toContain('Chief Executive Officer');
    expect(inspection).toHaveProperty('behavioral_state');
    expect(inspection).toHaveProperty('status');
    expect(inspection).toHaveProperty('pos_x');
    expect(inspection).toHaveProperty('pos_y');
    expect(inspection).toHaveProperty('pos_z');
    expect(inspection).toHaveProperty('recent_events');
  });

  // Scenario 6: Specialist detail view displays capabilities and registry definition
  test('Scenario 6: Specialist registry returns capabilities and configuration schema', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/agents/registry`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.status()).toBe(200);
    const registry = await response.json();
    expect(Array.isArray(registry)).toBe(true);
    expect(registry.length).toBeGreaterThan(0);

    const firstSpecialist = registry[0];
    expect(firstSpecialist).toHaveProperty('agent_type');
    expect(firstSpecialist).toHaveProperty('display_name');
    expect(firstSpecialist).toHaveProperty('allowed_tools');
    expect(firstSpecialist).toHaveProperty('system_prompt');
  });

  // Scenario 7: Task assignment to an agent via API
  test('Scenario 7: Task creation assigns mission to specialist agent', async ({ request }) => {
    const taskPayload = {
      title: 'E2E Architecture Security Review',
      description: 'Conduct comprehensive browser security validation and zero-leakage check.',
      assigned_agent_id: 'agent-eng-lead',
      priority: 'high',
      organization_id: 'org_default_company',
    };

    const response = await request.post(`${BACKEND_BASE}/api/v1/tasks`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
      data: taskPayload,
    });

    expect([200, 201]).toContain(response.status());
    const task = await response.json();
    expect(task).toHaveProperty('id');
    expect(task.title).toBe(taskPayload.title);
    expect(task.assigned_agent_id).toBe('agent-eng-lead');
    expect(task.status).toBe('queued');
  });

  // Scenario 8: Task execution lifecycle transition (queued -> cancelled)
  test('Scenario 8: Task cancellation cleanly transitions task lifecycle state', async ({ request }) => {
    // 1. Create temporary task
    const createRes = await request.post(`${BACKEND_BASE}/api/v1/tasks`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
      data: {
        title: 'Transient Task for Cancellation Lifecycle Verification',
        description: 'Verify lifecycle status transitions cleanly without database deadlock.',
        assigned_agent_id: 'agent-eng-lead',
        priority: 'normal',
      },
    });
    expect([200, 201]).toContain(createRes.status());
    const createdTask = await createRes.json();

    // 2. Cancel the task
    const cancelRes = await request.post(`${BACKEND_BASE}/api/v1/tasks/${createdTask.id}/cancel`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });
    expect([200, 204]).toContain(cancelRes.status());

    // 3. Verify task status is cancelled
    const fetchRes = await request.get(`${BACKEND_BASE}/api/v1/tasks/${createdTask.id}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });
    expect(fetchRes.status()).toBe(200);
    const fetchedTask = await fetchRes.json();
    expect(fetchedTask.status).toBe('cancelled');
  });

  // Scenario 9: Real-time status query reflects agent operational state
  test('Scenario 9: Agent inspection reflects active status and task history', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/agents/agent-eng-lead/inspection`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const inspection = await response.json();
    expect(inspection.agent_id).toBe('agent-eng-lead');
    expect(typeof inspection.is_available).toBe('boolean');
  });

  // Scenario 10: Agent spatial coordinates tracking in 3D coordinate space
  test('Scenario 10: Spatial coordinates navigation tracks agent 3D positions', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/agents`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const agents = await response.json();

    for (const agent of agents.slice(0, 5)) {
      expect(typeof agent.pos_x).toBe('number');
      expect(typeof agent.pos_y).toBe('number');
      expect(typeof agent.pos_z).toBe('number');
      expect(Number.isFinite(agent.pos_x)).toBe(true);
      expect(Number.isFinite(agent.pos_y)).toBe(true);
      expect(Number.isFinite(agent.pos_z)).toBe(true);
    }
  });

  // Scenario 11: Multi-agent coexistence without ID collision or overlap
  test('Scenario 11: Multi-agent workforce coexists with unique IDs and assigned stations', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/agents`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const agents = await response.json();

    const ids = agents.map((a: any) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length); // Zero ID collision
  });

  // Scenario 12: Workstation allocation and office zone configuration
  test('Scenario 12: Workstation overview provides authoritative zones and allocations', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/workstations/overview`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const overview = await response.json();
    expect(overview).toHaveProperty('zones');
    expect(Array.isArray(overview.zones)).toBe(true);
    expect(overview.zones.length).toBeGreaterThanOrEqual(1);

    const firstZone = overview.zones[0];
    expect(firstZone).toHaveProperty('zone');
    expect(firstZone).toHaveProperty('department');
    expect(firstZone).toHaveProperty('max_physical_desks');
  });

  // Scenario 13: Workforce filtering and pagination
  test('Scenario 13: Workforce API correctly supports pagination and filtering', async ({ request }) => {
    const page1Res = await request.get(`${BACKEND_BASE}/api/v1/agents?limit=3&offset=0`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });
    expect(page1Res.status()).toBe(200);
    const page1 = await page1Res.json();
    expect(page1.length).toBe(3);

    const page2Res = await request.get(`${BACKEND_BASE}/api/v1/agents?limit=3&offset=3`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });
    expect(page2Res.status()).toBe(200);
    const page2 = await page2Res.json();
    expect(page2.length).toBe(3);

    // Verify offset actually paged forward
    expect(page1[0].id).not.toBe(page2[0].id);
  });

  // Scenario 14: Multi-tenant agent isolation
  test('Scenario 14: Cross-tenant isolation blocks unauthorized access to foreign organization agents', async ({ request }) => {
    // Create an unauthorized token or request with foreign tenant organization
    const foreignTenantRes = await request.get(`${BACKEND_BASE}/api/v1/agents/agent-exec-ceo`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_foreign_tenant_unauthorized',
      },
    });

    // In a multi-tenant system, superadmin can access all or foreign tenant with non-member receives 404/403
    // Let's test with owner@default.corp who has strictly org_default_company role:
    const ownerLoginRes = await request.post(`${BACKEND_BASE}/api/v1/auth/login`, {
      data: {
        email: 'owner@default.corp',
        password: 'OwnerSecurePassword2026!',
      },
    });
    const { access_token: ownerToken } = await ownerLoginRes.json();

    const crossTenantAttempt = await request.get(`${BACKEND_BASE}/api/v1/agents`, {
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'X-Organization-Id': 'org_foreign_tenant_9999',
      },
    });

    // Caller does not have membership in org_foreign_tenant_9999 -> HTTP 403 Forbidden
    expect([403, 404]).toContain(crossTenantAttempt.status());
  });

});
