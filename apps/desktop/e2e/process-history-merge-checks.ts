import { expect, test } from '@playwright/test';
import { processMergeSource } from './process-merge-fixture';

export function processHistoryMergeChecks(modes: string[]) {
  for (const mode of modes) for (const first of ['reasoning', 'commentary']) for (const width of [1280, 960]) {
    test(`${mode} ${first} ${width}: cached completed processes expand unique activities`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const raw = processMergeSource(first);
      let details = 0;
      await page.route('**/process-history.json*', route => route.fulfill({ json: raw }));
      await page.route('**/process-details.json*', async route => {
        details++;
        await route.fulfill({ json: { items: raw.turns![0].items.slice(1, -1) } });
      });
      const dark = width === 960;
      const label = `${mode}-${first}-${width}-${dark ? 'dark' : 'light'}`;
      await page.goto(`e2e/process-history-harness.html?cached&mode=${mode}${dark ? '&dark' : ''}`);
      await expect(page.getByText('项目检查完成。', { exact: true })).toBeVisible();
      await expect(page.locator('main')).toHaveAttribute('data-command-count', '2');
      await expect(page.locator('main')).toHaveAttribute('data-successful-command-count', '2');
      const process = page.locator(mode === 'local' ? '[data-turn-id="turn"] > details > summary'
        : '[data-message-id="turn:work:head"] button');
      expect(details).toBe(0);
      await page.screenshot({ path: `../../.codex-tmp/process-merge-evidence/${label}-collapsed.png` });
      await process.click();
      await expect(page.getByText('正在检查项目。', { exact: true })).toHaveCount(1);
      await page.locator(mode === 'local' ? 'summary[aria-label*="查看全部 2 项活动"]'
        : 'button[aria-label="查看连续操作，2 项活动"]').click();
      for (const id of ['one', 'two']) {
        const command = mode === 'local'
          ? page.locator(`[data-activity-list] [data-message-id="${id}"] > details > summary`)
          : page.locator('[data-activity-list] > .chat-inline-activity > button').filter({ hasText: `echo ${id}` });
        await expect(command).toHaveCount(1);
      }
      expect(details).toBe(1);
      await page.screenshot({ path: `../../.codex-tmp/process-merge-evidence/${label}-expanded.png` });
    });
  }
}
