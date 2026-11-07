import { expect, test } from '@playwright/test';

for (const width of [390, 1280]) {
  test(`collapses repeated errors into a single yellow row at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/e2e/error-diagnostics-harness.html');
    const notice = page.locator('[data-request-error]');
    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveAttribute('data-request-error', 'last:error:0');
    await expect(notice).toContainText('×3');
    const summary = notice.locator('summary');
    const preview = summary.locator('[role="status"]');
    await expect(preview).toHaveCSS('white-space', 'nowrap');
    await expect(preview).toHaveCSS('text-overflow', 'ellipsis');
    await expect(preview).toHaveCSS('color', 'rgb(193, 139, 37)');
    await expect(preview).toHaveText('本次回复遇到问题，已中断。');
    await expect(notice).not.toContainText('读取响应时连接已关闭');
    await expect(notice.locator('pre')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '重试', exact: true })).toHaveCount(1);
    await page.screenshot({ path: info.outputPath('collapsed-errors.png') });
    await summary.click();
    await expect(notice.locator('pre')).toContainText('读取响应时连接已关闭');
    expect((await notice.locator('pre').boundingBox())!.width).toBeLessThanOrEqual(400);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await summary.click();
    await expect(notice.locator('pre')).toHaveCount(0);
  });
}

test('exports from the error tab and reads raw records while polling', async ({ page }, info) => {
  const entry = { id: 42, createdAt: '2026-10-22T01:02:03Z', source: 'proxy',
    message: '读取上游响应失败：连接意外关闭 (os error 10054)', statusCode: 502 };
  let polls = 0;
  await page.route('**/__codex_switch__/api/invoke', async route => {
    const { command } = route.request().postDataJSON();
    if (command === 'list_error_logs') {
      polls++;
      await route.fulfill({ json: { ok: true,
        result: { entries: [entry], total: 1, page: 1, hasMore: false, snapshotId: 42 } } });
    } else await route.fulfill({ json: { ok: true, result: command.includes('unlimited') ? false : [] } });
  });
  await page.goto('/e2e/error-diagnostics-harness.html?logs');
  const exportButton = page.getByRole('button', { name: '导出日志', exact: true });
  await expect(exportButton).toBeVisible();
  expect((await exportButton.boundingBox())!.x).toBeGreaterThan(900);
  await exportButton.click();
  await expect(page.getByLabel('导出次数')).toHaveText('1');
  await page.getByRole('button', { name: '查看', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(JSON.parse((await page.getByRole('dialog').locator('pre').textContent())!)).toEqual(entry);
  await expect.poll(() => polls).toBeGreaterThan(1);
  await page.screenshot({ path: info.outputPath('raw-log.png') });
  await page.getByRole('dialog').getByRole('button', { name: /关\s*闭/ }).click();
  await page.getByRole('tab', { name: '代理会话', exact: true }).click();
  await expect(exportButton).toHaveCount(0);
  await page.getByRole('tab', { name: '错误日志', exact: true }).click();
  await expect(exportButton).toBeVisible();
  await page.screenshot({ path: info.outputPath('log-diagnostics.png') });
});
