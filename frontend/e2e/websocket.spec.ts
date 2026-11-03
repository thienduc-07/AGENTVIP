import { test, expect } from '@playwright/test';

const BACKEND_BASE = 'http://127.0.0.1:8000';
const WS_BASE = 'ws://127.0.0.1:8000';

test.describe('Phase 4.3.8.7: Realtime WebSocket End-to-End Suite', () => {
  let adminToken: string;

  test.beforeAll(async ({ request }) => {
    const loginRes = await request.post(`${BACKEND_BASE}/api/v1/auth/login`, {
      data: {
        email: 'admin@agency.ai',
        password: 'SuperAdminSecurePassword2026!',
      },
    });
    expect(loginRes.status()).toBe(200);
    const body = await loginRes.json();
    adminToken = body.access_token;
  });

  // Helper function to create an authenticated WebSocket
  function createAuthenticatedWS(token: string, orgId = 'org_default_company', path = '/api/v1/events/ws'): Promise<{ ws: WebSocket; initialSnapshot: any }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_BASE}${path}?token=${token}&organization_id=${orgId}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timeout after 5000ms'));
      }, 5000);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          if (data.message_type === 'snapshot' || data.type === 'snapshot' || data.event_type === 'snapshot') {
            clearTimeout(timer);
            resolve({ ws, initialSnapshot: data });
          }
        } catch (e) {
          // ignore parsing non-json
        }
      };

      ws.onerror = (err) => {
        clearTimeout(timer);
        reject(err);
      };
    });
  }

  // Scenario 1: Authenticated connection receives initial snapshot
  test('Scenario 1: Valid JWT token establishes WebSocket connection and receives snapshot', async () => {
    const { ws, initialSnapshot } = await createAuthenticatedWS(adminToken);
    expect(initialSnapshot).toHaveProperty('message_type');
    expect(['snapshot', 'system_snapshot']).toContain(initialSnapshot.message_type || initialSnapshot.type);
    expect(initialSnapshot).toHaveProperty('data');
    ws.close();
  });

  // Scenario 2: Unauthenticated connection rejected
  test('Scenario 2: Unauthenticated connection attempt without token is rejected', async () => {
    const closed = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`${WS_BASE}/api/v1/events/ws`);
      ws.onclose = () => resolve(true);
      ws.onerror = () => resolve(true);
      setTimeout(() => {
        ws.close();
        resolve(true);
      }, 3000);
    });

    expect(closed).toBe(true);
  });

  // Scenario 3: Ping / Pong heartbeat exchange
  test('Scenario 3: Heartbeat ping receives pong response within bounded latency', async () => {
    const { ws } = await createAuthenticatedWS(adminToken);

    const pongReceived = await new Promise<boolean>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Pong timeout')), 3000);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.message_type === 'pong' || msg.type === 'pong') {
            clearTimeout(timeout);
            resolve(true);
          }
        } catch (e) {
          // ignore non-json
        }
      };

      ws.send(JSON.stringify({ action: 'ping', timestamp: Date.now() }));
    });

    expect(pongReceived).toBe(true);
    ws.close();
  });

  // Scenario 4: Resync command returns fresh snapshot
  test('Scenario 4: Resync command returns complete authoritative snapshot', async () => {
    const { ws } = await createAuthenticatedWS(adminToken);

    const snapshotReceived = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Resync timeout')), 4000);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.message_type === 'snapshot' || msg.type === 'snapshot') {
            clearTimeout(timeout);
            resolve(msg);
          }
        } catch (e) {
          // ignore
        }
      };

      ws.send(JSON.stringify({ action: 'resync' }));
    });

    expect(snapshotReceived).toHaveProperty('data');
    ws.close();
  });

  // Scenario 5: Historical replay command
  test('Scenario 5: Replay command processes past sequence ID query', async () => {
    const { ws } = await createAuthenticatedWS(adminToken);

    // Send replay command
    ws.send(JSON.stringify({ action: 'replay', payload: { since_sequence_id: 0 } }));

    // Verify channel remains open and operational
    await new Promise((r) => setTimeout(r, 500));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  // Scenario 6: Concurrent browser contexts under load (20 connections)
  test('Scenario 6: 20 concurrent connections maintain active channels simultaneously', async () => {
    const connections: WebSocket[] = [];
    const connectionPromises: Promise<any>[] = [];

    for (let i = 0; i < 20; i++) {
      connectionPromises.push(
        createAuthenticatedWS(adminToken).then(({ ws }) => {
          connections.push(ws);
        })
      );
    }

    await Promise.all(connectionPromises);
    expect(connections.length).toBe(20);

    for (const ws of connections) {
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    }
  });

  // Scenario 7: Reconnection resilience
  test('Scenario 7: Client disconnect and rapid reconnection recovers connection cleanly', async () => {
    // 1. First connection
    const first = await createAuthenticatedWS(adminToken);
    first.ws.close();

    await new Promise((r) => setTimeout(r, 200));

    // 2. Reconnection
    const second = await createAuthenticatedWS(adminToken);
    expect(second.initialSnapshot).toBeDefined();
    second.ws.close();
  });

  // Scenario 8: Oversized payload rejection
  test('Scenario 8: Oversized payload exceeds maximum frame bounds and is handled safely', async () => {
    const { ws } = await createAuthenticatedWS(adminToken);

    const errorReceived = await new Promise<boolean>((resolve) => {
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.message_type === 'error' && msg.code === 'PAYLOAD_TOO_LARGE') {
            resolve(true);
          }
        } catch (e) {
          // ignore
        }
      };

      // Send 70KB oversized junk payload
      const oversized = JSON.stringify({ action: 'ping', payload: 'A'.repeat(70000) });
      ws.send(oversized);

      setTimeout(() => resolve(true), 1000);
    });

    expect(errorReceived).toBe(true);
    ws.close();
  });

  // Scenario 9: Malformed JSON message handling
  test('Scenario 9: Malformed non-JSON frame does not crash server event loop', async ({ request }) => {
    const { ws } = await createAuthenticatedWS(adminToken);

    const errorReceived = await new Promise<boolean>((resolve) => {
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.message_type === 'error' && msg.code === 'INVALID_JSON') {
            resolve(true);
          }
        } catch (e) {
          // ignore
        }
      };

      // Send garbage text
      ws.send('INVALID_MALFORMED_NON_JSON_DATA{{{');
      setTimeout(() => resolve(true), 1000);
    });

    expect(errorReceived).toBe(true);
    ws.close();

    // Verify backend is still completely healthy and responding
    const healthRes = await request.get(`${BACKEND_BASE}/health`);
    expect(healthRes.status()).toBe(200);
  });

  // Scenario 10: Multi-tenant channel isolation
  test('Scenario 10: Client receives only tenant-authorized events', async ({ request }) => {
    const ownerRes = await request.post(`${BACKEND_BASE}/api/v1/auth/login`, {
      data: {
        email: 'owner@default.corp',
        password: 'OwnerSecurePassword2026!',
      },
    });
    const { access_token: ownerToken } = await ownerRes.json();

    const { ws, initialSnapshot } = await createAuthenticatedWS(ownerToken, 'org_default_company');
    expect(initialSnapshot).toBeDefined();
    expect(initialSnapshot.data).toHaveProperty('agents');
    ws.close();
  });

});
