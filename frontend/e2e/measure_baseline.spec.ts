import { test, expect } from '@playwright/test';

test('Measure baseline 100-agent metrics', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?benchmark_agents=100');
  await page.waitForTimeout(6000);

  const metrics = await page.evaluate(() => {
    return (window as any).__AGENT_CITY_PROFILER__?.getMetrics();
  });

  console.log('[BASELINE 100-AGENT METRICS]:', JSON.stringify(metrics, null, 2));
  expect(metrics).not.toBeNull();
});

test('Measure 200-agent scalability metrics', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?benchmark_agents=200');
  await page.waitForTimeout(6000);

  const metrics = await page.evaluate(() => {
    return (window as any).__AGENT_CITY_PROFILER__?.getMetrics();
  });

  console.log('[SCALABILITY 200-AGENT METRICS]:', JSON.stringify(metrics, null, 2));
  expect(metrics).not.toBeNull();
  expect(metrics.jsHeapUsedMB).toBeLessThan(80);
});


