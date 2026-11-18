import { expect, test } from '@playwright/test';

for (const mode of ['local', 'remote']) {
  for (const enlarged of [false, true]) {
    test(`${mode}: GUI source label at ${enlarged ? '20px narrow dark' : '14px wide light'}`, async ({ page }) => {
      await page.setViewportSize({ width: enlarged ? 860 : 1440, height: enlarged ? 700 : 900 });
      const suffix = `${mode === 'remote' ? '&dialog=1' : ''}${enlarged ? '&font=20&dark=1' : ''}`;
      await page.goto(`/e2e/conversation-sync-harness.html?mode=${mode}&projectless=1&guiPath=1${suffix}`);
      if (mode === 'remote') await page.getByRole('button', { name: '对话同步', exact: true }).click();
      const pane = page.getByRole('region', { name: '对话同步', exact: true });
      const label = `${mode === 'local' ? 'My PC' : 'Office PC'} · CodexGUI`;
      await pane.getByRole('combobox', { name: '来源目录' }).press('ArrowDown');
      const option = page.locator('.ant-select-item-option').filter({ hasText: label });
      await expect(option).toBeVisible();
      await expect(page.getByText(/dev\.codex\.switch/)).toHaveCount(0);
      await option.click();
      await expect(pane.locator('.ant-select-selection-item').first()).toHaveText(label);
      await expect(pane.getByText('整理本周工作计划', { exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => (Reflect.get(window, 'syncCalls') as {
        request: { action: string; homeId?: string } }[]).some(call =>
        call.request.action === 'list' && call.request.homeId === 'custom-gui'))).toBe(true);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `../../.codex-tmp/sync-source-${mode}-${enlarged ? 'font20-dark-narrow'
        : 'font14-light-wide'}.png`, animations: 'disabled' });
    });
  }
}

for (const mode of ['local', 'remote']) {
  test(mode + ': previous Agent Hub folder remains a selectable synchronization source', async ({ page }, info) => {
    await page.goto('/e2e/conversation-sync-harness.html?previousHome=1&mode=' + mode);
    const pane = page.getByRole('region', { name: '对话同步', exact: true });
    await pane.getByRole('combobox', { name: '来源目录' }).press('ArrowDown');
    const option = page.locator('.ant-select-item-option').filter({ hasText: '旧目录 · 当前未使用' }).last();
    await option.click();
    await expect(pane.locator('.ant-select-selection-item').first()).toContainText('D:/AgentHub/Archive/.codex');
    await expect.poll(() => page.evaluate(() => (Reflect.get(window, 'syncCalls') as {
      request: { action: string; homeId?: string } }[]).some(call => call.request.action === 'list'
        && call.request.homeId === 'previous:fixture'))).toBe(true);
    await page.screenshot({ path: info.outputPath(mode + '-previous-source.png'), animations: 'disabled' });
  });
}
