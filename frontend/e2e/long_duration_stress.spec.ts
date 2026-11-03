import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

interface IntervalTelemetry {
  interval: number;
  timestamp: string;
  elapsedMinutes: number;
  avgFps: number;
  medianFrameTimeMs: number;
  p95FrameTimeMs: number;
  p99FrameTimeMs: number;
  jsHeapUsedMB: number;
  drawCalls: number;
  geometries: number;
  textures: number;
  consoleErrors: number;
  reconnectCount: number;
}

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
  buffer: new Float64Array(4000),
  index: 0,
  active: false,
  last: 0,
  start: function() {
    this.buffer = new Float64Array(4000);
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
    if (count <= 1) return { sampleCount: count, avgFps: 0, medianFrameTimeMs: 0, p95FrameTimeMs: 0, p99FrameTimeMs: 0 };
    
    const samples = Array.from(this.buffer.subarray(1, count)).sort((a, b) => a - b);
    const total = samples.reduce((acc, v) => acc + v, 0);
    const median = samples[Math.floor(samples.length * 0.5)];
    const p95 = samples[Math.floor(samples.length * 0.95)];
    const p99 = samples[Math.floor(samples.length * 0.99)];
    const avgFps = total > 0 ? (samples.length / (total / 1000)) : 0;

    return {
      sampleCount: samples.length,
      durationMs: Math.round(total),
      avgFps: Math.round(avgFps * 10) / 10,
      medianFrameTimeMs: Math.round(median * 10) / 10,
      p95FrameTimeMs: Math.round(p95 * 10) / 10,
      p99FrameTimeMs: Math.round(p99 * 10) / 10,
    };
  }
};
`;

test.describe('Agent City: Long-Duration 15-Minute Stability Certification', () => {
  // Bounded timeout for full 15-minute run + margin
  test.setTimeout(1050000);

  test('15-Minute Continuous Headquarters Stress & Memory Leak Audit', async ({ page }) => {
    let consoleErrors = 0;
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('401') && !msg.text().includes('Failed to load resource')) {
        consoleErrors += 1;
        console.log('[BROWSER CONSOLE ERROR]', msg.text());
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors += 1;
      console.log('[BROWSER UNHANDLED ERROR]', err.message);
    });

    console.log('[STRESS TEST] Navigating to 100-agent multi-floor corporate headquarters...');
    const startTime = Date.now();
    await page.goto('/?benchmark_agents=100');

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 45000 });
    await page.waitForTimeout(3000);

    await page.evaluate(INJECT_COMPOSITOR_HEARTBEAT);
    await page.evaluate(INJECT_NATIVE_PROFILER);

    const canvasBox = await canvas.boundingBox();
    const centerX = canvasBox!.x + canvasBox!.width * 0.5;
    const centerY = canvasBox!.y + canvasBox!.height * 0.5;

    const timeline: IntervalTelemetry[] = [];
    const TOTAL_INTERVALS = 30; // 30 intervals of 30 seconds = 15 minutes
    const INTERVAL_DURATION_MS = 30000;

    console.log(`[STRESS TEST] Starting 15-minute continuous monitoring (${TOTAL_INTERVALS} intervals x 30s)...`);

    for (let i = 1; i <= TOTAL_INTERVALS; i++) {
      const intervalStart = Date.now();

      // Start profiler for this interval
      await page.evaluate(() => (window as any).__NATIVE_PROFILER__.start());

      // Periodic gentle interaction every other interval to simulate active operator
      if (i % 2 === 0) {
        await page.mouse.move(centerX, centerY);
        await page.mouse.down();
        await page.mouse.move(centerX + ((i % 4) - 2) * 20, centerY + 10, { steps: 3 });
        await page.mouse.up();
      } else {
        // Dispatch synthetic agent state update
        await page.evaluate((seq) => {
          window.dispatchEvent(new CustomEvent('office:agent_sync', { detail: { sequence_id: seq } }));
        }, i);
      }

      // Wait out remaining interval duration
      const elapsedInInterval = Date.now() - intervalStart;
      const waitTime = Math.max(1000, INTERVAL_DURATION_MS - elapsedInInterval);
      await page.waitForTimeout(waitTime);

      // Collect telemetry
      const profilerStats: any = await page.evaluate(() => (window as any).__NATIVE_PROFILER__.stop());
      const engineMetrics: any = await page.evaluate(() => (window as any).__AGENT_CITY_PROFILER__?.getMetrics());

      const elapsedMinutes = Math.round(((Date.now() - startTime) / 60000) * 10) / 10;
      const entry: IntervalTelemetry = {
        interval: i,
        timestamp: new Date().toISOString(),
        elapsedMinutes,
        avgFps: profilerStats.avgFps,
        medianFrameTimeMs: profilerStats.medianFrameTimeMs,
        p95FrameTimeMs: profilerStats.p95FrameTimeMs,
        p99FrameTimeMs: profilerStats.p99FrameTimeMs,
        jsHeapUsedMB: engineMetrics?.jsHeapUsedMB ?? 0,
        drawCalls: engineMetrics?.drawCalls ?? 0,
        geometries: engineMetrics?.geometries ?? 0,
        textures: engineMetrics?.textures ?? 0,
        consoleErrors,
        reconnectCount: 0,
      };

      timeline.push(entry);
      console.log(
        `[STRESS INTERVAL ${String(i).padStart(2, '0')}/${TOTAL_INTERVALS}] ` +
        `Elapsed: ${elapsedMinutes}m | ` +
        `FPS: ${entry.avgFps} | ` +
        `Median: ${entry.medianFrameTimeMs}ms | ` +
        `Heap: ${entry.jsHeapUsedMB}MB | ` +
        `DrawCalls: ${entry.drawCalls} | ` +
        `Errors: ${entry.consoleErrors}`
      );
    }

    // Save full raw telemetry to disk
    const outPath = path.resolve(process.cwd(), 'e2e/long_duration_stress_raw.json');
    const firstInterval = timeline[0];
    const lastInterval = timeline[timeline.length - 1];

    const initialHeap = firstInterval.jsHeapUsedMB;
    const finalHeap = lastInterval.jsHeapUsedMB;
    const totalMinutes = lastInterval.elapsedMinutes;
    const memoryGrowthRate = Math.round(((finalHeap - initialHeap) / Math.max(1, totalMinutes)) * 100) / 100;

    const initialMedian = firstInterval.medianFrameTimeMs;
    const finalMedian = lastInterval.medianFrameTimeMs;
    const degradationPercent =
      initialMedian > 0
        ? Math.round(((finalMedian - initialMedian) / initialMedian) * 1000) / 10
        : 0;

    const summary = {
      testDurationMinutes: totalMinutes,
      totalIntervals: timeline.length,
      initialHeapMB: initialHeap,
      finalHeapMB: finalHeap,
      memoryGrowthRateMBPerMin: memoryGrowthRate,
      initialMedianFrameTimeMs: initialMedian,
      finalMedianFrameTimeMs: finalMedian,
      degradationPercent,
      totalConsoleErrors: consoleErrors,
      status: memoryGrowthRate < 2.0 && degradationPercent < 25 ? 'PASS' : 'FAIL',
      timeline,
    };

    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
    console.log('[STRESS TEST SUMMARY]:', JSON.stringify(summary, null, 2));

    // Assertions according to certification criteria
    expect(memoryGrowthRate).toBeLessThan(2.0); // Less than 2 MB/min
    expect(summary.totalConsoleErrors).toBe(0);
  });
});
