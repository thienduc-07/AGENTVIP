import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const INJECT_COMPOSITOR_HEARTBEAT = `
if (!document.getElementById('__compositor_heartbeat__')) {
  const style = document.createElement('style');
  style.textContent = '@keyframes __chb__ { 0% { opacity: 0.98; } 50% { opacity: 0.99; } 100% { opacity: 1; } }';
  document.head.appendChild(style);
  const div = document.createElement('div');
  div.id = '__compositor_heartbeat__';
  div.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:2px;pointer-events:none;z-index:999999;animation:__chb__ 0.016s infinite linear;';
  document.body.appendChild(div);
}
`;

const INJECT_NATIVE_PROFILER = `
window.__NATIVE_PROFILER__ = {
  buffer: new Float64Array(2000),
  index: 0,
  active: false,
  last: 0,
  start: function() {
    this.buffer = new Float64Array(2000);
    this.index = 0;
    this.active = true;
    this.last = performance.now();
    const tick = (now) => {
      if (!this.active) return;
      if (this.index < this.buffer.length) {
        this.buffer[this.index++] = now - this.last;
        this.last = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },
  stop: function() {
    this.active = false;
    const count = this.index;
    if (count <= 1) return { sampleCount: count, avgFps: 0 };
    
    const samples = Array.from(this.buffer.subarray(1, count)).sort((a, b) => a - b);
    const total = samples.reduce((acc, v) => acc + v, 0);
    const median = samples[Math.floor(samples.length * 0.5)];
    const p95 = samples[Math.floor(samples.length * 0.95)];
    const p99 = samples[Math.floor(samples.length * 0.99)];
    const onePercentLow = 1000 / Math.max(0.1, p99);
    const over33 = samples.filter((v) => v > 33.3).length;
    const over50 = samples.filter((v) => v > 50.0).length;
    const avgFps = samples.length / (total / 1000);

    return {
      sampleCount: samples.length,
      durationMs: Math.round(total),
      avgFps: Math.round(avgFps * 10) / 10,
      medianFrameTimeMs: Math.round(median * 100) / 100,
      p95FrameTimeMs: Math.round(p95 * 100) / 100,
      p99FrameTimeMs: Math.round(p99 * 100) / 100,
      onePercentLowFps: Math.round(onePercentLow * 10) / 10,
      framesExceeding33ms: over33,
      framesExceeding50ms: over50,
      minFrameTimeMs: Math.round(samples[0] * 100) / 100,
      maxFrameTimeMs: Math.round(samples[samples.length - 1] * 100) / 100,
    };
  }
};
`;

const profilerGateResults: Record<string, any> = {};

