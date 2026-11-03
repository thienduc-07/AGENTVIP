import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT_DIR = path.resolve(process.cwd(), '../docs/screenshots/agent_city_headquarters');
const ARTIFACT_DIR = '/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a/screenshots';

test.describe('Agent City: Corporate Headquarters Visual Documentation', () => {
  test.beforeAll(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  });

  test('Capture complete multi-story corporate headquarters screenshots', async ({ page }) => {
    test.setTimeout(120000);

    // Set 1080p high resolution viewport
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Navigate to Agent City 3D Office
    await page.goto('/');

    // Wait for canvas to mount and 3D environment to hydrate
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 15000 });

    // Wait for initial WebGL shaders and 3D assets to load and settle
    await page.waitForTimeout(3000);

    const saveScreenshot = async (filename: string) => {
      const outPath = path.join(OUT_DIR, filename);
      const artifactPath = path.join(ARTIFACT_DIR, filename);
      await page.screenshot({ path: outPath, fullPage: false });
      fs.copyFileSync(outPath, artifactPath);
      console.log(`[Screenshot Captured]: ${outPath}`);
    };

    // 1. Overview: Complete 6-Floor Building Dollhouse Cutaway
    await saveScreenshot('screenshot_01_complete_headquarters_overview.png');

    // 2. Floor 1: Reception & Operations
    const f1Btn = page.locator('button', { hasText: 'T1: Lễ Tân & Ops' }).first();
    await f1Btn.click({ force: true });
    await page.waitForTimeout(1200);
    await saveScreenshot('screenshot_02_floor_1_reception_operations.png');

    // 3. Floor 2: Design & Creative
    const f2Btn = page.locator('button', { hasText: 'T2: Thiết Kế' }).first();
    await f2Btn.click({ force: true });
    await page.waitForTimeout(1200);
    await saveScreenshot('screenshot_03_floor_2_design_creative.png');

    // 4. Floor 3: Marketing & Growth
    const f3Btn = page.locator('button', { hasText: 'T3: Marketing' }).first();
    await f3Btn.click({ force: true });
    await page.waitForTimeout(1200);
    await saveScreenshot('screenshot_04_floor_3_marketing_growth.png');

    // 5. Floor 4: Research & Data Science
    const f4Btn = page.locator('button', { hasText: 'T4: Nghiên Cứu' }).first();
    await f4Btn.click({ force: true });
    await page.waitForTimeout(1200);
    await saveScreenshot('screenshot_05_floor_4_research_data.png');

    // 6. Floor 5: Engineering & Architecture
    const f5Btn = page.locator('button', { hasText: 'T5: Kỹ Thuật' }).first();
    await f5Btn.click({ force: true });
    await page.waitForTimeout(1200);
    await saveScreenshot('screenshot_06_floor_5_engineering.png');

    // 7. Floor 6: Executive Penthouse & CEO Suite
    const ceoBtn = page.locator('button', { hasText: 'CEO Suite' }).first();
    await ceoBtn.click({ force: true });
    await page.waitForTimeout(1200);
    await saveScreenshot('screenshot_07_floor_6_executive_penthouse.png');

    // 8. Floor 6: Grand Executive Boardroom Meeting
    const meetingBtn = page.locator('button', { hasText: 'Phòng Họp' }).first();
    await meetingBtn.click({ force: true });
    await page.waitForTimeout(1200);
    await saveScreenshot('screenshot_08_executive_boardroom_meeting.png');
  });
});
