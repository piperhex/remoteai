import { test } from '@playwright/test';
import { verifyWebsiteIcons } from './browser-website-icons-checks';

for (const mode of ['local', 'remote']) for (const dark of [false, true]) {
  test(`${mode} ${dark ? 'dark narrow' : 'light wide'} website and bookmark icons`, async ({ page }, info) => {
    await page.setViewportSize({ width: dark ? 1000 : 1440, height: 900 });
    await verifyWebsiteIcons({ page, info, scope: `bookmarks-${mode}`,
      harness: `/e2e/browser-bookmarks-harness.html?mode=${mode}${dark ? '&dark=1' : ''}`,
      label: `desktop-${mode}-${dark ? 'dark-narrow' : 'light-wide'}` });
  });
}
