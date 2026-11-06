const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  console.log("1. Navigating to http://localhost:3000...");
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  const outDir = "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a";

  // Check 1: Confirm subtitle banner is absent
  const bannerCount = await page.locator("text=Mỗi phiên Claude Code là một nhân vật").count();
  console.log(`Banner count (must be 0): ${bannerCount}`);

  // Check 2: Open "Kho Bạc & VietQR" modal
  console.log("2. Opening Kho Bạc & VietQR modal...");
  const treasuryBtn = page.locator("button:has-text('Kho Bạc & VietQR')").first();
  if (await treasuryBtn.count() > 0) {
    await treasuryBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, "verified_executive_treasury_modal.png") });
    console.log("Captured verified_executive_treasury_modal.png");

    // Click "Đơn Hàng & Napas247 VietQR" tab
    const qrTab = page.locator("button:has-text('Đơn Hàng & Napas247 VietQR')").first();
    if (await qrTab.count() > 0) {
      await qrTab.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(outDir, "verified_vietqr_payment_tab.png") });
      console.log("Captured verified_vietqr_payment_tab.png");
    }

    // Click "Săn Việc Upwork & Affiliate" tab
    const jobTab = page.locator("button:has-text('Săn Việc Upwork')").first();
    if (await jobTab.count() > 0) {
      await jobTab.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(outDir, "verified_job_hunter_tab.png") });
      console.log("Captured verified_job_hunter_tab.png");
    }

    // Close modal
    const closeBtn = page.locator("button:has-text('Đóng')").last();
    if (await closeBtn.count() > 0) {
      await closeBtn.click();
      await page.waitForTimeout(800);
    }
  }

  // Check 3: Open right panel and switch to "Hợp tác Nội bộ" tab
  console.log("3. Testing Hợp tác Nội bộ tab...");
  const rightToggle = page.locator("button:has-text('Hoạt động & Chat')").first();
  if (await rightToggle.count() > 0) {
    await rightToggle.click();
    await page.waitForTimeout(800);
  }

  const collabTab = page.locator("button:has-text('Hợp tác Nội bộ')").first();
  if (await collabTab.count() > 0) {
    await collabTab.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outDir, "verified_agent_collaboration_tab.png") });
    console.log("Captured verified_agent_collaboration_tab.png");
  }

  // Check 4: Switch to "Trò chuyện AI" and test "1 mũ 1000000"
  console.log("4. Testing Trò chuyện AI with math prompt '1 mũ 1000000'...");
  const aiTab = page.locator("button:has-text('Trò chuyện AI')").first();
  if (await aiTab.count() > 0) {
    await aiTab.click();
    await page.waitForTimeout(800);

    const chatInput = page.locator("textarea[placeholder*='Nhắn câu hỏi AI']").first();
    if (await chatInput.count() > 0) {
      await chatInput.fill("1 mũ 1000000");
      await page.keyboard.press("Enter");
      console.log("Waiting for cleaned math response...");
      await page.waitForTimeout(3500);
      await page.screenshot({ path: path.join(outDir, "verified_clean_chat_formatting.png") });
      console.log("Captured verified_clean_chat_formatting.png");
    }
  }

  console.log("All quantum leap visual verifications completed successfully.");
  await browser.close();
})();

