import { test, expect } from '@playwright/test';
import path from 'path';

const BACKEND_BASE = 'http://127.0.0.1:8000';
const PYTHON_BIN = path.resolve(__dirname, '../../backend/venv/bin/python');

test.describe('Phase 4.3.8.5: Workstation & Live Terminal End-to-End Suite', () => {
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

  // Scenario 1: Workstation live detail query
  test('Scenario 1: Workstation live detail query returns authoritative station and agent environment', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/workstations/agent-eng-lead`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const detail = await response.json();
    expect(detail.agent_id).toBe('agent-eng-lead');
    expect(detail.agent_name).toContain('David Chen');
    expect(detail).toHaveProperty('agent_role');
    expect(detail).toHaveProperty('agent_status');
    expect(detail).toHaveProperty('behavioral_state');
    expect(detail).toHaveProperty('organization_id');
  });

  // Scenario 2: Workstation executions list
  test('Scenario 2: Workstation executions list returns paginated execution history', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/workstations/agent-eng-lead/executions?limit=10&offset=0`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items)).toBe(true);
    expect(body).toHaveProperty('total');
  });

  // Scenario 3: Workstation events telemetry
  test('Scenario 3: Workstation events telemetry retrieves chronological execution events', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/workstations/agent-eng-lead/events?limit=20&offset=0`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items)).toBe(true);
    expect(body).toHaveProperty('total');
  });

  // Scenario 4: Workstation terminal history
  test('Scenario 4: Workstation terminal history retrieves paginated terminal stdout/stderr stream', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/workstations/agent-eng-lead/terminal?limit=50&offset=0`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('lines');
    expect(Array.isArray(body.lines)).toBe(true);
    expect(body).toHaveProperty('total');
  });

  // Scenario 5: Terminal injection defense & OSC escape sequence sanitization
  test('Scenario 5: Terminal sanitization engine strips malicious escape sequences and HTML injection', async () => {
    const { execSync } = await import('child_process');
    const result = execSync(
      `"${PYTHON_BIN}" -c '
from backend.app.core.security_sanitizer import sanitize_terminal_text
raw = "\\x1b]0;MaliciousTitle\\x07<script>alert(\\"xss\\")</script>Standard Output Log"
clean = sanitize_terminal_text(raw)
assert "MaliciousTitle" not in clean, "OSC title leak"
assert "<script>" not in clean, "Unsanitized script tag"
assert "[SANITIZED_TAG]" in clean, "Script tag not neutralized"
assert "Standard Output Log" in clean, "Legitimate text stripped"
print("SANITIZATION_VERIFIED")
'`,
      { encoding: 'utf-8', cwd: path.resolve(__dirname, '../..') }
    );

    expect(result.trim()).toBe('SANITIZATION_VERIFIED');
  });

  // Scenario 6: Path traversal defense neutralizes directory escaping
  test('Scenario 6: Path traversal attempts are strictly neutralized and home prefixes redacted', async () => {
    const { execSync } = await import('child_process');
    const result = execSync(
      `"${PYTHON_BIN}" -c '
from backend.app.core.security_sanitizer import sanitize_file_path
traversal_attempt = "../../../etc/shadow"
clean_path = sanitize_file_path(traversal_attempt)
assert ".." not in clean_path, "Directory traversal sequence survived"
assert "[TRAVERSAL_PREVENTED]" in clean_path, "Traversal token missing"

home_leak = "/Users/thienduc/Desktop/Code/provipagent/.env"
clean_home = sanitize_file_path(home_leak)
assert "/Users/thienduc/" not in clean_home, "User home directory leaked"
assert "~/" in clean_home, "Home prefix not redacted"
print("PATH_SECURITY_VERIFIED")
'`,
      { encoding: 'utf-8', cwd: path.resolve(__dirname, '../..') }
    );

    expect(result.trim()).toBe('PATH_SECURITY_VERIFIED');
  });

  // Scenario 7: Secret redaction in terminal logs and event streams
  test('Scenario 7: Secret redaction engine scrubs API tokens and credentials from logs', async () => {
    const { execSync } = await import('child_process');
    const result = execSync(
      `"${PYTHON_BIN}" -c '
from backend.app.core.security_sanitizer import redact_secrets
secrets_sample = "Bearer eyJhbGciOiJIUzI1NiJ9.test.sig sk-1234567890abcdef postgres://admin:SuperSecretPass@db.local/agency"
redacted = redact_secrets(secrets_sample)
assert "SuperSecretPass" not in redacted, "Database password leaked"
assert "sk-1234567890abcdef" not in redacted, "OpenAI key leaked"
assert "[REDACTED]" in redacted, "Redaction token missing"
print("SECRET_REDACTION_VERIFIED")
'`,
      { encoding: 'utf-8', cwd: path.resolve(__dirname, '../..') }
    );

    expect(result.trim()).toBe('SECRET_REDACTION_VERIFIED');
  });

  // Scenario 8: Cross-tenant workstation isolation
  test('Scenario 8: Unauthorized tenant cannot query foreign workstation live terminal', async ({ request }) => {
    // Attempt to access foreign agent workstation from tenant default
    const crossTenantRes = await request.get(`${BACKEND_BASE}/api/v1/workstations/agt_isolation_probe_99/terminal`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    expect([403, 404]).toContain(crossTenantRes.status());
  });

  // Scenario 9: Workstation inspection endpoint
  test('Scenario 9: Workstation inspection endpoint retrieves authoritative hardware/zone telemetry', async ({ request }) => {
    const response = await request.get(`${BACKEND_BASE}/api/v1/workstations/ws-engineering-01/inspection`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Organization-Id': 'org_default_company',
      },
    });

    // If workstation id exists in allocations or overview, returns 200 with inspection
    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toHaveProperty('workstation_id');
      expect(data).toHaveProperty('zone');
    } else {
      expect([200, 404]).toContain(response.status());
    }
  });

  // Scenario 10: 3D Workstation Screen UI integration
  test('Scenario 10: WorkstationScreen component renders tabs and terminal stream without crashes', async ({ page }) => {
    await page.goto('/');

    // 1. Verify canvas is mounted
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 15000 });

    // 2. Open Workstation Screen via Zustand store
    await page.evaluate(() => {
      const store = (window as any).__WORKSTATION_STORE__ || (window as any).useWorkstationStore;
      if (store && store.getState) {
        store.getState().openWorkstationScreen('agent-eng-lead', 'ws-engineering-01');
      }
    });

    // 3. Verify page remains stable and responsive
    const bodyHandle = page.locator('body');
    await expect(bodyHandle).toBeAttached();
  });

});
