import { test } from '@playwright/test';

test('Introspect all scene meshes', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?benchmark_agents=100');
  await page.waitForTimeout(6000);

  const breakdown = await page.evaluate(() => {
    const canvasEl = document.querySelector('canvas');
    const r3f = (canvasEl as any)?.__r3f;
    const scene = r3f?.root?.getState?.()?.scene;
    if (!scene) return null;

    const categories: Record<string, { count: number; castShadow: number; transparent: number }> = {};
    scene.traverse((obj: any) => {
      if (obj.isMesh) {
        let parent = obj.parent;
        let cat = 'Unknown';
        while (parent && parent !== scene) {
          if (parent.name) {
            cat = parent.name;
            break;
          }
          parent = parent.parent;
        }
        if (cat === 'Unknown') {
          // guess by geometry or material name or type
          cat = obj.geometry?.type || 'Other';
        }
        if (!categories[cat]) categories[cat] = { count: 0, castShadow: 0, transparent: 0 };
        categories[cat].count += 1;
        if (obj.castShadow) categories[cat].castShadow += 1;
        if (obj.material?.transparent) categories[cat].transparent += 1;
      }
    });
    return categories;
  });

  console.log('[MESH CATEGORIES]:', JSON.stringify(breakdown, null, 2));
});

