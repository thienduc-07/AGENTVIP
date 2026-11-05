import { test, expect } from "@playwright/test";

test("CLAUDE CODE MY OFFICE & ARCHITECTURAL REALISM REBUILD VERIFICATION", async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1920, height: 1080 });

  const screenshotDir = "/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a/screenshots/claude_code_my_office";

  // 1. Navigate to My Office Diorama
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  // 2. Wait for full workforce to load into Chibi dictionary (>200 agents)
  await page.waitForFunction(() => {
    const chibis = (window as any).__MY_OFFICE_CHIBIS__;
    return chibis && Object.keys(chibis).length > 200;
  }, { timeout: 60000 });

  await page.waitForTimeout(2000);

  // 3. Verify Top Navigation Bar
  await expect(page.locator("text=My Office").first()).toBeVisible();
  await expect(page.locator("text=Máy Mac").first()).toBeVisible();
  await expect(page.locator("text=RAM 79%").first()).toBeVisible();
  console.log("Verified: Top Navigation Bar elements visible.");

  // 4. Verify Left Sidebar ("Phiên làm việc")
  await expect(page.locator("text=Phiên làm việc").first()).toBeVisible();
  await expect(page.locator("text=CẦN BẠN DUYỆT").first()).toBeVisible();
  await expect(page.locator("text=ĐANG LÀM").first()).toBeVisible();
  await expect(page.locator("text=ĐANG NGHỈ").first()).toBeVisible();
  console.log("Verified: Left Sidebar with Work Sessions visible.");

  // 5. Verify Right Sidebar ("Hoạt động" and Metrics)
  await expect(page.locator("text=Hoạt động").first()).toBeVisible();
  await expect(page.locator("text=Việc").first()).toBeVisible();
  await expect(page.locator("text=Đọc").first()).toBeVisible();
  await expect(page.locator("text=Sửa").first()).toBeVisible();
  await expect(page.locator("text=Lệnh").first()).toBeVisible();
  console.log("Verified: Right Sidebar with metrics cards visible.");

  // 6. Verify Bottom Control Dock & Subtitle
  await expect(page.locator('button:has-text("Toàn cảnh")').first()).toBeVisible();
  await expect(page.locator('button:has-text("Bàn làm việc")').first()).toBeVisible();
  await expect(page.locator('button:has-text("Phòng họp")').first()).toBeVisible();
  await expect(page.locator('button:has-text("Máy chủ")').first()).toBeVisible();
  await expect(page.locator('button:has-text("Hoá thân")').first()).toBeVisible();
  await expect(page.locator("text=Mỗi phiên Claude Code là một nhân vật")).toBeVisible();
  console.log("Verified: Bottom Control Dock and Subtitle Banner visible.");

  // Capture Screenshot 1: Overview of 5F Engineering with full Claude Code My Office UI
  await page.screenshot({ path: `${screenshotDir}/01_claude_code_my_office_overview_5f.png` });

  // 7. Test Camera Presets
  console.log("Testing Preset: Bàn làm việc...");
  await page.locator('button:has-text("Bàn làm việc")').first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${screenshotDir}/02_preset_workstations.png` });

  console.log("Testing Preset: Phòng họp...");
  await page.locator('button:has-text("Phòng họp")').first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${screenshotDir}/03_preset_boardroom.png` });

  console.log("Testing Preset: Máy chủ...");
  await page.locator('button:has-text("Máy chủ")').first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${screenshotDir}/04_preset_servers.png` });

  // Return to Overview
  await page.locator('button:has-text("Toàn cảnh")').first().click();
  await page.waitForTimeout(1200);

  // 8. Test Floor 1F Reception & Elevator
  console.log("Testing Floor 1F Reception & Lounge...");
  await page.locator('button:has-text("1F")').first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${screenshotDir}/05_floor_1f_reception_diorama.png` });

  // 9. Test Floor 6F CEO Suite & Entertainment Penthouse
  console.log("Testing Floor 6F Penthouse...");
  await page.locator('button:has-text("6F")').first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${screenshotDir}/06_floor_6f_penthouse_diorama.png` });

  // 10. Test Session Click & Character Tracking
  console.log("Testing click on work session 'landing-page'...");
  const landingSession = page.locator('div:has-text("landing-page")').first();
  await landingSession.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${screenshotDir}/07_session_tracking_active.png` });

  // 11. Test AI Chatbot Fast Response on 1+1
  console.log("Testing AI Chatbot fast path '1+1' in right sidebar...");
  const chatTab = page.locator('button:has-text("Trò chuyện AI")').first();
  await chatTab.click({ force: true });
  await page.waitForTimeout(600);

  const chatInput = page.locator("form textarea").first();
  await expect(chatInput).toBeVisible();

  const startTime = Date.now();
  await chatInput.fill("1+1");
  await chatInput.press("Enter");

  const responseBubble = page.locator('.overflow-y-auto').locator('text=2');
  await expect(responseBubble.first()).toBeVisible({ timeout: 10000 });
  const elapsed = Date.now() - startTime;
  console.log(`Chatbot answered '1+1 = 2' in ${elapsed}ms!`);

  await page.screenshot({ path: `${screenshotDir}/08_chatbot_math_verified.png` });
  console.log("ALL VERIFICATIONS COMPLETED SUCCESSFULLY!");
});
