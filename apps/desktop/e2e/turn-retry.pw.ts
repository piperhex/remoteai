import { expect, test } from '@playwright/test';

const CONTINUE_MESSAGE = '请继续完成刚才中断的任务。';

for (const remote of [false, true]) {
  for (const width of [390, 1280]) {
    test(`retries a failed conversation on ${remote ? 'remote' : 'local'} at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/e2e/turn-retry-harness.html${remote ? '?remote' : ''}`);
      const retry = page.getByRole('button', { name: '重试', exact: true });
      await expect(retry).toHaveCount(1);
      await expect(retry).toBeVisible();
      await expect(page.getByText('本次回复遇到问题，已中断。', { exact: true })).toBeVisible();
      await expect(page.locator('body')).not.toContainText('HTTP 502 Bad Gateway');
      await page.getByLabel('消息草稿').fill('保留这份草稿');
      await page.getByLabel('暂不可用').check();
      await expect(retry).toBeDisabled();
      await page.getByLabel('暂不可用').uncheck();
      await expect(retry).toBeEnabled();
      const details = remote ? page.getByText('查看报错详情', { exact: true })
        : page.locator('summary[aria-label="查看报错详情"]');
      const linkBounds = (await details.boundingBox())!;
      const retryBounds = (await retry.boundingBox())!;
      expect(retryBounds.x - linkBounds.x - linkBounds.width).toBeGreaterThanOrEqual(0);
      expect(retryBounds.x - linkBounds.x - linkBounds.width).toBeLessThanOrEqual(6);
      expect(Math.abs(retryBounds.y + retryBounds.height / 2 - linkBounds.y - linkBounds.height / 2)).toBeLessThan(3);
      expect(retryBounds.height).toBeLessThanOrEqual(24);
      await expect(retry).toHaveCSS('padding', '2px');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('retry-button.png') });
      await retry.click();
      const pending = page.getByRole('button', { name: '正在重试…', exact: true });
      await expect(pending).toBeDisabled();
      if (!remote) await expect(page.locator('[data-request-error] > details')).not.toHaveAttribute('open');
      await expect(page.getByLabel('发送次数')).toHaveText('1');
      await expect(retry).toBeEnabled();
      await retry.click();
      await expect(page.getByText('已继续检查项目。')).toBeVisible();
      await expect(page.getByText(CONTINUE_MESSAGE, { exact: true })).toHaveCount(0);
      await expect(page.getByLabel('发送次数')).toHaveText('2');
      await expect(retry).toHaveCount(0);
      await expect(page.getByLabel('消息草稿')).toHaveValue('保留这份草稿');
    });
  }
}
