import { test } from '@playwright/test';
import { checkWorkspaceStart } from './workspace-start-checks';

for (const mode of ['local', 'remote', 'web']) {
  for (const enlarged of [false, true]) {
    test(`${mode}: empty workspace opens browser, Git and files ${enlarged ? 'narrow font20' : 'wide font14'}`,
      async ({ page }, info) => {
        await page.setViewportSize({ width: enlarged ? 1024 : 1440, height: 900 });
        await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
        const query = `mode=${mode}&submodules&font=${enlarged ? 20 : 14}${enlarged ? '&dark' : ''}`;
        await checkWorkspaceStart({ page, info, url: `/e2e/workspace-drawer-harness.html?${query}`,
          label: `${mode}-${enlarged ? 'dark-narrow-font20' : 'light-wide-font14'}` });
      });
  }
}
