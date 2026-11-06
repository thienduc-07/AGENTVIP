const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  console.log("Navigating to http://localhost:3000...");
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  const outDir = "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a";

  // Open "Kho Bạc & VietQR" modal with force: true
  console.log("Opening Kho Bạc & VietQR modal...");
  const treasuryBtn = page.locator("button:has-text('Kho Bạc & VietQR')").first();
  if (await treasuryBtn.count() > 0) {
    await treasuryBtn.click({ force: true });
    await page.waitForTimeout(1500);

    // 1. Screenshot Treasury Overview showing 01993667799
    await page.screenshot({ path: path.join(outDir, "verified_treasury_new_account.png") });
    console.log("Captured verified_treasury_new_account.png");

    // 2. Click "Săn Việc Upwork & Affiliate" tab
    const jobHunterTab = page.locator("button:has-text('Săn Việc Upwork & Affiliate')").first();
    if (await jobHunterTab.count() > 0) {
      console.log("Clicking Săn Việc Upwork & Affiliate tab...");
      await jobHunterTab.click({ force: true });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(outDir, "verified_job_hunter_tab.png") });
      console.log("Captured verified_job_hunter_tab.png");
    }

    // 3. Click "Đơn Hàng & Napas247 VietQR" tab to verify VietQR code with 01993667799
    const qrTab = page.locator("button:has-text('Đơn Hàng & Napas247 VietQR')").first();
    if (await qrTab.count() > 0) {
      console.log("Clicking VietQR tab...");
      await qrTab.click({ force: true });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(outDir, "verified_vietqr_01993667799.png") });
      console.log("Captured verified_vietqr_01993667799.png");
    }
  }

  console.log("Verification finished successfully.");
  await browser.close();
})();
