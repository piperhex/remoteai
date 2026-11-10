import { expect, test } from '@playwright/test';

for (const mode of ['local', 'remote']) {
  test(`${mode} sync becomes a resumable download and cleans temporary bundles after import`, async ({ page }) => {
    await page.goto(`/e2e/conversation-sync-harness.html?mode=${mode}&managed=1&hold=1&path=direct`);
    await page.getByRole('button', { name: '展开项目: F:/projects/remoteai', exact: true }).click();
    await page.getByRole('checkbox').last().check();
    await page.getByRole('button', { name: '对话同步', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('对话总大小');
    await expect(dialog).toContainText('2.0 MB');
    await expect(dialog).toHaveCSS('opacity', '1');
    await expect(dialog).toHaveCSS('transform', 'none');
    await page.screenshot({ path: `../../.codex-tmp/sync-download-${mode}-confirm.png`, animations: 'disabled' });
    await dialog.getByRole('button', { name: '开始同步', exact: true }).click();
    if (mode === 'remote') {
      await expect(dialog.getByText('128.0 KB / 512.0 KB', { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: '后台继续' }).click();
    } else await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: '下载管理', exact: true }).click();
    if (mode === 'remote') {
      await expect(page.getByRole('progressbar')).toHaveAttribute('value', '25');
      await page.getByRole('button', { name: '暂停', exact: true }).click();
      await expect(page.getByText('已暂停', { exact: true })).toBeVisible();
      await page.screenshot({ path: '../../.codex-tmp/sync-download-remote-paused.png', animations: 'disabled' });
      await page.evaluate(() => { (Reflect.get(window, 'releaseSyncTransfer') as () => void)(); });
      await page.getByRole('button', { name: '继续下载', exact: true }).click();
    }
    await expect(page.getByText('已导入', { exact: true })).toBeVisible();
    await expect(page.getByText('已同步 1 条对话，跳过 0 条。')).toBeVisible();
    await expect(page.getByRole('button', { name: '保存到设备' })).toHaveCount(0);
    await page.screenshot({ path: `../../.codex-tmp/sync-download-${mode}-imported.png`, animations: 'disabled' });
    await expect.poll(() => page.evaluate(() => (Reflect.get(window, 'syncCalls') as {
      request: { action: string } }[]).filter(call => call.request.action === 'close').length))
      .toBe(mode === 'remote' ? 2 : 1);
  });
}
