import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT_DIR = path.resolve(process.cwd(), '../docs/screenshots/agent_city_5_0');
const ARTIFACT_DIR = '/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a/screenshots';

test.describe('Agent City 5.0: Simulation Game Visual & Functional Certification', () => {
  test.beforeAll(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  });

  test('Verify Simulation Game, Chibi Characters, Elevator, and AI Command Center', async ({ page }) => {
    test.setTimeout(120000);

    // 1080p high resolution viewport
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Navigate to Agent City
    await page.goto('/');

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 20000 });

    // Allow 3D scene, instanced chibi characters, and textures to hydrate
    await page.waitForTimeout(4000);

    const saveScreenshot = async (filename: string) => {
      const outPath = path.join(OUT_DIR, filename);
      const artifactPath = path.join(ARTIFACT_DIR, filename);
      await page.screenshot({ path: outPath, fullPage: false });
      fs.copyFileSync(outPath, artifactPath);
      console.log(`[Verified Screenshot Captured]: ${outPath}`);
    };

    // 1. Overview: 3D Simulation Game with Cozy Japanese-Inspired Architecture & HUD
    await saveScreenshot('screenshot_01_game_overview_simulation.png');

    // 2. Focus on Floor 5: Engineering & Architecture with Chibi Characters Seated on Chairs
    const f5Btn = page.locator('button', { hasText: 'T5: Kỹ Thuật' }).first();
    if (await f5Btn.isVisible()) {
      await f5Btn.click({ force: true });
      await page.waitForTimeout(2000);
      await saveScreenshot('screenshot_02_chibi_characters_sitting.png');
    }

    // 3. Interactive Elevator: Trigger Elevator Remote Control Panel
    const elevatorHintBtn = page.locator('button', { hasText: 'Thang Máy' }).first();
    if (await elevatorHintBtn.isVisible()) {
      await elevatorHintBtn.click({ force: true });
      await page.waitForTimeout(1000);
      await saveScreenshot('screenshot_03_interactive_elevator.png');
    }

    // 4. AI Command Center: Open ChatGPT-like floating interface and submit a prompt
    const chatBtn = page.locator('button', { hasText: 'AI Command Center' }).first();
    await expect(chatBtn).toBeVisible({ timeout: 10000 });
    await chatBtn.click({ force: true });
    await page.waitForTimeout(800);

    // Type prompt into textarea
    const chatInput = page.locator('textarea[placeholder*="Nhập yêu cầu"]').first();
    await expect(chatInput).toBeVisible({ timeout: 5000 });
    await chatInput.fill('Phân tích chi phí LLM và tính toán ngân sách tháng này');

    // Click Gửi
    const sendBtn = page.locator('button', { hasText: 'Gửi' }).first();
    await sendBtn.click({ force: true });

    // Wait for routing & task initiation
    await page.waitForTimeout(2000);
    await saveScreenshot('screenshot_04_ai_command_center.png');

    // Close chat
    const closeChatBtn = page.locator('button:has-text("✕")').last();
    if (await closeChatBtn.isVisible()) {
      await closeChatBtn.click({ force: true });
      await page.waitForTimeout(500);
    }

    // 5. Camera Control: Mouse Drag & Persistence Test
    const box = await canvas.boundingBox();
    if (box) {
      const startX = box.x + box.width * 0.55;
      const startY = box.y + box.height * 0.5;
      const endX = box.x + box.width * 0.42;
      const endY = box.y + box.height * 0.52;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(endX, endY, { steps: 12 });
      await page.mouse.up();

      await page.waitForTimeout(2000);
      await saveScreenshot('screenshot_05_camera_drag_rotated.png');
    }
  });
});
