import { test, expect } from "@playwright/test";

test.describe("Agent City 5.1.8 — Automatic Workforce Provisioning & Roster Verification", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to local 3D office app
    await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500); // Allow Three.js and API workforce sync
  });

  test("HUD reflects full enterprise workforce and active floor personnel", async ({ page }) => {
    // 1. Verify Top HUD Brand and Personnel Badge
    const hudBadge = page.locator("text=/\\d+ Nhân Sự/");
    await expect(hudBadge).toBeVisible({ timeout: 15000 });
    const badgeText = await hudBadge.textContent();
    console.log("HUD Workforce Badge Text:", badgeText);

    // 2. Take screenshot of 5F Engineering with full workforce
    await page.screenshot({
      path: "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a/screenshots/agent_city_5_1_8/01_5f_workforce_populated.png",
      fullPage: false,
    });

    // 3. Switch to Floor 2F (Finance & Specialized Advisory)
    const floor2Btn = page.getByRole("button", { name: /2F/i }).first();
    await floor2Btn.click();
    await page.waitForTimeout(2000);

    // Verify Floor 2F Header and screenshot
    await expect(page.locator("text=Tầng 2 (2F)")).toBeVisible();
    await page.screenshot({
      path: "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a/screenshots/agent_city_5_1_8/02_2f_specialized_advisory.png",
      fullPage: false,
    });

    // 4. Switch to Floor 6F (Executive Suite & AI Research)
    const floor6Btn = page.getByRole("button", { name: /6F/i }).first();
    await floor6Btn.click();
    await page.waitForTimeout(2000);

    await expect(page.locator("text=Tầng 6 (6F)")).toBeVisible();
    await page.screenshot({
      path: "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a/screenshots/agent_city_5_1_8/03_6f_executive_suite.png",
      fullPage: false,
    });
  });

  test("Specialist Recruitment modal loads seamlessly without 401 error and shows catalog", async ({ page }) => {
    // Open recruitment modal
    const recruitBtn = page.locator("button", { hasText: /Chiêu Mộ/i });
    await recruitBtn.click();
    await page.waitForTimeout(1500);

    // Verify modal header
    await expect(page.locator("text=Specialist Recruitment & Talent Hub")).toBeVisible();
    await expect(page.locator("text=/\\d+ Specialists in Library/")).toBeVisible();

    // Verify specialist cards are loaded from backend
    const specialistCards = page.locator("button:has-text('Inspect & Recruit')");
    await expect(specialistCards.first()).toBeVisible({ timeout: 10000 });

    // Inspect first specialist
    await specialistCards.first().click();
    await page.waitForTimeout(1000);

    // Verify drawer details
    await expect(page.locator("text=Primary Role & Mission")).toBeVisible();

    // Take screenshot of recruitment hub & active status
    await page.screenshot({
      path: "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a/screenshots/agent_city_5_1_8/04_recruitment_modal_active.png",
      fullPage: false,
    });
  });
});
