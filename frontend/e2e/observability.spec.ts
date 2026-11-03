import { test, expect } from '@playwright/test';

/**
 * Phase 4.3.8.10: Observability, Health Probes & Readiness E2E Suite
 */
test.describe('Phase 4.3.8.10: Observability & Health Probes', () => {
  const BACKEND_URL = 'http://127.0.0.1:8000';

  let superadminToken: string;

  test.beforeAll(async ({ request }) => {
    // Authenticate superadmin
    const loginRes = await request.post(`${BACKEND_URL}/api/v1/auth/login`, {
      data: {
        email: 'admin@agency.ai',
        password: 'SuperAdminSecurePassword2026!',
      },
    });
    expect(loginRes.status()).toBe(200);
    const body = await loginRes.json();
    superadminToken = body.access_token;
    expect(superadminToken).toBeTruthy();
  });

  test('Scenario 1: Base /api/v1/health responds with 200 OK and database connectivity', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/v1/health`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.service).toBe('ai-agent-city-api');
    expect(data.database).toBe('connected');
  });

  test('Scenario 2: Liveness probe /api/v1/health/liveness responds with 200 and uptime', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/v1/health/liveness`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('alive');
    expect(data.service).toBe('ai-agent-city-api');
    expect(typeof data.uptime_seconds).toBe('number');
    expect(data.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(data.timestamp).toBeTruthy();
  });

  test('Scenario 3: Readiness probe /api/v1/health/readiness returns ready and component checks', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/v1/health/readiness`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ready');
    expect(data.checks).toBeDefined();

    // Database check
    expect(data.checks.database.status).toBe('connected');
    expect(typeof data.checks.database.latency_ms).toBe('number');
    expect(data.checks.database.latency_ms).toBeLessThan(100);

    // Memory check
    expect(data.checks.memory.healthy).toBe(true);
    expect(data.checks.memory.percent).toBeLessThan(98);

    // Disk check
    expect(data.checks.disk.healthy).toBe(true);
    expect(data.checks.disk.percent).toBeLessThan(99);

    // Subsystem checks
    expect(typeof data.checks.subsystems.websocket_active_clients).toBe('number');
    expect(data.unready_reasons).toHaveLength(0);
  });

  test('Scenario 4: Metrics endpoint /api/v1/health/metrics provides host and process telemetry', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/v1/health/metrics`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.service).toBe('ai-agent-city-api');
    expect(data.process.threads).toBeGreaterThan(0);
    expect(data.process.memory_rss_mb).toBeGreaterThan(0);
    expect(data.system.total_memory_mb).toBeGreaterThan(0);
    expect(typeof data.connections.websocket_active).toBe('number');
  });

  test('Scenario 5: 50 concurrent health probe requests maintain 100% success rate with zero 500 errors', async ({ request }) => {
    const endpoints = [
      '/api/v1/health',
      '/api/v1/health/liveness',
      '/api/v1/health/readiness',
      '/api/v1/health/metrics',
    ];

    const requests = Array.from({ length: 50 }, (_, i) => {
      const ep = endpoints[i % endpoints.length];
      return request.get(`${BACKEND_URL}${ep}`);
    });

    const responses = await Promise.all(requests);
    for (const res of responses) {
      expect(res.status()).toBe(200);
    }
  });

  test('Scenario 6: LLM routing diagnostics endpoint enforces authentication and yields secure telemetry', async ({ request }) => {
    // 1. Unauthenticated should fail with 401
    const unauthRes = await request.get(`${BACKEND_URL}/api/v1/health/llm-routing`);
    expect(unauthRes.status()).toBe(401);

    // 2. Authenticated should succeed
    const authRes = await request.get(`${BACKEND_URL}/api/v1/health/llm-routing`, {
      headers: {
        Authorization: `Bearer ${superadminToken}`,
      },
    });
    expect(authRes.status()).toBe(200);
    const data = await authRes.json();
    expect(data.organization_id).toBe('org_default_company');
    expect(data.routing_mode).toBeDefined();
    expect(typeof data.registered_models_count).toBe('number');

    // Ensure no secret API keys leaked
    const textBody = await authRes.text();
    expect(textBody).not.toContain('sk-or-');
    expect(textBody).not.toContain('SECRET_KEY');
  });
});

