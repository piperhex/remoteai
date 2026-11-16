import { test } from '@playwright/test';
import { checkWorkspaceAddTab } from './workspace-add-tab-checks';

for (const mode of ['local', 'remote', 'web']) {
  for (const enlarged of [false, true]) {
    test(`${mode}: add workspace tabs ${enlarged ? 'dark narrow font20' : 'light wide font14'}`,
      async ({ page }, info) => {
        await page.setViewportSize({ width: enlarged ? 1024 : 1440, height: 900 });
        await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
        const query = `mode=${mode}&changes&submodules&font=${enlarged ? 20 : 14}${enlarged ? '&dark' : ''}`;
        await checkWorkspaceAddTab({ page, info, label: `${mode}-${enlarged ? 'dark-font20' : 'light-font14'}`,
          url: `/e2e/workspace-drawer-harness.html?${query}` });
      });
  }
}
