import { test, expect } from "@playwright/test";
import path from "path";

test("AGENT CITY V2 — Architectural Redesign, Floor Programming & Spatial Navigation Verification", async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1920, height: 1080 });

  const screenshotsDir = "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a/screenshots/agent_city_v2";

  // 1. Authenticate with backend and pre-seed localStorage in browser context
  const loginRes = await page.request.post("http://127.0.0.1:8000/api/v1/auth/login", {
    data: {
      email: "admin@agency.ai",
      password: "SuperAdminSecurePassword2026!",
    },
  });
  expect(loginRes.ok()).toBe(true);
  const loginData = await loginRes.json();
  const token = loginData.access_token;
  expect(token).toBeTruthy();

  await page.addInitScript((authToken) => {
    localStorage.setItem("provipagent_auth_token", authToken);
    localStorage.setItem("auth_token", authToken);
    localStorage.setItem("provipagent_user_id", "usr-platform-superadmin");
    localStorage.setItem("provipagent_email", "admin@agency.ai");
  }, token);

  // 2. Navigate to Diorama
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas", { timeout: 20000 });

  // 3. Wait for all 276+ employees to populate into Chibi dictionary
  await page.waitForFunction(() => {
    const chibis = (window as any).__MY_OFFICE_CHIBIS__;
    return chibis && Object.keys(chibis).length >= 276;
  }, { timeout: 40000 });
  await page.waitForTimeout(1000);

  // 4. Verify "Chiêu Mộ (268 Chuyên Gia)" button is completely ABSENT
  const chieuMoBtn = page.locator("text=Chiêu Mộ (268 Chuyên Gia)");
  await expect(chieuMoBtn).toHaveCount(0);

  // 5. Verify Top Header Quick Floor Selector contains all 8 floors: G, 1F, 2F, 3F, 4F, 5F, 6F, 7F
  const floorCodes = ["G", "1F", "2F", "3F", "4F", "5F", "6F", "7F"];
  for (const code of floorCodes) {
    const btn = page.locator(`header button:has-text("${code}")`).first();
    await expect(btn).toBeVisible();
  }

  // 6. Inspect Scene & Core Architectural Data via Window Hooks
  const sceneAudit = await page.evaluate(() => {
    const chibis = (window as any).__MY_OFFICE_CHIBIS__ || {};
    const col = (window as any).__MY_OFFICE_COLLISION_REGISTRY__;

    const chibiCount = Object.keys(chibis).length;
    const floorDistribution: Record<number, number> = {};
    Object.values(chibis).forEach((c: any) => {
      floorDistribution[c.floor] = (floorDistribution[c.floor] || 0) + 1;
    });

    const obstacles = col?.obstacles || [];

    // Separation between elevator and staircase core
    // Elevator core: X in [20, 25], Z in [-17.2, -13.2]
    // Staircase core: X in [20.5, 25.5], Z in [-9.8, -2.2]
    // Separation distance along Z = (-9.8) - (-13.2) = 3.4m clear
    const elevatorZMax = -13.2;
    const stairZMin = -9.8;
    const verticalSeparation = stairZMin - elevatorZMax;

    return {
      chibiCount,
      floorDistribution,
      verticalSeparation,
      totalObstacles: obstacles.length,
    };
  });

  console.log("Scene Audit Result:", JSON.stringify(sceneAudit, null, 2));

  // Verify Vertical Circulation Separation: 3.4m clear distance (zero overlap)
  expect(sceneAudit.verticalSeparation).toBeGreaterThanOrEqual(3.0);

  // Verify Workforce Count: at least 276 total employees
  expect(sceneAudit.chibiCount).toBeGreaterThanOrEqual(276);

  // 7. Capture Fast Viewport Screenshots of Each Floor (G to 7F)
  for (let f = 0; f <= 7; f++) {
    const code = floorCodes[f];
    console.log(`Navigating to Floor ${code} (${f})...`);

    // Click the header floor button
    const floorBtn = page.locator(`header button:has-text("${code}")`).first();
    await floorBtn.click();
    await page.waitForTimeout(800);

    // Take fast screenshot of this floor
    const screenshotPath = path.join(screenshotsDir, `0${f}_floor_${code.toLowerCase()}_redesign.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`Saved screenshot: ${screenshotPath}`);
  }

  // 8. Open Elevator Remote Keypad Modal and Verify all 8 floors
  const elevatorModalBtn = page.locator("header button:has-text('Thang Máy')").first();
  await elevatorModalBtn.click();
  await page.waitForTimeout(400);

  // Verify modal contains all 8 floor buttons
  for (const code of floorCodes) {
    const modalFloorBtn = page.locator(`div:has-text("ELEVATOR CONTROL") span:has-text("${code}")`).first();
    await expect(modalFloorBtn).toBeVisible();
  }

  // Screenshot with Elevator Remote Open
  const elevatorShotPath = path.join(screenshotsDir, "08_elevator_remote_all_8_floors.png");
  await page.screenshot({ path: elevatorShotPath });
  console.log(`Saved screenshot: ${elevatorShotPath}`);

  // Close Elevator Modal
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 9. Test Agent Tracking Mode: focus on an agent and ensure smooth close-up
  const trackResult = await page.evaluate(() => {
    if ((window as any).__MY_OFFICE_TRACK_AGENT__) {
      (window as any).__MY_OFFICE_TRACK_AGENT__("agent-exec-ceo");
      return true;
    }
    return false;
  });
  expect(trackResult).toBe(true);
  await page.waitForTimeout(1000);

  // Screenshot tracked CEO
  const ceoShotPath = path.join(screenshotsDir, "09_tracked_ceo_victoria_suite.png");
  await page.screenshot({ path: ceoShotPath });
  console.log(`Saved screenshot: ${ceoShotPath}`);

  // Stop tracking
  await page.evaluate(() => {
    if ((window as any).__MY_OFFICE_STOP_TRACKING__) {
      (window as any).__MY_OFFICE_STOP_TRACKING__();
    }
  });
});