test.describe('Profiler Stability Gate: Scenarios 1 to 6', () => {
  test.setTimeout(90000);

  test.afterAll(async () => {
    const outPath = path.resolve(process.cwd(), 'e2e/profiler_gate_scenarios_raw.json');
    fs.writeFileSync(outPath, JSON.stringify(profilerGateResults, null, 2), 'utf8');
    console.log('[PROFILER GATE] Saved results to', outPath);
  });

  test('Gate 1: Idle Scenario (100 Agents)', async ({ page }) => {
    console.log('[GATE 1 - IDLE] Navigating to 100-agent workload...');
    await page.goto('/?benchmark_agents=100');

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 35000 });
    await page.waitForTimeout(2000);

    await page.evaluate(INJECT_COMPOSITOR_HEARTBEAT);
    await page.evaluate(INJECT_NATIVE_PROFILER);

    await page.evaluate(() => {
      (window as any).__NATIVE_PROFILER__.start();
      (window as any).__AGENT_CITY_PROFILER__?.startMeasure();
    });
    await page.waitForTimeout(3000);
    const nativeStats: any = await page.evaluate(() => (window as any).__NATIVE_PROFILER__.stop());
    const engineStats: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.stopMeasure(true));
    const metrics: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.getMetrics());

    profilerGateResults['idle'] = { nativeStats, engineStats, metrics };
    console.log('[GATE 1 - IDLE RESULTS]:', JSON.stringify({ nativeStats, engineStats }, null, 2));

    expect(nativeStats.sampleCount).toBeGreaterThanOrEqual(15);
    expect(nativeStats.durationMs).toBeGreaterThan(2000);
  });

  test('Gate 2: Camera Rotation Scenario', async ({ page }) => {
    console.log('[GATE 2 - ROTATION] Navigating to 100-agent workload...');
    await page.goto('/?benchmark_agents=100');

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 35000 });
    await page.waitForTimeout(2000);

    const canvasBox = await canvas.boundingBox();
    const centerX = canvasBox!.x + canvasBox!.width * 0.5;
    const centerY = canvasBox!.y + canvasBox!.height * 0.5;

    await page.evaluate(INJECT_COMPOSITOR_HEARTBEAT);
    await page.evaluate(INJECT_NATIVE_PROFILER);

    await page.evaluate(() => {
      (window as any).__NATIVE_PROFILER__.start();
      (window as any).__AGENT_CITY_PROFILER__?.startMeasure();
    });

    // Execute smooth rotation drag
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX - 120, centerY + 20, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(1000);

    const nativeStats: any = await page.evaluate(() => (window as any).__NATIVE_PROFILER__.stop());
    const engineStats: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.stopMeasure(true));
    const metrics: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.getMetrics());

    profilerGateResults['rotation'] = { nativeStats, engineStats, metrics };
    console.log('[GATE 2 - ROTATION RESULTS]:', JSON.stringify({ nativeStats, engineStats }, null, 2));

    expect(nativeStats.sampleCount).toBeGreaterThanOrEqual(15);
  });

  test('Gate 3: Camera Zoom Scenario', async ({ page }) => {
    console.log('[GATE 3 - ZOOM] Navigating to 100-agent workload...');
    await page.goto('/?benchmark_agents=100');

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 35000 });
    await page.waitForTimeout(2000);

    const canvasBox = await canvas.boundingBox();
    const centerX = canvasBox!.x + canvasBox!.width * 0.5;
    const centerY = canvasBox!.y + canvasBox!.height * 0.5;

    await page.evaluate(INJECT_COMPOSITOR_HEARTBEAT);
    await page.evaluate(INJECT_NATIVE_PROFILER);

    await page.evaluate(() => {
      (window as any).__NATIVE_PROFILER__.start();
      (window as any).__AGENT_CITY_PROFILER__?.startMeasure();
    });

    // Execute zoom
    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, 150);
    await page.waitForTimeout(1200);

    const nativeStats: any = await page.evaluate(() => (window as any).__NATIVE_PROFILER__.stop());
    const engineStats: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.stopMeasure(true));
    const metrics: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.getMetrics());

    profilerGateResults['zoom'] = { nativeStats, engineStats, metrics };
    console.log('[GATE 3 - ZOOM RESULTS]:', JSON.stringify({ nativeStats, engineStats }, null, 2));

    expect(nativeStats.sampleCount).toBeGreaterThanOrEqual(15);
  });

  test('Gate 4: Camera Pan Scenario', async ({ page }) => {
    console.log('[GATE 4 - PAN] Navigating to 100-agent workload...');
    await page.goto('/?benchmark_agents=100');

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 35000 });
    await page.waitForTimeout(2000);

    const canvasBox = await canvas.boundingBox();
    const centerX = canvasBox!.x + canvasBox!.width * 0.5;
    const centerY = canvasBox!.y + canvasBox!.height * 0.5;

    await page.evaluate(INJECT_COMPOSITOR_HEARTBEAT);
    await page.evaluate(INJECT_NATIVE_PROFILER);

    await page.evaluate(() => {
      (window as any).__NATIVE_PROFILER__.start();
      (window as any).__AGENT_CITY_PROFILER__?.startMeasure();
    });

    // Execute pan (Shift + Left Drag)
    await page.keyboard.down('Shift');
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 100, centerY - 20, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(1000);

    const nativeStats: any = await page.evaluate(() => (window as any).__NATIVE_PROFILER__.stop());
    const engineStats: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.stopMeasure(true));
    const metrics: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.getMetrics());

    profilerGateResults['pan'] = { nativeStats, engineStats, metrics };
    console.log('[GATE 4 - PAN RESULTS]:', JSON.stringify({ nativeStats, engineStats }, null, 2));

    expect(nativeStats.sampleCount).toBeGreaterThanOrEqual(15);
  });

  test('Gate 5: Agent Articulated Animations Scenario', async ({ page }) => {
    console.log('[GATE 5 - ANIMATIONS] Navigating to 100-agent workload...');
    await page.goto('/?benchmark_agents=100');

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 35000 });
    await page.waitForTimeout(2000);

    await page.evaluate(INJECT_COMPOSITOR_HEARTBEAT);
    await page.evaluate(INJECT_NATIVE_PROFILER);

    // Profile sustained skeletal animation over 3.5 seconds
    await page.evaluate(() => {
      (window as any).__NATIVE_PROFILER__.start();
      (window as any).__AGENT_CITY_PROFILER__?.startMeasure();
    });
    await page.waitForTimeout(3500);

    const nativeStats: any = await page.evaluate(() => (window as any).__NATIVE_PROFILER__.stop());
    const engineStats: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.stopMeasure(true));
    const metrics: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.getMetrics());

    profilerGateResults['animations'] = { nativeStats, engineStats, metrics };
    console.log('[GATE 5 - ANIMATIONS RESULTS]:', JSON.stringify({ nativeStats, engineStats }, null, 2));

    expect(nativeStats.sampleCount).toBeGreaterThanOrEqual(15);
  });

  test('Gate 6: Real-time WebSocket Updates Scenario', async ({ page }) => {
    console.log('[GATE 6 - WEBSOCKETS] Navigating to 100-agent workload...');
    await page.goto('/?benchmark_agents=100');

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 35000 });
    await page.waitForTimeout(2000);

    await page.evaluate(INJECT_COMPOSITOR_HEARTBEAT);
    await page.evaluate(INJECT_NATIVE_PROFILER);

    // Start profiling and dispatch synthetic high-rate DOM events to stress test frame pacing
    await page.evaluate(() => {
      (window as any).__NATIVE_PROFILER__.start();
      (window as any).__AGENT_CITY_PROFILER__?.startMeasure();
      
      // Dispatch 15 synthetic state change window events simulating high-frequency WebSocket sync
      let count = 0;
      const interval = setInterval(() => {
        count++;
        window.dispatchEvent(new CustomEvent('office:agent_sync', { detail: { sequence_id: count } }));
        if (count >= 15) clearInterval(interval);
      }, 100);
    });

    await page.waitForTimeout(3000);

    const nativeStats: any = await page.evaluate(() => (window as any).__NATIVE_PROFILER__.stop());
    const engineStats: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.stopMeasure(true));
    const metrics: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.getMetrics());

    profilerGateResults['websockets'] = { nativeStats, engineStats, metrics };
    console.log('[GATE 6 - WEBSOCKETS RESULTS]:', JSON.stringify({ nativeStats, engineStats }, null, 2));

    expect(nativeStats.sampleCount).toBeGreaterThanOrEqual(15);
  });
});
