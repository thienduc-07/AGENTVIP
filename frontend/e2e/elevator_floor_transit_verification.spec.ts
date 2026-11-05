import { test, expect } from "@playwright/test";

test("Elevator Transit and Floor Synchronization Across All 6 Floors", async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1920, height: 1080 });

  // 1. Navigate to My Office Diorama
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  // 2. Wait for full workforce to load into Chibi dictionary (>200 agents)
  await page.waitForFunction(() => {
    const chibis = (window as any).__MY_OFFICE_CHIBIS__;
    return chibis && Object.keys(chibis).length > 200;
  }, { timeout: 45000 });

  await page.waitForTimeout(2000);

  const screenshotDir = "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a/screenshots/floor_sync";

  // Verify floors 1 to 6
  const floors = [1, 2, 3, 4, 5, 6];

  for (const f of floors) {
    // Click floor button in quick floor tabs
    const floorBtn = page.locator(`button:has-text("${f}F")`).first();
    await floorBtn.click();

    // Wait for elevator transit and camera interpolation
    await page.waitForTimeout(1800);

    // Verify 3D scene state for floor f
    const floorInfo = await page.evaluate((targetFloor) => {
      const scene = (window as any).__MY_OFFICE_SCENE__;
      const chibis = (window as any).__MY_OFFICE_CHIBIS__ || {};
      
      let floorGroupVisible = false;
      let meshCountOnFloor = 0;
      let chibisOnFloor = 0;

      if (scene) {
        scene.traverse((obj: any) => {
          if (obj.isMesh) {
            let p = obj.parent;
            while (p && p !== scene) {
              if (p.position && Math.abs(p.position.y - (targetFloor - 1) * 8.5) < 0.1) {
                meshCountOnFloor++;
                floorGroupVisible = p.visible;
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

      return { floorGroupVisible, meshCountOnFloor, chibisOnFloor };
    }, f);

    console.log(`Floor ${f}F Info:`, floorInfo);
    expect(floorInfo.floorGroupVisible).toBe(true);
    expect(floorInfo.meshCountOnFloor).toBeGreaterThan(15);
    expect(floorInfo.chibisOnFloor).toBeGreaterThan(0);

    // Capture screenshot
    await page.screenshot({ path: `${screenshotDir}/floor_${f}f_synchronized.png` });
  }

  // Finally test returning to 5F after round-trip elevator transit
  const return5FBtn = page.locator('button:has-text("5F")').first();
  await return5FBtn.click();
  await page.waitForTimeout(1800);

  const final5FInfo = await page.evaluate(() => {
    const chibis = (window as any).__MY_OFFICE_CHIBIS__ || {};
    let count5F = 0;
    Object.values(chibis).forEach((c: any) => {
      if (c.floor === 5) count5F++;
    });
    return { count5F };
  });

  console.log("Final 5F Chibi Count:", final5FInfo.count5F);
  expect(final5FInfo.count5F).toBeGreaterThanOrEqual(100);

  await page.screenshot({ path: `${screenshotDir}/floor_5f_roundtrip_verified.png` });
});
