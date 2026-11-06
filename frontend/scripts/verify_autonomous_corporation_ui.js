const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-gpu", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const outDir = "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a";

  // Open modal via evaluate
  await page.evaluate(() => {
    const btn = document.querySelector("button[title*=\"Ngân Khố\"]");
    if (btn) btn.click();
  });
  await page.waitForTimeout(1500);

  // 1. Screenshot Tab 1: Kho Bạc & Sổ Cái Bất Biến
  await page.screenshot({ path: path.join(outDir, "verified_autonomous_treasury_control_center.png") });
  console.log("Captured verified_autonomous_treasury_control_center.png");

  // 2. Switch to Tab: Săn Việc & Doanh Thu Tự Động
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll("button"));
    const jobTab = tabs.find(el => el.textContent && el.textContent.includes("Săn Việc"));
    if (jobTab) jobTab.click();
  });
  await page.waitForTimeout(1200);

  await page.screenshot({ path: path.join(outDir, "verified_autonomous_opportunity_pilot.png") });
  console.log("Captured verified_autonomous_opportunity_pilot.png");

  // 3. Switch to Tab: Pháp Chế & Tuân Thủ
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll("button"));
    const compTab = tabs.find(el => el.textContent && el.textContent.includes("Pháp Chế"));
    if (compTab) compTab.click();
  });
  await page.waitForTimeout(1200);

  await page.screenshot({ path: path.join(outDir, "verified_autonomous_compliance_registry.png") });
  console.log("Captured verified_autonomous_compliance_registry.png");

  await browser.close();
  console.log("ALL AUTONOMOUS CORPORATION SCREENSHOTS CAPTURED!");
})();

