import { expect, test } from '@playwright/test';

const message = '当前模型繁忙，请换个模型重试。';
for (const mode of ['local', 'remote']) {
  for (const width of [760, 1280]) {
    test(`${mode} errors stay at the process boundary at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/e2e/request-error-timeline-harness.html${mode === 'remote' ? '?remote' : ''}`);
      const error = page.getByText(message, { exact: true });
      await expect(error).toBeVisible();
      await expect(error).toHaveCount(1);
      expect(await error.evaluate(element => Boolean(element.closest('details, .chat-turn-summary')))).toBe(false);
      if (mode === 'remote') {
        expect(await error.evaluate(element => element.closest('.chat-entry-error')?.parentElement
          ?.classList.contains('chat-message-content'))).toBe(true);
      }
      const plan = mode === 'local' ? page.locator('summary').filter({ hasText: '任务计划' })
        : page.getByRole('button', { name: '查看任务计划', exact: true });
      await expect(plan).toBeVisible();
      expect((await error.boundingBox())!.y).toBeLessThan((await plan.boundingBox())!.y);
      await page.screenshot({ path: info.outputPath(`pc-${mode}-${width}-retrying-expanded.png`) });
      const collapse = mode === 'local'
        ? page.locator('summary[data-history-anchor]').first()
        : width > 860 ? page.getByRole('button', { name: /查看处理过程/ }).first()
          : page.getByRole('button', { name: '收起处理过程', exact: true });
      await collapse.click();
      await expect(error).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`pc-${mode}-${width}-retrying-collapsed.png`) });
      await page.getByRole('button', { name: '恢复连接', exact: true }).click();
      await expect(error).toHaveCount(0);
      await page.getByRole('button', { name: '重试失败', exact: true }).click();
      await expect(error).toBeVisible();
      expect((await error.boundingBox())!.y).toBeLessThan((await plan.boundingBox())!.y);
      await page.screenshot({ path: info.outputPath(`pc-${mode}-${width}-failed.png`) });
    });
  }
}
