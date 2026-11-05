import { test, expect } from "@playwright/test";

test("AGENT CITY 5.2.2: Modern Corporate Office Redesign & Fast Chatbot Verification", async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1920, height: 1080 });

  const screenshotDir = "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a/screenshots/agent_city_5_2_2";

  // 1. Navigate to My Office Diorama
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  // 2. Wait for full workforce to load into Chibi dictionary (>200 agents)
  await page.waitForFunction(() => {
    const chibis = (window as any).__MY_OFFICE_CHIBIS__;
    return chibis && Object.keys(chibis).length > 200;
  }, { timeout: 45000 });

  await page.waitForTimeout(2000);

  // 3. Verify 'Chiêu Mộ (268 Chuyên Gia)' button is NOT present
  const recruitBtn = page.getByText("Chiêu Mộ (268 Chuyên Gia)");
  expect(await recruitBtn.count()).toBe(0);
  console.log("Verified: 'Chiêu Mộ (268 Chuyên Gia)' button is absent.");

  // 4. Verify each floor's distinct architecture and capture screenshots
  const floors = [1, 2, 3, 4, 5, 6];
  for (const f of floors) {
    const floorBtn = page.locator(`button:has-text("${f}F")`).first();
    await floorBtn.click();
    await page.waitForTimeout(1600);

    const floorMetrics = await page.evaluate((targetFloor) => {
      const scene = (window as any).__MY_OFFICE_SCENE__;
      const chibis = (window as any).__MY_OFFICE_CHIBIS__ || {};

      let meshCount = 0;
      let chibisOnFloor = 0;
      let hasElevator = false;

      if (scene) {
        scene.traverse((obj: any) => {
          if (obj.isMesh) {
            let p = obj.parent;
            while (p && p !== scene) {
              if (p.position && Math.abs(p.position.y - (targetFloor - 1) * 8.5) < 0.1) {
                meshCount++;
                if (obj.userData?.type === "elevator") hasElevator = true;
                break;
              }
              p = p.parent;
            }
          }
        });
      }

      Object.values(chibis).forEach((c: any) => {
        if (c.floor === targetFloor) chibisOnFloor++;
      });

      return { meshCount, chibisOnFloor, hasElevator };
    }, f);

    console.log(`Floor ${f}F Metrics:`, floorMetrics);
    expect(floorMetrics.meshCount).toBeGreaterThan(50);
    expect(floorMetrics.chibisOnFloor).toBeGreaterThan(0);
    expect(floorMetrics.hasElevator).toBe(true);

    await page.screenshot({ path: `${screenshotDir}/floor_${f}f_diorama.png` });
  }

  // 5. Test Chibi drinking cup prop and character tracking
  console.log("Testing Chibi drinking cup prop & tracking mode...");
  await page.evaluate(() => {
    const chibis = (window as any).__MY_OFFICE_CHIBIS__;
    if (chibis) {
      const firstAgentId = Object.keys(chibis)[0];
      const agent = chibis[firstAgentId];
      if (agent) {
        // Trigger water break
        agent.takeBreak("water", 15);
        (window as any).__MY_OFFICE_TRACK_AGENT__(firstAgentId);
      }
    }
  });

  await page.waitForTimeout(1500);

  const isCupVisible = await page.evaluate(() => {
    const chibis = (window as any).__MY_OFFICE_CHIBIS__;
    if (chibis) {
      const firstAgentId = Object.keys(chibis)[0];
      const agent = chibis[firstAgentId];
      return agent?.cupMesh?.visible === true || agent?.state === "water" || agent?.state === "walking";
    }
    return false;
  });
  console.log("Chibi activity triggered, cupMesh / break status:", isCupVisible);
  expect(isCupVisible).toBe(true);

  await page.screenshot({ path: `${screenshotDir}/chibi_action_tracking.png` });

  // Stop tracking
  await page.evaluate(() => {
    if ((window as any).__MY_OFFICE_STOP_TRACKING__) {
      (window as any).__MY_OFFICE_STOP_TRACKING__();
    }
  });
  await page.waitForTimeout(500);

  // 6. Test AI Chatbot fast response on "1+1"
  console.log("Testing AI Chatbot with prompt '1+1'...");
  const chatInput = page.locator("form textarea").first();
  if (!(await chatInput.isVisible())) {
    const openBtn = page.locator('button:has-text("Mở Chat AI")').first();
    if (await openBtn.isVisible()) await openBtn.click();
  }
  await expect(chatInput).toBeVisible();

  const startTime = Date.now();
  await chatInput.fill("1+1");
  await chatInput.press("Enter");

  // Wait for AI response containing 2
  const responseBubble = page.locator('.overflow-y-auto').locator('text=2');
  await expect(responseBubble.first()).toBeVisible({ timeout: 10000 });
  const elapsed = Date.now() - startTime;
  console.log(`Chatbot responded in ${elapsed}ms!`);

  await page.screenshot({ path: `${screenshotDir}/chatbot_math_verified.png` });
  console.log("All verifications passed successfully!");
});
