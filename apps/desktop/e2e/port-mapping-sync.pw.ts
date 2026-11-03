import { expect, test } from '@playwright/test';
import type {} from './port-mapping-sync-fixture';

for (const mode of ['local', 'remote']) {
  test(`desktop ${mode} stays responsive while configuration sync is pending`, async ({ page, context }, testInfo) => {
    await page.goto(`/e2e/port-forwarding-harness.html?sync&mode=${mode}`);
    await expect.poll(() => page.evaluate(() => window.portMappingSyncFixture.calls)).toBeGreaterThan(0);
    await page.getByRole('button', { name: '端口映射', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '新建映射', exact: true }).click();
    await dialog.getByRole('spinbutton', { name: '远程端口' }).fill('3000');
    await dialog.getByRole('spinbutton', { name: '本地端口' }).fill('13000');
    await dialog.getByRole('button', { name: '添加并启动' }).click();
    await expect(dialog.getByRole('article').getByRole('status')).toHaveText('映射中');
    expect(await page.evaluate(() => window.portMappingSyncFixture.held)).toBe(true);
    expect(await page.evaluate(() => window.portMappingSyncFixture.maxActive)).toBe(1);
    await page.screenshot({ path: testInfo.outputPath(`${mode}-pending.png`) });
    await page.evaluate(() => window.portMappingSyncFixture.release());
    await expect(dialog).toContainText('配置已自动同步');
    expect(await page.evaluate(() => window.portMappingSyncFixture.maxActive)).toBe(1);
    await dialog.getByRole('button', { name: /^停止映射/ }).click();
    await expect(dialog.getByRole('article').getByRole('status')).toHaveText('已停止');
    await context.setOffline(true);
    const calls = await page.evaluate(() => window.portMappingSyncFixture.calls);
    await dialog.getByRole('button', { name: /^编辑映射/ }).click();
    await dialog.getByRole('spinbutton', { name: '远程端口' }).fill('3001');
    await dialog.getByRole('button', { name: '保存修改' }).click();
    await expect(dialog).toContainText('配置暂未同步');
    expect(await page.evaluate(() => window.portMappingSyncFixture.calls)).toBe(calls);
    await context.setOffline(false);
    await expect(dialog).toContainText('配置已自动同步');
  });
}
