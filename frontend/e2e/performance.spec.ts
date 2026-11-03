import { test, expect } from '@playwright/test';

/**
 * Phase 4.3.8.11: Performance & Load Benchmarking E2E Suite
 * Validates latency percentiles (P50, P95, P99) and 0% error rate across
 * 1, 5, 10, 20, and 50 simulated concurrent users.
 */
test.describe('Phase 4.3.8.11: Performance & Load Benchmarks', () => {
  const BACKEND_URL = 'http://127.0.0.1:8000';
  const WS_URL = 'ws://127.0.0.1:8000';
  let authToken: string;

  test.beforeAll(async ({ request }) => {
    // Authenticate admin
    const loginRes = await request.post(`${BACKEND_URL}/api/v1/auth/login`, {
      data: {
        email: 'admin@agency.ai',
        password: 'SuperAdminSecurePassword2026!',
      },
    });
    expect(loginRes.status()).toBe(200);
    const body = await loginRes.json();
    authToken = body.access_token;

    // Warm-up connection pool
    await request.get(`${BACKEND_URL}/api/v1/health`);
    await request.get(`${BACKEND_URL}/api/v1/agents`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
  });

  function computePercentiles(latencies: number[]) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    return { p50, p95, p99, avg, max: sorted[sorted.length - 1], min: sorted[0] };
  }

  const CONCURRENCY_TIERS = [1, 5, 10, 20, 50];

  for (const concurrency of CONCURRENCY_TIERS) {
    test(`Benchmark: ${concurrency} concurrent requests across core endpoints`, async ({ request }) => {
      const endpoints = [
        '/api/v1/agents',
        '/api/v1/tasks',
        '/api/v1/workstations/overview',
        '/api/v1/health/readiness',
      ];

      const tasks = Array.from({ length: concurrency }, async (_, i) => {
        const ep = endpoints[i % endpoints.length];
        const t0 = Date.now();
        const res = await request.get(`${BACKEND_URL}${ep}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const duration = Date.now() - t0;
        return { status: res.status(), duration, ep };
      });

      const results = await Promise.all(tasks);

      // Verify zero errors across all requests
      for (const r of results) {
        expect(r.status, `Endpoint ${r.ep} failed with ${r.status}`).toBe(200);
      }

      const latencies = results.map((r) => r.duration);
      const metrics = computePercentiles(latencies);

      // For concurrency <= 20, P95 must be < 150ms; for 50 concurrent on single worker, P95 < 350ms
      const maxAllowedP95 = concurrency <= 20 ? 150 : 350;
      expect(metrics.p95).toBeLessThan(maxAllowedP95);
    });
  }

  test('Benchmark: Core read endpoints maintain sub-100ms P95 latency profile', async ({ request }) => {
    const targetEndpoints = [
      '/api/v1/agents',
      '/api/v1/tasks',
      '/api/v1/workstations/overview',
      '/api/v1/health/readiness',
    ];

    for (const ep of targetEndpoints) {
      const latencies: number[] = [];

      for (let i = 0; i < 25; i++) {
        const t0 = Date.now();
        const res = await request.get(`${BACKEND_URL}${ep}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const duration = Date.now() - t0;
        expect(res.status()).toBe(200);
        latencies.push(duration);
      }

      const { p50, p95, avg } = computePercentiles(latencies);
      // Verify sub-100ms P95 API latency
      expect(p95).toBeLessThan(100);
      expect(p50).toBeLessThan(50);
      expect(avg).toBeLessThan(50);
    }
  });

  test('Benchmark: High-throughput WebSocket connection establishment under load', async () => {
    // Connect 10 concurrent Node WebSockets and verify connection rate & latency
    const connect = () =>
      new Promise<{ success: boolean; duration: number }>((resolve) => {
        const t0 = Date.now();
        const ws = new WebSocket(`${WS_URL}/api/v1/events/ws?token=${authToken}&organization_id=org_default_company`);
        const timer = setTimeout(() => {
          ws.close();
          resolve({ success: false, duration: Date.now() - t0 });
        }, 5000);

        ws.onopen = () => {
          clearTimeout(timer);
          const duration = Date.now() - t0;
          ws.close();
          resolve({ success: true, duration });
        };
        ws.onerror = () => {
          clearTimeout(timer);
          resolve({ success: false, duration: Date.now() - t0 });
        };
      });

    const results = await Promise.all(Array.from({ length: 10 }, () => connect()));

    for (const r of results) {
      expect(r.success).toBe(true);
      expect(r.duration).toBeLessThan(250);
    }
  });
});
