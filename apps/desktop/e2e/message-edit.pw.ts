import { test } from '@playwright/test';
import { checkMessageEditing } from './message-edit-checks';

for (const mode of ['local', 'remote']) {
  for (const scenario of ['light', 'dark', 'large-narrow']) {
    test(`${mode}: ${scenario} sends with Enter and wraps with Shift+Enter`, async ({ page }) => {
      await page.route('https://fonts.googleapis.com/**', route => route.abort());
      await page.route('https://fonts.gstatic.com/**', route => route.abort());
      await page.setViewportSize({ width: scenario === 'large-narrow' ? 900 : 1100, height: 780 });
      await page.goto(`/e2e/message-edit-harness.html?mode=${mode}&${scenario === 'dark' ? 'dark' : ''}`
        + `${scenario === 'large-narrow' ? '&large' : ''}`, { waitUntil: 'domcontentloaded' });
      await checkMessageEditing(page, `../../.codex-tmp/message-edit-${mode}-${scenario}.png`);
    });
  }
}
