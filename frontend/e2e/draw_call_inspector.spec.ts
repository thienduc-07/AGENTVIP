import { test, expect } from '@playwright/test';

test('Introspect Three.js draw calls and render passes at 100 agents', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?benchmark_agents=100');

  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 35000 });
  await page.waitForTimeout(3000);

  const breakdown = await page.evaluate(() => {
    const profiler = (window as any).__AGENT_CITY_PROFILER__;
    const metrics = profiler?.getMetrics();

    // Analyze scene objects
    const canvasEl = document.querySelector('canvas');
    const r3f = (canvasEl as any)?.__r3f;
    const rootState = r3f?.root?.getState?.();
    const scene = rootState?.scene;
    const gl = rootState?.gl;

    const analysis: any = {
      threeInfo: {
        calls: gl?.info?.render?.calls,
        triangles: gl?.info?.render?.triangles,
        geometries: gl?.info?.memory?.geometries,
        textures: gl?.info?.memory?.textures,
      },
      meshCategoryCount: {},
      castShadowMeshes: 0,
      receiveShadowMeshes: 0,
      transparentMeshes: 0,
      opaqueMeshes: 0,
      materialTypes: {},
      shadowCastingObjects: [],
    };

    if (scene) {
      scene.traverse((obj: any) => {
        if (obj.isMesh) {
          const name = obj.name || obj.parent?.name || obj.geometry?.type || 'UnnamedMesh';
          // Find root ancestor component type
          let curr = obj;
          let category = 'Other';
          while (curr) {
            if (curr.type === 'Group') {
              if (curr.children?.some((c: any) => c.isHtml)) category = 'HtmlParent';
            }
            curr = curr.parent;
          }

          // Count shadows
          if (obj.castShadow) {
            analysis.castShadowMeshes += 1;
            analysis.shadowCastingObjects.push({
              uuid: obj.uuid,
              geo: obj.geometry?.type,
              pos: [obj.position.x, obj.position.y, obj.position.z],
              mat: obj.material?.type,
            });
          }
          if (obj.receiveShadow) analysis.receiveShadowMeshes += 1;

          // Material transparency
          const mat = obj.material;
          if (mat) {
            const isTrans = Array.isArray(mat) ? mat.some((m: any) => m.transparent) : mat.transparent;
            if (isTrans) analysis.transparentMeshes += 1;
            else analysis.opaqueMeshes += 1;

            const matType = Array.isArray(mat) ? mat.map((m: any) => m.type).join('+') : mat.type;
            analysis.materialTypes[matType] = (analysis.materialTypes[matType] || 0) + 1;
          }
        }
      });
    }

    // Now hook WebGL draw calls for one single frame
    const context = gl?.getContext();
    if (context) {
      const origDrawElements = context.drawElements;
      const origDrawArrays = context.drawArrays;
      let frameDrawCalls = 0;
      let shadowPassCalls = 0;
      let mainPassCalls = 0;
      let otherFboCalls = 0;

      const currentFBO = () => context.getParameter(context.FRAMEBUFFER_BINDING);

      context.drawElements = function (...args: any[]) {
        frameDrawCalls++;
        const fbo = currentFBO();
        if (fbo === null) {
          mainPassCalls++;
        } else {
          shadowPassCalls++;
        }
        return origDrawElements.apply(this, args);
      };

      context.drawArrays = function (...args: any[]) {
        frameDrawCalls++;
        const fbo = currentFBO();
        if (fbo === null) {
          mainPassCalls++;
        } else {
          shadowPassCalls++;
        }
        return origDrawArrays.apply(this, args);
      };

      // Wait for next frame render
      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            // Restore hooks
            context.drawElements = origDrawElements;
            context.drawArrays = origDrawArrays;

            analysis.frameHook = {
              frameDrawCalls,
              shadowPassCalls,
              mainPassCalls,
              otherFboCalls,
            };
            resolve(analysis);
          });
        });
      });
    }

    return analysis;
  });

  console.log('[DRAW CALL INTROSPECTION]:', JSON.stringify(breakdown, null, 2));
  expect(breakdown).not.toBeNull();
});

