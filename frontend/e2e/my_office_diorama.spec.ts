import { test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('My Office 3D Diorama & Smart Auto-Router Suite', () => {
  test('Verify Diorama, Elevator Keypad, Floor Transitions, and ChatGPT Auto-Router', async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 1920, height: 1080 });

    // 1. Navigate to My Office 3D
    await page.goto('/');
    await page.waitForTimeout(4000);

    // Verify main canvas and top HUD
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.locator('text=MY OFFICE 3D')).toBeVisible();
    await expect(page.locator('text=AI Office Smart Chat')).toBeVisible();

    const screenshotDir = path.resolve(process.cwd(), 'docs/screenshots/my_office');

    // Screenshot 1: 1F Tech Overview
    await page.screenshot({ path: path.join(screenshotDir, '01_my_office_1f_tech.png') });
    console.log('[E2E Screenshot]: 01_my_office_1f_tech.png');

    // 2. Open Elevator Remote Keypad
    await page.click('button:has-text("Thang Máy")');
    await page.waitForTimeout(1000);
    await expect(page.locator('text=ELEVATOR CONTROL')).toBeVisible();

    // Screenshot 2: Elevator Remote Keypad
    await page.screenshot({ path: path.join(screenshotDir, '02_elevator_remote_keypad.png') });
    console.log('[E2E Screenshot]: 02_elevator_remote_keypad.png');

    // 3. Navigate to 2F Finance
    await page.click('button:has-text("Phòng Tài Chính & Phân Tích Quỹ")');
    await page.waitForTimeout(2500);
    await expect(page.locator('text=Tầng 2 (2F)')).toBeVisible();

    // Screenshot 3: 2F Finance
    await page.screenshot({ path: path.join(screenshotDir, '03_my_office_2f_finance.png') });
    console.log('[E2E Screenshot]: 03_my_office_2f_finance.png');

    // 4. Navigate to 3F Creative Studio
    await page.click('button:has-text("3F Studio")');
    await page.waitForTimeout(2500);
    await expect(page.locator('text=Tầng 3 (3F)')).toBeVisible();

    // Screenshot 4: 3F Creative
    await page.screenshot({ path: path.join(screenshotDir, '04_my_office_3f_creative.png') });
    console.log('[E2E Screenshot]: 04_my_office_3f_creative.png');

    // 5. Navigate to 4F Executive Strategy Suite
    await page.click('button:has-text("4F Phòng")');
    await page.waitForTimeout(2500);
    await expect(page.locator('text=Tầng 4 (4F)')).toBeVisible();

    // Screenshot 5: 4F Executive Boardroom
    await page.screenshot({ path: path.join(screenshotDir, '05_my_office_4f_executive.png') });
    console.log('[E2E Screenshot]: 05_my_office_4f_executive.png');

    // 6. Test ChatGPT Smart Auto-Router: Prompt for code optimization (Should auto-route to Leo on 1F)
    await page.click('button:has-text("Tối ưu code 120FPS (1F)")');
    await page.waitForTimeout(4000);

    // Verify system routed to Leo and elevated to 1F
    await expect(page.locator('text=Tầng 1 (1F)')).toBeVisible();
    await expect(page.locator('text=⚡ Auto-Routed: Leo • 1F')).toBeVisible();

    // Screenshot 6: Auto-Routed Chat in Action
    await page.screenshot({ path: path.join(screenshotDir, '06_smart_auto_router_in_action.png') });
    console.log('[E2E Screenshot]: 06_smart_auto_router_in_action.png');
  });
});

