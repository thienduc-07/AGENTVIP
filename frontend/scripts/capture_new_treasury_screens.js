const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  console.log("Navigating to http://localhost:3000...");
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // Mock document.fonts.ready to prevent Playwright font waiting timeout
  await page.evaluate(() => {
    try {
      Object.defineProperty(document.fonts, 'ready', { value: Promise.resolve(), configurable: true });
    } catch (e) {}
  });

  const outDir = "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a";

  // Open Kho Bạc modal
  console.log("Opening Kho Bạc & VietQR modal...");
  await page.evaluate(() => {
    const btn = document.querySelector("button[title*='Sổ Cái Ngân Khố']");
    if (btn) btn.click();
  });
  await page.waitForTimeout(1500);

  // 1. Treasury overview with 01993667799
  console.log("Capturing 1: verified_treasury_new_account.png");
  await page.screenshot({ path: path.join(outDir, "verified_treasury_new_account.png"), animations: "disabled" });

  // 2. Click "Săn Việc Upwork & Affiliate" tab
  console.log("Clicking Săn Việc Upwork & Affiliate tab...");
  await page.evaluate(() => {
    const tab = Array.from(document.querySelectorAll("button")).find(b => b.innerText.includes("Săn Việc Upwork"));
    if (tab) tab.click();
  });
  await page.waitForTimeout(1500);
  console.log("Capturing 2: verified_job_hunter_tab.png");
  await page.screenshot({ path: path.join(outDir, "verified_job_hunter_tab.png"), animations: "disabled" });

  // 3. Click "Đơn Hàng & Napas247 VietQR" tab
  console.log("Clicking VietQR tab...");
  await page.evaluate(() => {
    const tab = Array.from(document.querySelectorAll("button")).find(b => b.innerText.includes("Đơn Hàng & Napas247"));
    if (tab) tab.click();
  });
  await page.waitForTimeout(1500);
  console.log("Capturing 3: verified_vietqr_01993667799.png");
  await page.screenshot({ path: path.join(outDir, "verified_vietqr_01993667799.png"), animations: "disabled" });

  await browser.close();
  console.log("ALL CAPTURED SUCCESSFULLY!");
})();
