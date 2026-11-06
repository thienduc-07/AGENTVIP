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

  // Open right drawer
  const chatToggle = page.locator("button:has-text('Hoạt động & Chat')").first();
  if (await chatToggle.count() > 0) {
    console.log("Opening right panel drawer...");
    await chatToggle.click();
    await page.waitForTimeout(1000);
  }

  // 1. Capture "Hợp tác Nội bộ" tab
  const collabTab = page.locator("button:has-text('Hợp tác Nội bộ')").first();
  if (await collabTab.count() > 0) {
    console.log("Clicking Hợp tác Nội bộ tab...");
    await collabTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, "verified_agent_collaboration_tab.png") });
    console.log("Captured verified_agent_collaboration_tab.png");
  }

  // 2. Capture "Trò chuyện AI" tab & send "1 mũ 1000000"
  const aiTab = page.locator("button:has-text('Trò chuyện AI')").first();
  if (await aiTab.count() > 0) {
    console.log("Clicking Trò chuyện AI tab...");
    await aiTab.click();
    await page.waitForTimeout(1000);

    const chatInput = page.locator("textarea").first();
    if (await chatInput.count() > 0) {
      console.log("Submitting prompt '1 mũ 1000000'...");
      await chatInput.fill("1 mũ 1000000");
      const sendBtn = page.locator("button:has-text('Gửi')").first();
      if (await sendBtn.count() > 0) {
        await sendBtn.click();
      } else {
        await page.keyboard.press("Enter");
      }
      console.log("Waiting for assistant response...");
      await page.waitForTimeout(4000);
    }

    await page.screenshot({ path: path.join(outDir, "verified_clean_chat_formatting.png") });
    console.log("Captured verified_clean_chat_formatting.png");
  }

  await browser.close();
})();

