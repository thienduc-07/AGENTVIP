const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log("1. Navigating to http://localhost:3000...");
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // Disable all CSS animations & transitions globally so screenshots are instant
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        animation-duration: 0s !important;
        transition: none !important;
        transition-duration: 0s !important;
      }
    `
  });

  const outDir = "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a";

  console.log("2. Opening Kho Bạc & VietQR modal via DOM click...");
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find(el => el.textContent && el.textContent.includes("Kho Bạc"));
    if (b) b.click();
  });
  await page.waitForTimeout(1000);

  console.log("3. Switching to 'Săn Việc Upwork & Affiliate' tab...");
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const tab = btns.find(el => el.textContent && el.textContent.includes("Săn Việc Upwork"));
    if (tab) tab.click();
  });
  await page.waitForTimeout(800);

  await page.screenshot({ path: path.join(outDir, "verified_job_hunter_tab.png") });
  console.log("Captured verified_job_hunter_tab.png");

  console.log("4. Switching to 'Đơn Hàng & Napas247 VietQR' tab...");
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const tab = btns.find(el => el.textContent && el.textContent.includes("Napas247 VietQR"));
    if (tab) tab.click();
  });
  await page.waitForTimeout(800);

  await page.screenshot({ path: path.join(outDir, "verified_vietqr_01993667799.png") });
  console.log("Captured verified_vietqr_01993667799.png");

  await browser.close();
  console.log("All screenshots saved successfully!");
})();
