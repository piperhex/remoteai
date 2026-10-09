import { expect, test } from '@playwright/test';

for (const remote of [false, true]) {
  for (const width of [390, 1280]) {
    test(`retries a failed conversation on ${remote ? 'remote' : 'local'} at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/e2e/turn-retry-harness.html${remote ? '?remote' : ''}`);
      const retry = page.getByRole('button', { name: '重试', exact: true });
      await expect(retry).toHaveCount(1);
      await expect(retry).toBeVisible();
      await page.getByLabel('消息草稿').fill('保留这份草稿');
      await page.getByLabel('暂不可用').check();
      await expect(retry).toBeDisabled();
      await page.getByLabel('暂不可用').uncheck();
      await expect(retry).toBeEnabled();
      const error = page.getByText('本次回复遇到问题，已中断。', { exact: false }).first();
      expect((await retry.boundingBox())!.y).toBeGreaterThanOrEqual((await error.boundingBox())!.y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('retry-button.png') });
      await retry.click();
      await expect(page.getByRole('button', { name: '正在重试…', exact: true })).toBeDisabled();
      await expect(page.getByLabel('发送次数')).toHaveText('1');
      await expect(retry).toBeEnabled();
      await retry.click();
      await expect(page.getByText('已继续检查项目。')).toBeVisible();
      await expect(page.getByLabel('发送次数')).toHaveText('2');
      await expect(retry).toHaveCount(0);
      await expect(page.getByLabel('消息草稿')).toHaveValue('保留这份草稿');
    });
  }
}
