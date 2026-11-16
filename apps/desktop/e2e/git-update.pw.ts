import { test } from '@playwright/test';
import { checkSafeUpdate } from './git-update-checks';

for (const mode of ['local', 'remote']) {
  for (const enlarged of [false, true]) {
    test(`${mode}: safe update ${enlarged ? 'dark narrow font20' : 'light wide font14'}`, async ({ page }, info) => {
      await page.setViewportSize({ width: enlarged ? 720 : 1280, height: 900 });
      await checkSafeUpdate({ page, info, label: `${mode}-${enlarged ? 'dark-font20' : 'light-font14'}`,
        url: `/e2e/git-update.html?mode=${mode}&font=${enlarged ? 20 : 14}${enlarged ? '&dark' : ''}` });
    });
  }
}
