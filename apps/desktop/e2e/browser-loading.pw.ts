import { test } from '@playwright/test';
import { verifyBrowserLoading } from './browser-loading-checks';

for (const mode of ['local', 'remote']) {
  for (const dark of [false, true]) {
    test(`${mode} ${dark ? 'dark narrow' : 'light wide'} browser stop and reload`, async ({ page }, info) => {
      await page.setViewportSize({ width: dark ? 1024 : 1440, height: 900 });
      await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
      await page.goto(`/e2e/website-tabs-harness.html?mode=${mode}${dark ? '&dark=1' : ''}`);
      await verifyBrowserLoading(page, info, `desktop-${mode}-${dark ? 'dark-narrow' : 'light-wide'}`);
    });
  }
}
