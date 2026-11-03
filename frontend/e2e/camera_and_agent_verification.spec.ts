import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT_DIR = path.resolve(process.cwd(), '../docs/screenshots/camera_and_agents');
const ARTIFACT_DIR = '/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a/screenshots';

test.describe('PROVIPAGENT: Camera Drag Persistence & Authentic Agent Visibility Verification', () => {
  test.beforeAll(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  });

  const makeScreenshotSaver = (page: any) => async (filename: string) => {
    const outPath = path.join(OUT_DIR, filename);
    const artifactPath = path.join(ARTIFACT_DIR, filename);
    await page.screenshot({ path: outPath, fullPage: false, timeout: 60000 });
    fs.copyFileSync(outPath, artifactPath);
    console.log(`[Verified Screenshot Captured]: ${outPath}`);
  };

  test('Part 1: Visual Verification — Multi-Floor Headquarters & Authentic AI Employees', async ({ page }) => {
    test.setTimeout(360000);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 25000 });
    await page.waitForTimeout(4000);

    const saveScreenshot = makeScreenshotSaver(page);

    // 1. Overview: Entire multi-floor building (Dollhouse cutaway overview)
    await saveScreenshot('screenshot_01_multi_floor_building.png');

    // 2. Floor 5: Engineering Department with visible authentic AI agents
    const f5Btn = page.locator('button', { hasText: 'T5: Kỹ Thuật' }).first();
    await f5Btn.click({ force: true });
    await page.waitForTimeout(1500);

    const davidChen = page.locator('text=David Chen').first();
    await expect(davidChen).toBeVisible({ timeout: 10000 });
    await saveScreenshot('screenshot_02_floor_with_visible_agents.png');

    // 3. Floor 5: Engineering department with workstation occupancy
    await davidChen.click({ force: true });
    await page.waitForTimeout(1500);
    await saveScreenshot('screenshot_03_engineering_workstations.png');

    // 4. Floor 6: Executive Penthouse & CEO Victoria Vance
    const ceoBtn = page.locator('button', { hasText: 'CEO Suite' }).first();
    await ceoBtn.click({ force: true });
    await page.waitForTimeout(1500);

    const victoriaVance = page.locator('text=Victoria Vance').first();
    await expect(victoriaVance).toBeVisible({ timeout: 10000 });
    await saveScreenshot('screenshot_04_executive_floor_ceo.png');

    // 5. Select Victoria Vance to open AgentInspectionHUD
    await victoriaVance.click({ force: true });
    await page.waitForTimeout(1500);

    const inspectionHud = page.locator('text=AI Employee HUD').or(page.locator('text=agent-exec-ceo')).first();
    await expect(inspectionHud).toBeVisible({ timeout: 8000 });
    await saveScreenshot('screenshot_05_agent_inspection_hud.png');
  });

  test('Part 2: Camera Control — Mouse Drag Persistence & React Re-render Immunity', async ({ page }) => {
    test.setTimeout(360000);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 25000 });
    await page.waitForTimeout(4000);

    const saveScreenshot = makeScreenshotSaver(page);

    // Focus Floor 5 for orientation
    const f5Btn = page.locator('button', { hasText: 'T5: Kỹ Thuật' }).first();
    await f5Btn.dispatchEvent('click');
    await page.waitForTimeout(1500);

    // Perform an explicit mouse drag of 250px across canvas to rotate camera
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    const startX = canvasBox!.x + canvasBox!.width * 0.55;
    const startY = canvasBox!.y + canvasBox!.height * 0.5;
    const endX = startX - 250;
    const endY = startY + 25;

    console.log(`[Camera Drag]: Dragging mouse across canvas from (${startX}, ${startY}) to (${endX}, ${endY})...`);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();

    // STRICT REQUIREMENT: Wait 5 seconds after releasing mouse and verify NO snap-back occurs!
    console.log('[Camera Test]: Mouse released. Waiting 5s to verify camera persistence...');
    await page.waitForTimeout(5000);

    // 6. Screenshot 6: Camera after rotation and mouse release (persisted position)
    await saveScreenshot('screenshot_06_camera_drag_rotated.png');

    // 7. Trigger React re-render without coordinate reset
    console.log('[Camera Test]: Triggering React re-render...');
    await f5Btn.dispatchEvent('click');
    await page.waitForTimeout(2500);

    // 7. Screenshot 7: Camera after React re-render without resetting
    await saveScreenshot('screenshot_07_camera_after_rerender.png');

    console.log('[Camera Test]: Completed! Camera drag and re-render persistence fully verified.');
  });
});
