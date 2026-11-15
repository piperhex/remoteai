import { test } from '@playwright/test';
import { prepareAddressPages, verifyAddressDisplay } from './browser-address-checks';

for (const mode of ['local', 'remote']) for (const sidebar of [false, true]) for (const enlarged of [false, true]) {
  const label = `desktop-${mode}-${sidebar ? 'sidebar' : 'main'}-${enlarged ? 'dark-20px-narrow' : 'light-14px'}`;
  test(label, async ({ page }, info) => {
    await page.setViewportSize({ width: enlarged ? 900 : 1440, height: 900 });
    await prepareAddressPages(page);
    const query = `mode=${mode}${sidebar ? '&sidebar=1' : ''}${enlarged ? '&dark=1&font=20' : ''}`;
    await page.goto(`/e2e/browser-bookmarks-harness.html?${query}`, { waitUntil: 'domcontentloaded' });
    await verifyAddressDisplay({ page, info, label });
  });
}
