import { test, expect } from "@playwright/test";
import path from "path";

const SCREENSHOT_DIR = "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a/screenshots/agent_city_5_1_9";

test.describe("AGENT CITY 5.1.9 — Targeted Specialist Verification: 3D Scene Developer & GIS 3D Scene Developer", () => {
  test("Verify 3D & Scene Developer in 3D Diorama, Workstation, and Catalog Search", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

    // Wait for full backend workforce population (276 Nhân Sự)
    const workforceBadge = page.locator("text=/\\d+ Nhân Sự/");
    await expect(workforceBadge).toBeVisible({ timeout: 25000 });

    // 1. Introspect Frontend Chibi Registry for 3D Scene Developer / GIS 3D Scene Developer
    const chibiData = await page.evaluate(() => {
      const chibis = (window as any).__MY_OFFICE_CHIBIS__ || {};
      const allKeys = Object.keys(chibis);

      // Search for any chibis matching 3d or scene
      const matching = allKeys.filter(k => k.toLowerCase().includes("3d") || k.toLowerCase().includes("scene"));
      const targetAgent = chibis["agent-spec-gis-3d-scene-developer"];

      let targetDetails = null;
      if (targetAgent) {
        targetDetails = {
          id: targetAgent.cfg?.id,
          name: targetAgent.cfg?.name,
          role: targetAgent.cfg?.role,
          division: targetAgent.cfg?.division,
          floor: targetAgent.floor,
          deskPos: targetAgent.cfg?.deskPos,
          chairPos: targetAgent.cfg?.chairPos,
          rootPos: targetAgent.root ? {
            x: targetAgent.root.position.x,
            y: targetAgent.root.position.y,
            z: targetAgent.root.position.z,
          } : null,
          hasRootGroup: !!targetAgent.root,
          state: targetAgent.state,
        };
      }

      return {
        totalChibis: allKeys.length,
        matchingKeys: matching,
        targetDetails,
      };
    });

    console.log("Chibi Registry Introspection:", JSON.stringify(chibiData, null, 2));
    expect(chibiData.targetDetails).not.toBeNull();
    const td = chibiData.targetDetails!;
    expect(td.id).toBe("agent-spec-gis-3d-scene-developer");
    expect(td.name).toBe("3D & Scene Developer");
    expect(td.division).toBe("gis");
    expect(td.floor).toBe(5);
    expect(td.hasRootGroup).toBe(true);

    // 2. Switch to Floor 5F (Engineering & GIS Center)
    const floor5Btn = page.getByRole("button", { name: /5F/i }).first();
    await floor5Btn.click();
    await page.waitForTimeout(2000);

    // Capture screenshot of Floor 5F focusing on GIS Center
    const deskShotPath = path.join(SCREENSHOT_DIR, "targeted_gis_3d_scene_developer_desk.png");
    await page.screenshot({ path: deskShotPath, fullPage: false });
    console.log("Captured targeted workstation screenshot ->", deskShotPath);

    // 3. Open Specialist Recruitment modal and test search
    const recruitBtn = page.locator("button", { hasText: /Chiêu Mộ/i });
    await recruitBtn.click();
    await page.waitForTimeout(1500);

    // Modal loaded
    await expect(page.locator("text=Specialist Recruitment & Talent Hub")).toBeVisible();

    // Type "3D Scene Developer" into catalog search
    const searchInput = page.getByPlaceholder(/Search by name/i);
    await searchInput.fill("3D Scene Developer");
    await page.waitForTimeout(1000);

    // Verify specialist card appears
    const specialistCard = page.locator("text=3D & Scene Developer").first();
    await expect(specialistCard).toBeVisible({ timeout: 5000 });

    const searchShotPath = path.join(SCREENSHOT_DIR, "targeted_recruitment_search_3d_scene_developer.png");
    await page.screenshot({ path: searchShotPath, fullPage: false });
    console.log("Captured catalog search screenshot ->", searchShotPath);
  });
});

