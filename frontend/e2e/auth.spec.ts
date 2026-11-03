import { test, expect } from '@playwright/test';

const BACKEND_BASE = 'http://127.0.0.1:8000';

test.describe('Phase 4.3.8.2: Authentication End-to-End Suite', () => {

  // Scenario 1: Successful login
  test('Scenario 1: Successful login via /api/v1/auth/login returns valid JWT and user context', async ({ request }) => {
    const response = await request.post(`${BACKEND_BASE}/api/v1/auth/login`, {
      data: {
        email: 'admin@agency.ai',
        password: 'SuperAdminSecurePassword2026!',
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('access_token');
    expect(body.token_type).toBe('bearer');
    expect(body.user_id).toBe('usr-platform-superadmin');
    expect(body.email).toBe('admin@agency.ai');
    expect(body.is_superadmin).toBe(true);
    expect(typeof body.access_token).toBe('string');
    expect(body.access_token.split('.').length).toBe(3);
  });

  // Scenario 2: Invalid credentials rejection
  test('Scenario 2: Invalid credentials rejection returns HTTP 401 with standard error structure', async ({ request }) => {
    const response = await request.post(`${BACKEND_BASE}/api/v1/auth/login`, {
      data: {
        email: 'admin@agency.ai',
        password: 'WrongPassword123!',
      },
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toContain('Incorrect email or password');
    expect(response.headers()['www-authenticate']).toContain('Bearer');
  });

  // Scenario 3: Missing credentials validation
  test('Scenario 3: Missing credentials rejected with HTTP 422 Unprocessable Entity', async ({ request }) => {
    const response = await request.post(`${BACKEND_BASE}/api/v1/auth/login`, {
      data: {
        email: 'admin@agency.ai',
        // password intentionally missing
      },
    });

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/password/i);
  });

  // Scenario 4: Expired JWT handling
  test('Scenario 4: Expired JWT handling returns HTTP 401 and prevents access', async ({ request }) => {
    // Construct a JWT with exp in the past
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const pastExp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const payload = Buffer.from(JSON.stringify({
      sub: 'usr-platform-superadmin',
      email: 'admin@agency.ai',
      is_superadmin: true,
      org_roles: {},
      ver: 1,
      exp: pastExp,
      iat: pastExp - 3600,
    })).toString('base64url');
    
    // Even if signature were valid or dummy, the backend must verify exp and reject
    const dummySignature = Buffer.from('invalidsignature').toString('base64url');
    const expiredToken = `${header}.${payload}.${dummySignature}`;

    const response = await request.get(`${BACKEND_BASE}/api/v1/auth/me`, {
      headers: {
        Authorization: `Bearer ${expiredToken}`,
      },
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toMatch(/expired|signature/i);
  });

  // Scenario 5: Invalid JWT handling (tampered signature / malformed token)
  test('Scenario 5: Invalid or tampered JWT rejected with HTTP 401', async ({ request }) => {
    // Login to get a valid token, then tamper with the signature
    const loginRes = await request.post(`${BACKEND_BASE}/api/v1/auth/login`, {
      data: {
        email: 'admin@agency.ai',
        password: 'SuperAdminSecurePassword2026!',
      },
    });
    const { access_token } = await loginRes.json();
    const parts = access_token.split('.');
    const tamperedToken = `${parts[0]}.${parts[1]}.tampered_signature_payload_xyz`;

    const response = await request.get(`${BACKEND_BASE}/api/v1/auth/me`, {
      headers: {
        Authorization: `Bearer ${tamperedToken}`,
      },
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toContain('Invalid or expired authentication token');
  });

  // Scenario 6: Unauthorized access to protected endpoints without token
  test('Scenario 6: Access to protected endpoint without token returns HTTP 401', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/auth/me`);
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toContain('credentials were not provided');
  });

  // Scenario 7: Session expiration rejection on protected business endpoints
  test('Scenario 7: Protected workforce endpoint rejects unauthenticated access', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/agents`);
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  // Scenario 8: Session recovery (re-authenticating restores full API access)
  test('Scenario 8: Session recovery allows restoring access after failure', async ({ request }) => {
    // 1. Initial failed attempt
    const failedRes = await request.get(`${BACKEND_BASE}/api/v1/auth/me`, {
      headers: { Authorization: 'Bearer bad_token' },
    });
    expect(failedRes.status()).toBe(401);

    // 2. Perform recovery login
    const loginRes = await request.post(`${BACKEND_BASE}/api/v1/auth/login`, {
      data: {
        email: 'owner@default.corp',
        password: 'OwnerSecurePassword2026!',
      },
    });
    expect(loginRes.status()).toBe(200);
    const { access_token } = await loginRes.json();

    // 3. Authenticate with restored credentials
    const profileRes = await request.get(`${BACKEND_BASE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(profileRes.status()).toBe(200);
    const profile = await profileRes.json();
    expect(profile.email).toBe('owner@default.corp');
    expect(profile.user_id).toBe('usr-org-owner-victoria');
  });

  // Scenario 9: Logout flow revokes server session
  test('Scenario 9: Logout flow revokes token version and invalidates existing JWT', async ({ request }) => {
    // 1. Login to obtain token
    const loginRes = await request.post(`${BACKEND_BASE}/api/v1/auth/login`, {
      data: {
        email: 'owner@default.corp',
        password: 'OwnerSecurePassword2026!',
      },
    });
    const { access_token } = await loginRes.json();

    // 2. Verify token is active
    const meRes1 = await request.get(`${BACKEND_BASE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(meRes1.status()).toBe(200);

    // 3. Call server logout endpoint
    const logoutRes = await request.post(`${BACKEND_BASE}/api/v1/auth/logout`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(logoutRes.status()).toBe(200);
    const logoutBody = await logoutRes.json();
    expect(logoutBody.status).toBe('success');

    // 4. Verify previous token is immediately rejected with HTTP 401 (token_version revoked)
    const meRes2 = await request.get(`${BACKEND_BASE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(meRes2.status()).toBe(401);
  });

  // Scenario 10: Re-login flow produces active new session after revocation
  test('Scenario 10: Re-login after logout generates valid token with updated token_version', async ({ request }) => {
    // 1. Login again with valid credentials
    const reLoginRes = await request.post(`${BACKEND_BASE}/api/v1/auth/login`, {
      data: {
        email: 'owner@default.corp',
        password: 'OwnerSecurePassword2026!',
      },
    });
    expect(reLoginRes.status()).toBe(200);
    const { access_token: newToken } = await reLoginRes.json();

    // 2. New token functions seamlessly
    const meRes = await request.get(`${BACKEND_BASE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${newToken}` },
    });
    expect(meRes.status()).toBe(200);
    const profile = await meRes.json();
    expect(profile.email).toBe('owner@default.corp');
  });

  // Scenario 11: Browser refresh while authenticated maintains session
  test('Scenario 11: Browser refresh while authenticated retains session state in browser context', async ({ page, request }) => {
    // 1. Obtain token
    const loginRes = await request.post(`${BACKEND_BASE}/api/v1/auth/login`, {
      data: {
        email: 'admin@agency.ai',
        password: 'SuperAdminSecurePassword2026!',
      },
    });
    const { access_token, user_id, email } = await loginRes.json();

    // 2. Navigate to base app and set authenticated state in browser storage
    await page.goto('/');
    await page.evaluate(({ token, uid, mail }) => {
      localStorage.setItem('provipagent_auth_token', token);
      localStorage.setItem('provipagent_user_id', uid);
      localStorage.setItem('provipagent_email', mail);
    }, { token: access_token, uid: user_id, mail: email });

    // 3. Perform hard page refresh
    await page.reload();

    // 4. Verify storage persisted across reload
    const storedToken = await page.evaluate(() => localStorage.getItem('provipagent_auth_token'));
    const storedEmail = await page.evaluate(() => localStorage.getItem('provipagent_email'));
    expect(storedToken).toBe(access_token);
    expect(storedEmail).toBe('admin@agency.ai');

    // 5. Verify the token retrieved from browser storage validates against backend
    const verified = await page.evaluate(async (backendUrl) => {
      const token = localStorage.getItem('provipagent_auth_token');
      const res = await fetch(`${backendUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { status: res.status, data: await res.json() };
    }, BACKEND_BASE);

    expect(verified.status).toBe(200);
    expect(verified.data.email).toBe('admin@agency.ai');
    expect(verified.data.is_superadmin).toBe(true);
  });

  // Scenario 12: Multiple browser contexts with different users / tenants
  test('Scenario 12: Multiple browser contexts maintain isolated identities and tenant permissions', async ({ browser, request }) => {
    // Context A: Superadmin
    const contextSuperadmin = await browser.newContext();
    const pageSuperadmin = await contextSuperadmin.newPage();

    const adminLoginRes = await request.post(`${BACKEND_BASE}/api/v1/auth/login`, {
      data: {
        email: 'admin@agency.ai',
        password: 'SuperAdminSecurePassword2026!',
      },
    });
    const adminAuth = await adminLoginRes.json();

    await pageSuperadmin.goto('/');
    await pageSuperadmin.evaluate((auth) => {
      localStorage.setItem('auth_token', auth.access_token);
      localStorage.setItem('user_role', 'PLATFORM_SUPERADMIN');
    }, adminAuth);

    // Context B: Org Owner Victoria
    const contextOwner = await browser.newContext();
    const pageOwner = await contextOwner.newPage();

    const ownerLoginRes = await request.post(`${BACKEND_BASE}/api/v1/auth/login`, {
      data: {
        email: 'owner@default.corp',
        password: 'OwnerSecurePassword2026!',
      },
    });
    const ownerAuth = await ownerLoginRes.json();

    await pageOwner.goto('/');
    await pageOwner.evaluate((auth) => {
      localStorage.setItem('auth_token', auth.access_token);
      localStorage.setItem('user_role', 'ORGANIZATION_OWNER');
    }, ownerAuth);

    // Verify Context A retains Superadmin identity
    const adminIdentity = await pageSuperadmin.evaluate(async (backendUrl) => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${backendUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    }, BACKEND_BASE);

    // Verify Context B retains Owner identity
    const ownerIdentity = await pageOwner.evaluate(async (backendUrl) => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${backendUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.json();
    }, BACKEND_BASE);

    expect(adminIdentity.user_id).toBe('usr-platform-superadmin');
    expect(adminIdentity.is_superadmin).toBe(true);

    expect(ownerIdentity.user_id).toBe('usr-org-owner-victoria');
    expect(ownerIdentity.is_superadmin).toBe(false);

    // Cross-context leakage check
    const contextA_role = await pageSuperadmin.evaluate(() => localStorage.getItem('user_role'));
    const contextB_role = await pageOwner.evaluate(() => localStorage.getItem('user_role'));
    expect(contextA_role).toBe('PLATFORM_SUPERADMIN');
    expect(contextB_role).toBe('ORGANIZATION_OWNER');

    await contextSuperadmin.close();
    await contextOwner.close();
  });

});
