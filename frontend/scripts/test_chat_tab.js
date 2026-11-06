const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  console.log("Navigating to http://localhost:3000...");
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  // Click on "Hoạt động & Chat" button to open the sidebar
  const chatToggle = page.locator("button:has-text('Hoạt động & Chat')").first();
  if (await chatToggle.count() > 0) {
    await chatToggle.click();
    await page.waitForTimeout(800);
  }

  // Click on "Trò chuyện AI" tab
  const aiTab = page.locator("button:has-text('Trò chuyện AI')").first();
  if (await aiTab.count() > 0) {
    console.log("Clicking Trò chuyện AI tab...");
    await aiTab.click();
    await page.waitForTimeout(1000);
  }

  // Type prompt "1 mũ 1000000"
  const chatInput = page.locator("input[placeholder*='Hỏi chuyên gia'], textarea[placeholder*='Hỏi chuyên gia'], textarea, input[type='text']").last();
  if (await chatInput.count() > 0) {
    console.log("Typing '1 mũ 1000000'...");
    await chatInput.fill("1 mũ 1000000");
    await page.keyboard.press("Enter");
    console.log("Waiting for answer...");
    await page.waitForTimeout(3000);
  }

  const outDir = "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a";
  await page.screenshot({ path: path.join(outDir, "live_chat_conversation_tab_verified.png") });
  console.log("Captured live_chat_conversation_tab_verified.png");

  await browser.close();
})();

