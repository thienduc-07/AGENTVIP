import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

const SCREENSHOT_DIR = "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a/screenshots/agent_city_5_1_9";
const BENCHMARK_OUT = path.join(__dirname, "audit_5_1_9_benchmark_raw.json");

// Helper to accurately measure native frame times via requestAnimationFrame
async function measurePerformanceInterval(page: any, durationMs: number) {
  return await page.evaluate(async (ms: number) => {
    return new Promise((resolve) => {
      const timestamps: number[] = [];
      const startTime = performance.now();

      function onFrame(now: number) {
        timestamps.push(now);
        if (now - startTime >= ms && timestamps.length >= 10) {
          const deltas: number[] = [];
          for (let i = 1; i < timestamps.length; i++) {
            deltas.push(timestamps[i] - timestamps[i - 1]);
          }
          deltas.sort((a, b) => a - b);
          const totalTime = deltas.reduce((a, b) => a + b, 0);
          const avgFt = totalTime / deltas.length;
          const maxFt = deltas[deltas.length - 1];
          const minFt = deltas[0];
          const avgFps = 1000 / avgFt;

          // 1% low is calculated as 99th percentile frame time inverted
          const p99Index = Math.min(deltas.length - 1, Math.floor(deltas.length * 0.99));
          const p99Ft = deltas[p99Index];
          const low1PctFps = 1000 / p99Ft;

          const renderer = (window as any).__MY_OFFICE_RENDERER__;
          const calls = renderer?.info?.render?.calls || 0;
          const triangles = renderer?.info?.render?.triangles || 0;
          const geometries = renderer?.info?.memory?.geometries || 0;
          const textures = renderer?.info?.memory?.textures || 0;

          const chibis = (window as any).__MY_OFFICE_CHIBIS__ || {};
          const totalControllers = Object.keys(chibis).length;

          // GPU memory estimation
          let gpuMemEstimateMB = 0;
          if (performance && (performance as any).memory) {
            gpuMemEstimateMB = Math.round((performance as any).memory.usedJSHeapSize / (1024 * 1024));
          }

          resolve({
            sampleDurationMs: ms,
            totalFrames: deltas.length,
            avgFps: Number(avgFps.toFixed(1)),
            low1PctFps: Number(low1PctFps.toFixed(1)),
            avgFrameTimeMs: Number(avgFt.toFixed(2)),
            maxFrameTimeMs: Number(maxFt.toFixed(2)),
            minFrameTimeMs: Number(minFt.toFixed(2)),
            drawCalls: calls,
            triangles: triangles,
            geometries: geometries,
            textures: textures,
            activeControllers: totalControllers,
            jsHeapMB: gpuMemEstimateMB,
          });
        } else {
          requestAnimationFrame(onFrame);
        }
      }
      requestAnimationFrame(onFrame);
    });
  }, durationMs);
}

