import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

interface FrameTimeStats {
  scenario: string;
  frameCount: number;
  durationMs: number;
  fps: number;
  avgFps: number;
  medianFrameTimeMs: number;
  p95FrameTimeMs: number;
  p99FrameTimeMs: number;
  onePercentLowFps: number;
  longTasksCount: number;
  droppedFramesCount: number;
  minFrameTimeMs: number;
  maxFrameTimeMs: number;
  drawCalls: number;
  triangles: number;
  castShadowMeshes: number;
  transparentMeshes: number;
  opaqueMeshes: number;
}

const outPath = path.resolve(process.cwd(), 'e2e/frametime_analysis_raw.json');
let allResults: Record<string, FrameTimeStats> = {};
if (fs.existsSync(outPath)) {
  try {
    allResults = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  } catch (e) {}
}

test.describe('Agent City: Independent Frame-Time & Stutter Analysis (100 Agents)', () => {
  test.setTimeout(180000);

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
  });

  // Scenario 1: Idle Scene
  test('Scenario 1: Idle Scene', async ({ page }) => {
    console.log('[SCENARIO 1] Loading 100-agent scene for Idle measurement...');
    await page.goto('/?benchmark_agents=100');
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 35000 });
    await page.waitForTimeout(3000);

    console.log('[SCENARIO 1] Measuring Idle frame times...');
    await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.startMeasure());
    await page.waitForTimeout(4000);
    const stats: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.stopMeasure(true));
    const metrics: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.getMetrics() || {});

    allResults['idle'] = {
      scenario: 'Idle Scene',
      ...stats,
      drawCalls: metrics.drawCalls || 0,
      triangles: metrics.triangles || 0,
      castShadowMeshes: metrics.castShadowMeshes || 0,
      transparentMeshes: metrics.transparentMeshes || 0,
      opaqueMeshes: metrics.opaqueMeshes || 0,
    };
    fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
    console.log('[SCENARIO 1 RESULTS]:', JSON.stringify(allResults['idle'], null, 2));
    expect(allResults['idle'].frameCount).toBeGreaterThan(60);
  });

  // Scenario 2: Continuous Camera Rotation
  test('Scenario 2: Continuous Camera Rotation', async ({ page }) => {
    console.log('[SCENARIO 2] Loading 100-agent scene for Camera Rotation...');
    await page.goto('/?benchmark_agents=100');
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 35000 });
    await page.waitForTimeout(2000);

    const canvasBox = await canvas.boundingBox();
    const centerX = canvasBox!.x + canvasBox!.width * 0.5;
    const centerY = canvasBox!.y + canvasBox!.height * 0.5;

    console.log('[SCENARIO 2] Measuring Camera Rotation frame times...');
    await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.startMeasure());
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX - 150, centerY + 20);
    await page.waitForTimeout(1000);
    await page.mouse.move(centerX + 150, centerY - 20);
    await page.waitForTimeout(1000);
    await page.mouse.move(centerX, centerY);
    await page.waitForTimeout(500);
    await page.mouse.up();

    const stats: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.stopMeasure(true));
    const metrics: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.getMetrics() || {});

    allResults['rotation'] = {
      scenario: 'Continuous Camera Rotation',
      ...stats,
      drawCalls: metrics.drawCalls || 0,
      triangles: metrics.triangles || 0,
      castShadowMeshes: metrics.castShadowMeshes || 0,
      transparentMeshes: metrics.transparentMeshes || 0,
      opaqueMeshes: metrics.opaqueMeshes || 0,
    };
    fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
    console.log('[SCENARIO 2 RESULTS]:', JSON.stringify(allResults['rotation'], null, 2));
    expect(allResults['rotation'].frameCount).toBeGreaterThan(40);
  });

  // Scenario 3: Continuous Camera Zoom
  test('Scenario 3: Continuous Camera Zoom', async ({ page }) => {
    console.log('[SCENARIO 3] Loading 100-agent scene for Camera Zoom...');
    await page.goto('/?benchmark_agents=100');
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 35000 });
    await page.waitForTimeout(2000);

    console.log('[SCENARIO 3] Measuring Camera Zoom frame times...');
    await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.startMeasure());
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(1200);
    await page.mouse.wheel(0, -250);
    await page.waitForTimeout(1200);

    const stats: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.stopMeasure(true));
    const metrics: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.getMetrics() || {});

    allResults['zoom'] = {
      scenario: 'Continuous Camera Zoom',
      ...stats,
      drawCalls: metrics.drawCalls || 0,
      triangles: metrics.triangles || 0,
      castShadowMeshes: metrics.castShadowMeshes || 0,
      transparentMeshes: metrics.transparentMeshes || 0,
      opaqueMeshes: metrics.opaqueMeshes || 0,
    };
    fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
    console.log('[SCENARIO 3 RESULTS]:', JSON.stringify(allResults['zoom'], null, 2));
    expect(allResults['zoom'].frameCount).toBeGreaterThan(40);
  });

  // Scenario 4: Continuous Camera Pan
  test('Scenario 4: Continuous Camera Pan', async ({ page }) => {
    console.log('[SCENARIO 4] Loading 100-agent scene for Camera Pan...');
    await page.goto('/?benchmark_agents=100');
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 35000 });
    await page.waitForTimeout(2000);

    const canvasBox = await canvas.boundingBox();
    const centerX = canvasBox!.x + canvasBox!.width * 0.5;
    const centerY = canvasBox!.y + canvasBox!.height * 0.5;

    console.log('[SCENARIO 4] Measuring Camera Pan frame times...');
    await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.startMeasure());
    await page.mouse.move(centerX, centerY);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(centerX + 120, centerY + 30);
    await page.waitForTimeout(1000);
    await page.mouse.move(centerX - 120, centerY - 30);
    await page.waitForTimeout(1000);
    await page.mouse.up();
    await page.keyboard.up('Shift');

    const stats: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.stopMeasure(true));
    const metrics: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.getMetrics() || {});

    allResults['pan'] = {
      scenario: 'Continuous Camera Pan',
      ...stats,
      drawCalls: metrics.drawCalls || 0,
      triangles: metrics.triangles || 0,
      castShadowMeshes: metrics.castShadowMeshes || 0,
      transparentMeshes: metrics.transparentMeshes || 0,
      opaqueMeshes: metrics.opaqueMeshes || 0,
    };
    fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
    console.log('[SCENARIO 4 RESULTS]:', JSON.stringify(allResults['pan'], null, 2));
    expect(allResults['pan'].frameCount).toBeGreaterThan(40);
  });

  // Scenario 5: Simultaneous Agent Animations
  test('Scenario 5: Simultaneous Agent Animations', async ({ page }) => {
    console.log('[SCENARIO 5] Loading 100-agent scene for Animations...');
    await page.goto('/?benchmark_agents=100');
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 35000 });

    const f5Btn = page.locator('button', { hasText: 'T5: Kỹ Thuật' }).first();
    await f5Btn.click({ force: true });
    await page.waitForTimeout(1500);

    console.log('[SCENARIO 5] Measuring Agent Animations frame times...');
    await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.startMeasure());
    await page.waitForTimeout(4000);

    const stats: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.stopMeasure(true));
    const metrics: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.getMetrics() || {});

    allResults['animations'] = {
      scenario: 'Simultaneous Agent Animations',
      ...stats,
      drawCalls: metrics.drawCalls || 0,
      triangles: metrics.triangles || 0,
      castShadowMeshes: metrics.castShadowMeshes || 0,
      transparentMeshes: metrics.transparentMeshes || 0,
      opaqueMeshes: metrics.opaqueMeshes || 0,
    };
    fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
    console.log('[SCENARIO 5 RESULTS]:', JSON.stringify(allResults['animations'], null, 2));
    expect(allResults['animations'].frameCount).toBeGreaterThan(60);
  });

  // Scenario 6: Frequent WebSocket / State Updates
  test('Scenario 6: Frequent WebSocket Updates', async ({ page }) => {
    console.log('[SCENARIO 6] Loading 100-agent scene for WebSocket updates...');
    await page.goto('/?benchmark_agents=100');
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 35000 });
    await page.waitForTimeout(2000);

    const refreshBtn = page.locator('button[title="Làm mới snapshot backend"]').first();

    console.log('[SCENARIO 6] Measuring WebSocket Updates frame times...');
    await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.startMeasure());
    for (let i = 0; i < 4; i++) {
      if (await refreshBtn.isVisible()) {
        await refreshBtn.click({ force: true, noWaitAfter: true });
      }
      await page.waitForTimeout(700);
    }

    const stats: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.stopMeasure(true));
    const metrics: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.getMetrics() || {});

    allResults['ws_updates'] = {
      scenario: 'Frequent WebSocket Updates',
      ...stats,
      drawCalls: metrics.drawCalls || 0,
      triangles: metrics.triangles || 0,
      castShadowMeshes: metrics.castShadowMeshes || 0,
      transparentMeshes: metrics.transparentMeshes || 0,
      opaqueMeshes: metrics.opaqueMeshes || 0,
    };
    fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
    console.log('[SCENARIO 6 RESULTS]:', JSON.stringify(allResults['ws_updates'], null, 2));
    expect(allResults['ws_updates'].frameCount).toBeGreaterThan(40);
  });
});
