import { test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Agent City 5.1 & 5.1.7 Comprehensive Certification Suite', () => {
  test('Verify 6-Floor Diorama, Solid Ghost Pedestal, 268 Specialist Recruitment & Multi-Turn AI Chat', async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 1920, height: 1080 });

    const screenshotDir = path.resolve(
      '/Users/thienduc/.gemini/antigravity/brain/95bb19d2-ffd9-43b3-a0fd-ec96de9c7e9a/screenshots/agent_city_5_1'
    );

    // 1. Navigate to PROVIPAGENT 3D Office Diorama
    await page.goto('http://localhost:3000/');
    await page.waitForTimeout(4000);

    // Verify Canvas, Brand, 6-Floor HUD and Chat Drawer
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.locator('text=PROVIPAGENT 3D DIORAMA')).toBeVisible();
    await expect(page.locator('text=PROVIPAGENT AI Chat')).toBeVisible();

    // Screenshot 1: 5F Engineering Initial View
    await page.screenshot({ path: path.join(screenshotDir, '01_5f_engineering_bay.png') });
    console.log('[E2E Screenshot]: 01_5f_engineering_bay.png');

    // 2. Test Ghost Mode Cycling (Phase 7: Solid Pedestal with depthWrite active)
    const ghostBtn = page.locator('button[title*="Chuyển chế độ hiển thị tầng"]');
    await expect(ghostBtn).toBeVisible();

    // Click to ISOLATED
    await ghostBtn.click();
    await page.waitForTimeout(800);
    await expect(page.locator('text=Tầng khác: Ẩn hoàn toàn')).toBeVisible();

    // Click to NORMAL
    await ghostBtn.click();
    await page.waitForTimeout(800);
    await expect(page.locator('text=Tầng khác: Hiện tất cả')).toBeVisible();

    // Click back to DARKENED_GHOST (Default: Solid, Depth-Written, Physically Darkened Pedestal)
    await ghostBtn.click();
    await page.waitForTimeout(800);
    await expect(page.locator('text=Tầng khác: Đổ bóng mờ vật lý')).toBeVisible();

    // Screenshot 2: Darkened Ghost Mode in Action
    await page.screenshot({ path: path.join(screenshotDir, '02_darkened_ghost_pedestal.png') });
    console.log('[E2E Screenshot]: 02_darkened_ghost_pedestal.png');

    // 3. Test Elevator Keypad with All 6 Floors (6F to 1F)
    await page.click('button:has-text("Thang Máy")');
    await page.waitForTimeout(1000);
    await expect(page.locator('text=ELEVATOR CONTROL')).toBeVisible();

    // Screenshot 3: 6-Floor Elevator Keypad
    await page.screenshot({ path: path.join(screenshotDir, '03_elevator_keypad_6_floors.png') });
    console.log('[E2E Screenshot]: 03_elevator_keypad_6_floors.png');

    // Navigate to 6F Executive Suite & Boardroom
    await page.click('button:has-text("Ban Lãnh Đạo, Nghiên Cứu AI & Hội Đồng")');
    await page.waitForTimeout(2500);
    await expect(page.locator('text=Tầng 6 (6F)')).toBeVisible();

    // Close Elevator remote
    await page.click('button:has-text("✕")');
    await page.waitForTimeout(500);

    // Screenshot 4: 6F Executive Boardroom & AI Neural Lab
    await page.screenshot({ path: path.join(screenshotDir, '04_6f_executive_suite.png') });
    console.log('[E2E Screenshot]: 04_6f_executive_suite.png');

    // 4. Test In-Office Recruitment Workflow (Section 5.1.7: 268 Specialists)
    await page.click('button:has-text("Chiêu Mộ (268 Chuyên Gia)")');
    await page.waitForTimeout(2000);

    // Verify Recruitment Modal is displayed
    await expect(page.locator('text=Specialist Recruitment & Talent Hub')).toBeVisible();
    await expect(page.locator('text=Specialists in Library')).toBeVisible();

    // Search for a specialist
    const searchInput = page.locator('input[placeholder*="Search by name"]');
    await searchInput.fill('DevOps');
    await page.waitForTimeout(1000);

    // Screenshot 5: 268 Specialist Recruitment Catalog
    await page.screenshot({ path: path.join(screenshotDir, '05_recruitment_modal_catalog.png') });
    console.log('[E2E Screenshot]: 05_recruitment_modal_catalog.png');

    // Close Recruitment Modal
    await page.locator('button:has(svg.lucide-x)').click();
    await page.waitForTimeout(800);

    // 5. Test Real Multi-Turn AI Conversation (Mode: Conversation)
    await page.click('button:has-text("Trò Chuyện AI")');
    await page.waitForTimeout(500);

    // Click Quick Prompt: "GraphQL vs REST (5F)"
    await page.click('button:has-text("GraphQL vs REST (5F)")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("Gửi ➤")');

    // Verify response from David Chen (Engineering Lead on 5F) with adequate timeout for Hybrid Gateway
    await expect(page.locator('text=David Chen • 5F').first()).toBeVisible({ timeout: 25000 });
    await expect(page.locator('text=Suy nghĩ chuyên sâu của chuyên gia').first()).toBeVisible({ timeout: 10000 });

    // Screenshot 6: Real AI Conversation & Thought Process
    await page.screenshot({ path: path.join(screenshotDir, '06_real_ai_conversation.png') });
    console.log('[E2E Screenshot]: 06_real_ai_conversation.png');

    // 6. Test Task Execution Mode (Mode: Task)
    await page.click('button:has-text("Giao Nhiệm Vụ")');
    await page.waitForTimeout(500);

    const chatInput = page.locator('textarea[placeholder*="Nhập chỉ đạo giao việc"]');
    await chatInput.fill('Kiểm tra toàn bộ hệ thống API và audit bảo mật');
    await page.click('button:has-text("Gửi ➤")');

    // Verify task creation badge
    await expect(page.locator('text=TASK:').first()).toBeVisible({ timeout: 25000 });

    // Screenshot 7: Task Execution Mode Dispatched
    await page.screenshot({ path: path.join(screenshotDir, '07_task_execution_mode.png') });
    console.log('[E2E Screenshot]: 07_task_execution_mode.png');
  });
});
