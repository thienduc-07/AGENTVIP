import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const SCREENSHOT_DIR = "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a/screenshots/agent_city_5_2";

test.describe("Agent City 5.2 — High-Aesthetics Cozy Office & Autonomous Simulation", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
  });

  test("Verify 4-person pods, recreation chill zone, tracking mode, and clean chat", async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 1920, height: 1080 });

    // 1. Navigate to MyOffice Diorama
    await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

    // Wait for full backend workforce population (276 Nhân Sự)
    await page.waitForFunction(() => {
      const chibis = (window as any).__MY_OFFICE_CHIBIS__;
      return chibis && Object.keys(chibis).length > 200;
    }, { timeout: 35000 });

    // 2. Verify Recruitment Button is REMOVED
    const recruitmentBtn = page.getByText("Chiêu Mộ (268 Chuyên Gia)");
    await expect(recruitmentBtn).toHaveCount(0);
    console.log("Verified: 'Chiêu Mộ (268 Chuyên Gia)' button is successfully removed.");

    // 3. Inspect Scene Objects (4-person pods & Recreation Chill Zone)
    const sceneAnalysis = await page.evaluate(() => {
      const scene = (window as any).__MY_OFFICE_SCENE__;
      const chibis = (window as any).__MY_OFFICE_CHIBIS__;
      if (!scene) return { error: "Scene not found" };

      let podCount = 0;
      let billiardsCount = 0;
      let arcadeCount = 0;
      let ramenBarCount = 0;
      let coffeeMachineCount = 0;
      let waterDispenserCount = 0;
      let artPaintingCount = 0;

      scene.traverse((obj: any) => {
        const name = (obj.name || "").toLowerCase();
        if (name.includes("pod")) podCount++;
        if (name.includes("billiards")) billiardsCount++;
        if (name.includes("arcade")) arcadeCount++;
        if (name.includes("ramen")) ramenBarCount++;
        if (name.includes("coffee") || name.includes("espresso")) coffeeMachineCount++;
        if (name.includes("water") || name.includes("cooler")) waterDispenserCount++;
        if (name.includes("art") || name.includes("painting")) artPaintingCount++;
      });

      const chibiKeys = chibis ? Object.keys(chibis) : [];
      const sittingCount = chibiKeys.filter(k => chibis[k].state === "sitting").length;

      return {
        hasScene: true,
        totalChibis: chibiKeys.length,
        sittingCount,
        podCount,
        billiardsCount,
        arcadeCount,
        ramenBarCount,
        coffeeMachineCount,
        waterDispenserCount,
        artPaintingCount,
      };
    });

    console.log("Scene Analysis:", JSON.stringify(sceneAnalysis, null, 2));
    expect(sceneAnalysis.hasScene).toBe(true);
    expect(sceneAnalysis.totalChibis).toBeGreaterThan(200);

    // 4. Navigate to Floor 5F (Engineering, GIS, SOC)
    const floor5Btn = page.getByRole("button", { name: /5F/i }).first();
    await floor5Btn.click();
    await page.waitForTimeout(2500);

    // Capture 5F Diorama Overview
    const shot1Path = path.join(SCREENSHOT_DIR, "01_5f_cozy_diorama_overview.png");
    await page.screenshot({ path: shot1Path, fullPage: true });
    console.log(`Saved screenshot: ${shot1Path}`);

    // 5. Trigger Autonomous Breaks & Orient Camera towards Recreation Chill Zone
    await page.evaluate(() => {
      const chibis = (window as any).__MY_OFFICE_CHIBIS__;
      if (chibis) {
        const f5Chibis = Object.values(chibis).filter((c: any) => c.floor === 5);
        if (f5Chibis.length > 0) (f5Chibis[0] as any).takeBreak("billiards", 45);
        if (f5Chibis.length > 1) (f5Chibis[1] as any).takeBreak("gaming", 45);
        if (f5Chibis.length > 2) (f5Chibis[2] as any).takeBreak("snack", 45);
        if (f5Chibis.length > 3) (f5Chibis[3] as any).takeBreak("coffee", 45);
      }
    });

    await page.waitForTimeout(1500);

    const shot2Path = path.join(SCREENSHOT_DIR, "02_recreation_chill_zone_closeup.png");
    await page.screenshot({ path: shot2Path, fullPage: true });
    console.log(`Saved screenshot: ${shot2Path}`);

    // 6. Test Character Close-up Tracking Mode
    // Activate tracking on David Chen (agent-eng-lead)
    await page.evaluate(() => {
      const trackFn = (window as any).__MY_OFFICE_TRACK_AGENT__;
      if (trackFn) {
        trackFn("agent-eng-lead");
      }
    });

    await page.waitForTimeout(2000);

    // Verify Floating Character Tracking HUD pill is visible
    const trackingHudPill = page.getByText(/Thoát \(Esc\)/i);
    await expect(trackingHudPill).toBeVisible();

    const shot3Path = path.join(SCREENSHOT_DIR, "03_character_tracking_mode.png");
    await page.screenshot({ path: shot3Path, fullPage: true });
    console.log(`Saved screenshot: ${shot3Path}`);

    // Test Esc Key closes tracking mode
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
    await expect(trackingHudPill).not.toBeVisible();

    // 7. Verify Chatbot Direct Response Without Preamble
    const chatInput = page.getByPlaceholder(/Nhắn câu hỏi AI|Nhắn tin với AI/i);
    await expect(chatInput).toBeVisible();

    await chatInput.fill("GraphQL khác REST API như thế nào trong hệ thống của chúng ta?");
    
    // Submit query
    const submitBtn = page.locator("form button[type='submit']");
    await submitBtn.click();

    // Wait for the new response to arrive (timeout up to 45s for LLM processing)
    const assistantResponses = page.locator(".max-w-\\[95\\%\\]");
    await expect(assistantResponses).toHaveCount(2, { timeout: 45000 });

    const responseBubble = assistantResponses.nth(1);
    const messageText = await responseBubble.textContent();
    console.log("Chatbot Output:", messageText);

    // STRICT USER REQUIREMENT:
    // Chatbot must NOT announce "Chào bạn, tôi là... / Chuyên gia ... đảm nhận"
    expect(messageText).not.toContain("Chào bạn, tôi là");
    expect(messageText).not.toContain("Chào bạn, mình là");
    expect(messageText).not.toContain("Tôi là Amara");
    expect(messageText).not.toContain("được chuyển cho chuyên gia");

    // Must contain direct technical insights about GraphQL vs REST
    expect(messageText?.toLowerCase()).toContain("graphql");

    const shot4Path = path.join(SCREENSHOT_DIR, "04_chatbot_clean_direct_response.png");
    await page.screenshot({ path: shot4Path, fullPage: true });
    console.log(`Saved screenshot: ${shot4Path}`);
  });
});
