import { test } from '@playwright/test';
import { prepareBrowserChrome, verifyBrowserChrome } from './browser-chrome-checks';

for (const mode of ['local', 'remote']) {
  for (const dark of [false, true]) {
    test(`${mode} ${dark ? 'dark narrow' : 'light wide'} website icons, addresses and hover`, async ({ page }, info) => {
      await page.setViewportSize({ width: dark ? 1024 : 1440, height: 900 });
      await prepareBrowserChrome(page);
      await page.goto(`/e2e/website-tabs-harness.html?mode=${mode}${dark ? '&dark=1' : ''}`);
      await verifyBrowserChrome({ page, info, label: `desktop-${mode}-${dark ? 'dark-narrow' : 'light-wide'}` });
    });
  }
}
