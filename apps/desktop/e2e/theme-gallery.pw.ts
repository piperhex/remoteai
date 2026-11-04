import { test, expect } from '@playwright/test';
import { BUILT_IN_DREAM_SKIN_THEMES } from '../src/dreamSkinBuiltIns';

test('theme cards bound image references while scrolling and release them when closed', async ({ page }) => {
  const calls: { themeId: string; thumbnail?: boolean }[] = [];
  const preview = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#52776c"/></svg>');
  let running = 0;
  let peak = 0;
  await page.route('**/__codex_switch__/api/invoke', async route => {
    const { command, args } = route.request().postDataJSON();
    let result: unknown = {};
    if (command === 'get_dream_skin_status') result = { supported: true, available: true,
      installed: true, runtimeInstalled: true, session: 'active', savedThemes: [] };
    if (command === 'get_dream_skin_resources_status') result = { installed: true, phase: 'ready', downloadedBytes: 0 };
    if (command === 'get_dream_skin_theme_preview') {
      calls.push(args); running++; peak = Math.max(peak, running);
      await new Promise(resolve => setTimeout(resolve, 40));
      running--; result = preview;
    }
    await route.fulfill({ json: { ok: true, result } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/e2e/theme-gallery-harness.html');
  const cards = page.locator('article');
  await expect(cards).toHaveCount(BUILT_IN_DREAM_SKIN_THEMES.length + 1);
  const images = page.locator('article [style*="background-image"]');
  await expect.poll(() => images.count()).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(calls.length).toBeLessThan(30);
  expect(peak).toBeLessThanOrEqual(2);
  expect(calls.every(call => call.thumbnail === true)).toBe(true);
  const first = cards.first().locator('[style*="background-image"]');
  await expect(first).toHaveCount(1);
  await cards.nth(100).scrollIntoViewIfNeeded();
  await expect(first).toHaveCount(0);
  await expect.poll(() => images.count()).toBeGreaterThan(0);
  expect(await images.count()).toBeLessThan(30);
  await cards.first().scrollIntoViewIfNeeded();
  await expect(first).toHaveCount(1);
  await page.evaluate(() => (window as unknown as { themeGalleryFixture: { show: (value: boolean) => void } })
    .themeGalleryFixture.show(false));
  await expect(images).toHaveCount(0);
  const before = calls.length;
  await page.evaluate(() => (window as unknown as { themeGalleryFixture: { show: (value: boolean) => void } })
    .themeGalleryFixture.show(true));
  await expect.poll(() => calls.length).toBeGreaterThan(before);
});
