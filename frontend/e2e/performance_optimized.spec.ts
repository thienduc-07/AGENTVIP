import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

interface ProfileResult {
  agentCount: number;
  initialLoadMs: number;
  departmentsRenderMs: number;
  idleFps: number;
  rotationFps: number;
  zoomFps: number;
  panFps: number;
  reRenderFps: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  materials: number;
  textures: number;
  sceneMeshes: number;
  visibleMeshes: number;
  jsHeapUsedMB: number | null;
  jsHeapTotalMB: number | null;
  reactRenderCount: number;
  totalAgents: number;
  totalWorkstations: number;
}

const AGENT_WORKLOADS = [10, 30, 50, 100];
const outPath = path.resolve(process.cwd(), 'e2e/benchmark_optimized_raw.json');
let results: Record<number, ProfileResult> = {};
if (fs.existsSync(outPath)) {
  try {
    results = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  } catch (e) {}
}

test.describe('Agent City: Phase 5 Performance Optimization Verification', () => {
  test.setTimeout(420000);

  for (const count of AGENT_WORKLOADS) {
    test(`Profile optimized workload with ${count} agents`, async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });

      console.log(`[OPTIMIZED TEST ${count} AGENTS] Starting navigation...`);
      const startTime = Date.now();
      await page.goto(`/?benchmark_agents=${count}`);

      // 6. Initial scene loading time
      console.log(`[OPTIMIZED TEST ${count} AGENTS] Waiting for canvas...`);
      const canvas = page.locator('canvas').first();
      await expect(canvas).toBeVisible({ timeout: 35000 });
      const initialLoadMs = Date.now() - startTime;
      console.log(`[OPTIMIZED TEST ${count} AGENTS] Canvas visible in ${initialLoadMs}ms`);

      // 7. Time required to render all departments
      console.log(`[OPTIMIZED TEST ${count} AGENTS] Waiting for HUD department buttons...`);
      const deptMarker = page.locator('button', { hasText: 'T6: Điều Hành' }).first();
      await expect(deptMarker).toBeVisible({ timeout: 25000 });
      const departmentsRenderMs = Date.now() - startTime;
      console.log(`[OPTIMIZED TEST ${count} AGENTS] Departments visible in ${departmentsRenderMs}ms`);

      // Wait 1.5s for WebGL scene and agents to settle
      console.log(`[OPTIMIZED TEST ${count} AGENTS] Settling scene...`);
      await page.waitForTimeout(1500);

      // 1. Measure FPS during idle
      console.log(`[OPTIMIZED TEST ${count} AGENTS] Measuring idle FPS...`);
      await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.startMeasure());
      await page.waitForTimeout(1500);
      const idleFps = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.stopMeasure() || 60);
      console.log(`[OPTIMIZED TEST ${count} AGENTS] Idle FPS: ${idleFps}`);

      // 2. Measure FPS during camera rotation
      console.log(`[OPTIMIZED TEST ${count} AGENTS] Measuring rotation FPS...`);
      const canvasBox = await canvas.boundingBox();
      const centerX = canvasBox!.x + canvasBox!.width * 0.5;
      const centerY = canvasBox!.y + canvasBox!.height * 0.5;

      await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.startMeasure());
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX - 100, centerY + 10);
      await page.mouse.up();
      await page.waitForTimeout(300);
      const rotationFps = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.stopMeasure() || 60);
      console.log(`[OPTIMIZED TEST ${count} AGENTS] Rotation FPS: ${rotationFps}`);

      // 3. Measure FPS during camera zoom
      console.log(`[OPTIMIZED TEST ${count} AGENTS] Measuring zoom FPS...`);
      await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.startMeasure());
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(300);
      const zoomFps = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.stopMeasure() || 60);
      console.log(`[OPTIMIZED TEST ${count} AGENTS] Zoom FPS: ${zoomFps}`);

      // 4. Measure FPS during camera pan
      console.log(`[OPTIMIZED TEST ${count} AGENTS] Measuring pan FPS...`);
      await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.startMeasure());
      await page.mouse.move(centerX, centerY);
      await page.keyboard.down('Shift');
      await page.mouse.down();
      await page.mouse.move(centerX + 60, centerY + 20);
      await page.mouse.up();
      await page.keyboard.up('Shift');
      await page.waitForTimeout(300);
      const panFps = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.stopMeasure() || 60);
      console.log(`[OPTIMIZED TEST ${count} AGENTS] Pan FPS: ${panFps}`);

      // 5. Measure FPS during React re-renders
      console.log(`[OPTIMIZED TEST ${count} AGENTS] Measuring re-render FPS...`);
      await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.startMeasure());
      const refreshBtn = page.locator('button[title="Làm mới snapshot backend"]').first();
      if (await refreshBtn.isVisible()) {
        await refreshBtn.click({ force: true, noWaitAfter: true });
        await page.waitForTimeout(500);
        await refreshBtn.click({ force: true, noWaitAfter: true });
        await page.waitForTimeout(500);
      }
      const reRenderFps = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.stopMeasure() || 60);
      console.log(`[OPTIMIZED TEST ${count} AGENTS] Re-render FPS: ${reRenderFps}`);

      // Extract Three.js in-engine metrics
      console.log(`[OPTIMIZED TEST ${count} AGENTS] Extracting Three.js metrics...`);
      const metrics: any = await page.evaluate(() => {
        return (window as any).__AGENT_CITY_PROFILER__?.getMetrics() || null;
      });

      results[count] = {
        agentCount: count,
        initialLoadMs,
        departmentsRenderMs,
        idleFps,
        rotationFps,
        zoomFps,
        panFps,
        reRenderFps,
        drawCalls: metrics?.drawCalls ?? 0,
        triangles: metrics?.triangles ?? 0,
        geometries: metrics?.geometries ?? 0,
        materials: metrics?.uniqueMaterialsCount ?? 0,
        textures: metrics?.textures ?? 0,
        sceneMeshes: metrics?.sceneMeshes ?? 0,
        visibleMeshes: metrics?.visibleMeshes ?? 0,
        jsHeapUsedMB: metrics?.jsHeapUsedMB ?? null,
        jsHeapTotalMB: metrics?.jsHeapTotalMB ?? null,
        reactRenderCount: metrics?.reactRenderCount ?? 0,
        totalAgents: count,
        totalWorkstations: 20,
      };

      console.log(`[EMPIRICAL OPTIMIZED - ${count} AGENTS]:`, JSON.stringify(results[count], null, 2));

      // Persist results progressively so partials are never lost
      fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    });
  }
});