test.describe("AGENT CITY 5.1.9 — Independent Workforce Reality & Performance Audit", () => {
  test.setTimeout(180000);

  test("Phase 4: Real 3D Representation — Capture 6 Floors Screenshots and Seating Inspection", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

    // Wait for full backend workforce population (276 Nhân Sự)
    const workforceBadge = page.locator("text=/\\d+ Nhân Sự/");
    await expect(workforceBadge).toBeVisible({ timeout: 25000 });
    const badgeText = await workforceBadge.textContent();
    console.log("Diorama Top Bar Badge:", badgeText);

    const floorSpecs = [
      { floor: 1, name: "01_1f_operations_support.png", label: "Operations & Support" },
      { floor: 2, name: "02_2f_finance_specialized.png", label: "Finance & Specialized Advisory" },
      { floor: 3, name: "03_3f_marketing_sales.png", label: "Marketing & Enterprise Sales" },
      { floor: 4, name: "04_4f_design_product_game.png", label: "Design, Product, PM & Game Lab" },
      { floor: 5, name: "05_5f_engineering_soc_gis.png", label: "Engineering, Security SOC & GIS" },
      { floor: 6, name: "06_6f_executive_boardroom.png", label: "Executive Suite & Academic Fellowship" },
    ];

    for (const f of floorSpecs) {
      // Click floor selector button in elevator bar (e.g. "1F Vận Hành & Hỗ Trợ")
      const floorBtn = page.getByRole("button", { name: new RegExp(`${f.floor}F`, "i") }).first();
      await floorBtn.click();
      await page.waitForTimeout(2000);

      // Verify floor visual header
      const floorHeader = page.locator(`text=/Tầng ${f.floor}/`).first();
      await expect(floorHeader).toBeVisible();

      // Capture screenshot
      const shotPath = path.join(SCREENSHOT_DIR, f.name);
      await page.screenshot({ path: shotPath, fullPage: false });
      console.log(`Captured floor ${f.floor}F screenshot -> ${shotPath}`);

      // Inspect character seating and boundaries
      const seatingInspection = await page.evaluate((targetFloor: number) => {
        const chibis = (window as any).__MY_OFFICE_CHIBIS__ || {};
        const floorChibis = Object.values(chibis).filter((c: any) => c.floor === targetFloor);
        const issues: string[] = [];

        floorChibis.forEach((c: any) => {
          if (!c.root) {
            issues.push(`Chibi ${c.cfg?.id} has no root group`);
            return;
          }
          const px = c.root.position.x;
          const py = c.root.position.y;
          const pz = c.root.position.z;
          if (isNaN(px) || isNaN(py) || isNaN(pz)) {
            issues.push(`Chibi ${c.cfg?.id} has NaN position`);
          }
          // Perimeter boundary check: office floor is within [-18, 18] on X and [-15, 15] on Z
          if (Math.abs(px) > 25 || Math.abs(pz) > 25) {
            issues.push(`Chibi ${c.cfg?.id} outside building perimeter: (${px}, ${pz})`);
          }
        });

        return {
          totalFloorChibis: floorChibis.length,
          issues: issues,
        };
      }, f.floor);

      expect(seatingInspection.issues).toHaveLength(0);
      console.log(`Floor ${f.floor}F seating inspection passed (${seatingInspection.totalFloorChibis} chibis).`);
    }
  });

  test("Phase 5: Performance Benchmark across all 8 scenarios and with/without animation", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    const benchmarkResults: Record<string, any> = {};

    // 1. Initial Load Benchmark (Floor 5 default)
    console.log("Measuring 1. Initial application load...");
    benchmarkResults["1_initial_load"] = await measurePerformanceInterval(page, 3000);

    // 2. Floor 1 Benchmark (Low density floor)
    console.log("Switching to Floor 1F...");
    await page.getByRole("button", { name: /1F/i }).first().click();
    await page.waitForTimeout(1500);
    console.log("Measuring 2. Floor 1 (11 agents)...");
    benchmarkResults["2_floor_1"] = await measurePerformanceInterval(page, 3000);

    // 3. Highest Employee Floor: Floor 5 (101 agents)
    console.log("Switching back to Floor 5F (101 agents)...");
    await page.getByRole("button", { name: /5F/i }).first().click();
    await page.waitForTimeout(1500);
    console.log("Measuring 3. Highest employee floor (Floor 5)...");
    benchmarkResults["3_floor_5_highest_count"] = await measurePerformanceInterval(page, 3000);

    // 4. Floor Switching Benchmark (Switching floors dynamically)
    console.log("Measuring 4. Floor switching...");
    const floorSwitchPromise = (async () => {
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: /2F/i }).first().click();
      await page.waitForTimeout(1000);
      await page.getByRole("button", { name: /3F/i }).first().click();
      await page.waitForTimeout(1000);
      await page.getByRole("button", { name: /5F/i }).first().click();
    })();
    const switchMetricsPromise = measurePerformanceInterval(page, 3500);
    const [, switchMetrics] = await Promise.all([floorSwitchPromise, switchMetricsPromise]);
    benchmarkResults["4_floor_switching"] = switchMetrics;

    // 5. Camera Rotation Benchmark
    console.log("Measuring 5. Camera rotation...");
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    const rotationPromise = (async () => {
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down({ button: "right" });
        for (let i = 0; i < 30; i++) {
          await page.mouse.move(box.x + box.width / 2 + i * 8, box.y + box.height / 2 + (i % 5) * 4);
          await page.waitForTimeout(50);
        }
        await page.mouse.up({ button: "right" });
      }
    })();
    const rotMetricsPromise = measurePerformanceInterval(page, 3000);
    const [, rotMetrics] = await Promise.all([rotationPromise, rotMetricsPromise]);
    benchmarkResults["5_camera_rotation"] = rotMetrics;

    // 6. Camera Zoom Benchmark
    console.log("Measuring 6. Camera zoom...");
    const zoomPromise = (async () => {
      for (let i = 0; i < 15; i++) {
        await page.mouse.wheel(0, i % 2 === 0 ? 120 : -120);
        await page.waitForTimeout(100);
      }
    })();
    const zoomMetricsPromise = measurePerformanceInterval(page, 3000);
    const [, zoomMetrics] = await Promise.all([zoomPromise, zoomMetricsPromise]);
    benchmarkResults["6_camera_zoom"] = zoomMetrics;

    // 7. Character Animations Benchmark
    console.log("Measuring 7. Character animations steady-state...");
    benchmarkResults["7_character_animations"] = await measurePerformanceInterval(page, 3000);

    // 8. Idle Application Benchmark (15 seconds steady idle)
    console.log("Measuring 8. Idle application...");
    benchmarkResults["8_idle_steady_state"] = await measurePerformanceInterval(page, 15000);

    // Comparative Benchmark: Workforce Enabled vs Character Animation Temporarily Disabled
    console.log("Measuring Comparative: Floor 5 Workforce Enabled...");
    benchmarkResults["comparison_workforce_enabled"] = await measurePerformanceInterval(page, 4000);

    console.log("Disabling character animation ticks...");
    await page.evaluate(() => {
      (window as any).__MY_OFFICE_ANIMATION_DISABLED__ = true;
    });
    await page.waitForTimeout(500);

    console.log("Measuring Comparative: Floor 5 Animation Disabled...");
    benchmarkResults["comparison_animation_disabled"] = await measurePerformanceInterval(page, 4000);

    // Re-enable animation
    await page.evaluate(() => {
      (window as any).__MY_OFFICE_ANIMATION_DISABLED__ = false;
    });

    // Write benchmark results
    fs.writeFileSync(BENCHMARK_OUT, JSON.stringify(benchmarkResults, null, 2));
    console.log("Benchmark results saved to:", BENCHMARK_OUT);
    console.log("Comparative Summary:");
    console.log("  With Animation:    ", benchmarkResults["comparison_workforce_enabled"].avgFps, "FPS,", benchmarkResults["comparison_workforce_enabled"].drawCalls, "calls");
    console.log("  Animation Disabled:", benchmarkResults["comparison_animation_disabled"].avgFps, "FPS,", benchmarkResults["comparison_animation_disabled"].drawCalls, "calls");
  });

  test("Phase 6: Specialist Recruitment Regression Tests", async ({ page }) => {
    await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    // 1. Verify Specialist Recruitment modal in UI
    const recruitBtn = page.locator("button", { hasText: /Chiêu Mộ/i });
    await expect(recruitBtn).toBeVisible({ timeout: 15000 });
    await recruitBtn.click();
    await page.waitForTimeout(1500);

    // Modal loaded and displays count
    await expect(page.locator("text=Specialist Recruitment & Talent Hub")).toBeVisible();
    await expect(page.locator("text=/\\d+ Specialists in Library/")).toBeVisible();

    // 2. Test API Recruitment Authentication & Duplicate Prevention
    const apiTestResults = await page.evaluate(async () => {
      const results: any = {};

      // Test A: Unauthorized recruitment rejected (401)
      try {
        const unauthRes = await fetch("http://127.0.0.1:8000/api/v1/recruitment/recruit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ specialist_id: "academic-psychologist" }),
        });
        results.unauth_status = unauthRes.status;
      } catch (e: any) {
        results.unauth_error = e.message;
      }

      // Test B: Authenticated duplicate recruitment rejected (400)
      const token = localStorage.getItem("provipagent_auth_token") || localStorage.getItem("auth_token");
      try {
        const dupRes = await fetch("http://127.0.0.1:8000/api/v1/recruitment/recruit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Organization-Id": "org_default_company",
          },
          body: JSON.stringify({
            specialist_id: "academic-psychologist",
            recruited_by: "agent-exec-ceo",
          }),
        });
        results.dup_status = dupRes.status;
        results.dup_body = await dupRes.json();
      } catch (e: any) {
        results.dup_error = e.message;
      }

      return results;
    });

    console.log("Recruitment Regression API results:", apiTestResults);
    expect(apiTestResults.unauth_status).toBe(401);
    expect(apiTestResults.dup_status).toBe(400);
    const errMsg = apiTestResults.dup_body?.error?.message || apiTestResults.dup_body?.detail || JSON.stringify(apiTestResults.dup_body);
    expect(errMsg).toContain("already recruited");
  });
});

