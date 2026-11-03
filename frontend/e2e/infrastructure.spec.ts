import { test, expect } from '@playwright/test';

/**
 * Phase 4.3.8.1: Playwright Infrastructure & Dual Server Accessibility Verification
 */
test.describe('Phase 4.3.8.1: Playwright Infrastructure & Server Connectivity', () => {
  test('Backend FastAPI server is accessible and responds to HTTP requests', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:8000/docs');
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('Swagger UI');
  });

  test('Frontend Next.js application loads Corporate HQ 3D World', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await expect(page).toHaveTitle(/AI Agency|Agent City|HQ/i);

    // Verify main interactive containers are present
    const canvasContainer = page.locator('canvas, div[data-testid="world-canvas"]').first();
    await expect(canvasContainer).toBeAttached({ timeout: 15000 });
  });

  test('Frontend Autonomous Company Command Center is accessible', async ({ page }) => {
    await page.goto('/autonomous');
    await expect(page.locator('text=AUTONOMOUS AI COMPANY OS').first()).toBeVisible({ timeout: 10000 });
  });
});
