import { test, expect } from "@playwright/test";

test("AGENT CITY — ARCHITECTURAL REALISM, COLLISION & FLOOR DIVERSITY REMEDIATION", async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1920, height: 1080 });

  const screenshotDir = "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a/screenshots/architectural_realism";

  // 1. Navigate to Diorama
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  // 2. Wait for full workforce to load into Chibi dictionary (>200 agents)
  await page.waitForFunction(() => {
    const chibis = (window as any).__MY_OFFICE_CHIBIS__;
    return chibis && Object.keys(chibis).length > 200;
  }, { timeout: 60000 });

  await page.waitForTimeout(2000);

  // 3. VERIFY CENTRALIZED ENVIRONMENT REGISTRY
  console.log("Verifying centralized environment registry...");
  const envAudit = await page.evaluate(() => {
    const reg = (window as any).__MY_OFFICE_ENV_REGISTRY__;
    if (!reg) return { hasRegistry: false };

    const results: Record<number, { hasBilliards: boolean; hasRestroom: boolean; types: string[] }> = {};
    for (let f = 1; f <= 6; f++) {
      const pts = (typeof reg.getPointsOnFloor === "function" ? reg.getPointsOnFloor(f) : reg.getInteractions(f)) || [];
      const types = Array.from(new Set(pts.map((p: any) => p.type)));
      const hasBilliards = pts.some((p: any) => p.type === "billiards");
      const hasRestroom = pts.some((p: any) => p.type === "restroom");
      results[f] = { hasBilliards, hasRestroom, types: types as string[] };
    }
    return { hasRegistry: true, results };
  });

  expect(envAudit.hasRegistry).toBe(true);
  expect(envAudit.results).toBeDefined();
  if (!envAudit.results) throw new Error("Missing envAudit results");
  console.log("Environment registry audit results:", JSON.stringify(envAudit.results, null, 2));

  // Assertions: Billiards ONLY on Floor 6
  expect(envAudit.results[1].hasBilliards).toBe(false);
  expect(envAudit.results[2].hasBilliards).toBe(false);
  expect(envAudit.results[3].hasBilliards).toBe(false);
  expect(envAudit.results[4].hasBilliards).toBe(false);
  expect(envAudit.results[5].hasBilliards).toBe(false);
  expect(envAudit.results[6].hasBilliards).toBe(true);

  // Assertions: Restroom present on ALL floors
  for (let f = 1; f <= 6; f++) {
    expect(envAudit.results[f].hasRestroom).toBe(true);
  }
  console.log("PASSED: Stale employee behavior decoupled. Billiards exclusive to 6F; Restrooms on all floors.");

  // 4. VERIFY COLLISION REGISTRY
  console.log("Verifying collision registry...");
  const colAudit = await page.evaluate(() => {
    const col = (window as any).__MY_OFFICE_COLLISION_REGISTRY__;
    if (!col) return { hasCollision: false };

    const results: Record<number, { obstacleCount: number; hasPerimeter: boolean; hasStairs: boolean; hasRestroom: boolean }> = {};
    for (let f = 1; f <= 6; f++) {
      const obs = col.getObstacles(f) || [];
      const hasPerimeter = obs.some((o: any) => o.id.startsWith("wall-"));
      const hasStairs = obs.some((o: any) => o.id.includes("stairs") || o.id.includes("elevator"));
      const hasRestroom = obs.some((o: any) => o.id.includes("restroom"));
      results[f] = { obstacleCount: obs.length, hasPerimeter, hasStairs, hasRestroom };
    }
    return { hasCollision: true, results };
  });

  expect(colAudit.hasCollision).toBe(true);
  expect(colAudit.results).toBeDefined();
  if (!colAudit.results) throw new Error("Missing colAudit results");
  console.log("Collision registry audit results:", JSON.stringify(colAudit.results, null, 2));

  for (let f = 1; f <= 6; f++) {
    expect(colAudit.results[f].obstacleCount).toBeGreaterThan(10);
    expect(colAudit.results[f].hasPerimeter).toBe(true);
    expect(colAudit.results[f].hasStairs).toBe(true);
    expect(colAudit.results[f].hasRestroom).toBe(true);
  }
  console.log("PASSED: Comprehensive obstacle AABBs registered across all 6 floors.");

  // 5. VERIFY UI OVERLAP REMEDIATION
  console.log("Verifying UI layout: Chat sidebar and bottom dock non-overlapping...");
  const overlapCheck = await page.evaluate(() => {
    const rightAside = document.querySelector("aside.right-3") || Array.from(document.querySelectorAll("aside")).find(el => el.classList.contains("right-3"));
    const dock = document.querySelector("div.fixed.bottom-3");
    if (!rightAside || !dock) return { found: false };

    const asideRect = rightAside.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();

    // Check if horizontal ranges overlap
    const horizontalOverlap = dockRect.right > asideRect.left && dockRect.left < asideRect.right;
    const verticalOverlap = dockRect.bottom > asideRect.top && dockRect.top < asideRect.bottom;
    const isOverlapping = horizontalOverlap && verticalOverlap;

    return {
      found: true,
      isOverlapping,
      asideLeft: asideRect.left,
      dockRight: dockRect.right,
      gap: asideRect.left - dockRect.right
    };
  });

  expect(overlapCheck.found).toBe(true);
  expect(overlapCheck.isOverlapping).toBe(false);
  expect(overlapCheck.gap).toBeGreaterThan(0);
  console.log(`PASSED: Zero UI overlap! Safe clearance gap between dock and chat panel: ${overlapCheck.gap}px.`);

  // Verify chat form is interactive and unobstructed
  const chatTab = page.locator('button:has-text("Trò chuyện AI")').first();
  await chatTab.click({ force: true });
  await page.waitForTimeout(600);

  const chatInput = page.locator("form textarea").first();
  await expect(chatInput).toBeVisible();
  await chatInput.fill("1+1");
  await chatInput.press("Enter");

  const responseBubble = page.locator('.overflow-y-auto').locator('text=2');
  await expect(responseBubble.first()).toBeVisible({ timeout: 10000 });
  console.log("PASSED: Fast Chatbot verified with non-overlapping UI!");

  await page.screenshot({ path: `${screenshotDir}/07_ui_safe_dock_no_overlap.png` });

  // 6. CAPTURE ARCHITECTURAL FLOOR SCREENS (1F TO 6F)
  console.log("Capturing architectural diorama for 1F (Reception, Lobby, Wellness)...");
  await page.locator('button:has-text("1F")').first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${screenshotDir}/01_floor_1f_reception_restroom_stairs.png` });

  console.log("Capturing architectural diorama for 2F (Financial Treasury & Vault)...");
  await page.locator('button:has-text("2F")').first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${screenshotDir}/02_floor_2f_treasury_vault.png` });

  console.log("Capturing architectural diorama for 3F (Marketing Amphitheater & Podcast Booth)...");
  await page.locator('button:has-text("3F")').first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${screenshotDir}/03_floor_3f_marketing_amphitheater_podcast.png` });

  console.log("Capturing architectural diorama for 4F (Spatial Computing AR/VR Lab)...");
  await page.locator('button:has-text("4F")').first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${screenshotDir}/04_floor_4f_spatial_computing_vr_lab.png` });

  console.log("Capturing architectural diorama for 5F (Core Engineering & SOC Command)...");
  await page.locator('button:has-text("5F")').first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${screenshotDir}/05_floor_5f_soc_command_server_bank.png` });

  console.log("Capturing architectural diorama for 6F (Penthouse Billiards, Arcade & Boardroom)...");
  await page.locator('button:has-text("6F")').first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${screenshotDir}/06_floor_6f_penthouse_billiards_arcade_boardroom.png` });

  console.log("ALL ARCHITECTURAL REALISM & COLLISION AUDIT TESTS PASSED SUCCESSFULLY!");
});

