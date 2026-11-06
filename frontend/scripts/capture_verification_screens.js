const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  console.log("Navigating to http://localhost:3000...");
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  const outDir = "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a";

  // Capture current floor (Floor 5F default)
  console.log("Capturing Floor 5F render...");
  await page.screenshot({ path: path.join(outDir, "live_floor5_render_v4.png") });

  // Navigate to Floor 1F
  console.log("Navigating to 1F...");
  const btn1F = page.locator("button:has-text('1F')").first();
  if (await btn1F.count() > 0) {
    await btn1F.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(outDir, "live_floor1_render_v4.png") });
  }

  // Navigate to Floor 6F
  console.log("Navigating to 6F...");
  const btn6F = page.locator("button:has-text('6F')").first();
  if (await btn6F.count() > 0) {
    await btn6F.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(outDir, "live_floor6_render_v4.png") });
  }

  // Navigate to Floor 7F
  console.log("Navigating to 7F (Recreation)...");
  const btn7F = page.locator("button:has-text('7F')").first();
  if (await btn7F.count() > 0) {
    await btn7F.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(outDir, "live_floor7_render_v4.png") });
  }

  console.log("Screenshots saved successfully.");
  await browser.close();
})();

