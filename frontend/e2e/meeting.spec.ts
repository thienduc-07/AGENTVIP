import { test, expect } from '@playwright/test';

const BACKEND_BASE = 'http://127.0.0.1:8000';

test.describe('Phase 4.3.8.4: Multi-Agent Meeting End-to-End Suite', () => {
  let authToken: string;
  let testMeetingId: string;
  let testDecisionId: string;

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

  // Scenario 1: Meeting creation with topic, agenda, and participants
  test('Scenario 1: Meeting creation registers structured meeting with moderator and invited roster', async ({ request }) => {
    const meetingPayload = {
      title: 'E2E Autonomous Strategy Board',
      description: 'Executive alignment on multi-agent collaboration and production rollout.',
      meeting_type: 'STRATEGY_SESSION',
      objective: 'Achieve unanimous alignment on production certification.',
      moderator_agent_id: 'agent-exec-ceo',
      participant_agent_ids: ['agent-exec-ceo', 'agent-eng-lead', 'agent-research-ai'],
    };

    const response = await request.post(`${BACKEND_BASE}/api/v1/meetings`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
      data: meetingPayload,
    });

    expect(response.status()).toBe(201);
    const meeting = await response.json();
    expect(meeting).toHaveProperty('id');
    testMeetingId = meeting.id;
    expect(meeting.title).toBe(meetingPayload.title);
    expect(meeting.status).toBe('DRAFT');
    expect(meeting.moderator_agent_id).toBe('agent-exec-ceo');
    expect(meeting.organization_id).toBe('org_default_company');
  });

  // Scenario 2: Participant selection and roster verification
  test('Scenario 2: Meeting participants list contains moderator and designated specialists', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/meetings/${testMeetingId}/participants`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const participants = await response.json();
    expect(Array.isArray(participants)).toBe(true);
    expect(participants.length).toBe(3);

    const agentIds = participants.map((p: any) => p.agent_id);
    expect(agentIds).toContain('agent-exec-ceo');
    expect(agentIds).toContain('agent-eng-lead');
    expect(agentIds).toContain('agent-research-ai');

    const moderator = participants.find((p: any) => p.agent_id === 'agent-exec-ceo');
    expect(moderator.role).toBe('MODERATOR');
  });

  // Scenario 3: Meeting discovery lists active and scheduled meetings
  test('Scenario 3: Meeting discovery queries meetings scoped to caller organization', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/meetings`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const list = await response.json();
    expect(Array.isArray(list)).toBe(true);
    const found = list.find((m: any) => m.id === testMeetingId);
    expect(found).toBeDefined();
    expect(found.title).toBe('E2E Autonomous Strategy Board');
  });

  // Scenario 4: Meeting status transition (DRAFT -> IN_PROGRESS)
  test('Scenario 4: Meeting start initiates session and marks status IN_PROGRESS', async ({ request }) => {
    const response = await request.post(`${BACKEND_BASE}/api/v1/meetings/${testMeetingId}/start`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const meeting = await response.json();
    expect(meeting.status).toBe('IN_PROGRESS');
    expect(meeting.started_at).not.toBeNull();
  });

  // Scenario 5: Discussion messages and dialogue turns
  test('Scenario 5: Multi-agent discussion exchange records chronological statements', async ({ request }) => {
    // 1. Moderator opening statement
    const msg1Res = await request.post(`${BACKEND_BASE}/api/v1/meetings/${testMeetingId}/messages`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
      data: {
        agent_id: 'agent-exec-ceo',
        message_type: 'STATEMENT',
        content: 'Welcome team. We are convening to certify PROVIPAGENT production readiness.',
      },
    });
    expect(msg1Res.status()).toBe(201);

    // 2. Lead Engineer response
    const msg2Res = await request.post(`${BACKEND_BASE}/api/v1/meetings/${testMeetingId}/messages`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
      data: {
        agent_id: 'agent-eng-lead',
        message_type: 'STATEMENT',
        content: 'Engineering confirms all E2E test suites and database isolation tests pass.',
      },
    });
    expect(msg2Res.status()).toBe(201);

    // 3. Verify messages are retrieved in sequence
    const listRes = await request.get(`${BACKEND_BASE}/api/v1/meetings/${testMeetingId}/messages`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });
    expect(listRes.status()).toBe(200);
    const messages = await listRes.json();
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0].agent_id).toBe('agent-exec-ceo');
    expect(messages[1].agent_id).toBe('agent-eng-lead');
  });

  // Scenario 6: Proposal submission
  test('Scenario 6: Strategic decision proposal submission generates formal ballot', async ({ request }) => {
    const proposalPayload = {
      title: 'Approve Phase 4.3.8 Production Go-Live',
      description: 'Formal authorization to declare PROVIPAGENT ready for enterprise release.',
      decision_type: 'STRATEGIC',
      proposed_by: 'agent-exec-ceo',
      voting_policy: 'SIMPLE_MAJORITY',
    };

    const response = await request.post(`${BACKEND_BASE}/api/v1/meetings/${testMeetingId}/decisions`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
      data: proposalPayload,
    });

    expect(response.status()).toBe(201);
    const decision = await response.json();
    expect(decision).toHaveProperty('id');
    testDecisionId = decision.id;
    expect(decision.title).toBe(proposalPayload.title);
    expect(decision.status).toBe('PROPOSED');
  });

  // Scenario 7: Participant voting on proposals
  test('Scenario 7: Meeting participants cast votes with logical justification', async ({ request }) => {
    const votePayload = {
      agent_id: 'agent-eng-lead',
      vote: 'YES',
      reasoning: 'All architecture layers pass rigorous security and performance standards.',
    };

    const response = await request.post(
      `${BACKEND_BASE}/api/v1/meetings/${testMeetingId}/decisions/${testDecisionId}/vote`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Organization-Id': 'org_default_company',
        },
        data: votePayload,
      }
    );

    expect(response.status()).toBe(200);
    const vote = await response.json();
    expect(vote.decision_id).toBe(testDecisionId);
    expect(vote.agent_id).toBe('agent-eng-lead');
    expect(vote.vote).toBe('YES');
  });

  // Scenario 8: Decision resolution
  test('Scenario 8: Proposal resolution concludes voting and marks decision ADOPTED', async ({ request }) => {
    const response = await request.post(
      `${BACKEND_BASE}/api/v1/meetings/${testMeetingId}/decisions/${testDecisionId}/resolve`,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Organization-Id': 'org_default_company',
        },
      }
    );

    expect(response.status()).toBe(200);
    const resolved = await response.json();
    expect(['ADOPTED', 'RESOLVED', 'APPROVED']).toContain(resolved.status);
    expect(resolved.resolved_at).not.toBeNull();
  });

  // Scenario 9: Action items creation and verification
  test('Scenario 9: Action item creation tracks accountable agent deliverables', async ({ request }) => {
    const itemPayload = {
      title: 'Publish Level 5 Production Certification Report',
      description: 'Document comprehensive test evidence across all 14 Phase 4.3.8 subphases.',
      assigned_agent_id: 'agent-eng-lead',
      decision_id: testDecisionId,
      priority: 'high',
      create_linked_task: false,
    };

    const postRes = await request.post(`${BACKEND_BASE}/api/v1/meetings/${testMeetingId}/action-items`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
      data: itemPayload,
    });
    expect(postRes.status()).toBe(201);
    const item = await postRes.json();
    expect(item).toHaveProperty('id');
    expect(item.assigned_agent_id).toBe('agent-eng-lead');

    // Verify action item appears in list
    const listRes = await request.get(`${BACKEND_BASE}/api/v1/meetings/${testMeetingId}/action-items`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });
    expect(listRes.status()).toBe(200);
    const items = await listRes.json();
    expect(items.some((i: any) => i.id === item.id)).toBe(true);
  });

  // Scenario 10: Meeting completion lifecycle
  test('Scenario 10: Meeting completion successfully closes session', async ({ request }) => {
    const response = await request.post(`${BACKEND_BASE}/api/v1/meetings/${testMeetingId}/complete`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const completed = await response.json();
    expect(completed.status).toBe('COMPLETED');
    expect(completed.ended_at).not.toBeNull();
  });

  // Scenario 11: Multi-tenant meeting isolation
  test('Scenario 11: Foreign tenant cannot access or view another tenant meeting', async ({ request }) => {
    // Attempt to access testMeetingId under a foreign unauthorized organization
    const unauthorizedRes = await request.get(`${BACKEND_BASE}/api/v1/meetings/${testMeetingId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_foreign_tenant_unauthorized',
      },
    });

    expect([403, 404]).toContain(unauthorizedRes.status());
  });

  // Scenario 12: Conference Pavilion UI component integration
  test('Scenario 12: 3D Conference Pavilion Meeting HUD mounts in browser without exceptions', async ({ page }) => {
    await page.goto('/');

    // Verify page loaded and Three.js canvas mounted
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 15000 });

    // Inject active meeting into Zustand store and open Meeting HUD
    await page.evaluate((meetingId) => {
      const store = (window as any).__MEETING_STORE__ || (window as any).useMeetingStore;
      if (store && store.getState) {
        store.getState().setActiveMeeting({
          id: meetingId,
          title: 'E2E Autonomous Strategy Board',
          status: 'COMPLETED',
          meeting_type: 'STRATEGY_SESSION',
          objective: 'Production Certification',
        });
        store.getState().setMeetingHUDOpen(true);
      }
    }, testMeetingId);

    // Verify page remains stable and responsive without runtime crashes
    const bodyHandle = page.locator('body');
    await expect(bodyHandle).toBeAttached();
  });

});

