import { expect, type Page, type TestInfo } from '@playwright/test';

export async function seedAddressHistory(page: Page, scope: string) {
  await page.addInitScript(scope => {
    const entries = [
      ['https://cloud.example.test/trj', 'Remote AI 工作台'],
      ['https://cloud.example.test/admin', '账户中心'],
      ['https://cloud.example.test/docs', '开发文档与使用指南'],
      ['https://example.test/guide', 'Cloud guide'],
      ['https://cloud.example.test/trj', '旧标题'],
    ].map(([url, title], index) => ({ id: `suggestion-${index}`, kind: 'visit', url, title, at: 100 - index }));
    localStorage.setItem(`remoteai:browser-data:${scope}`, JSON.stringify({ document: { revision: 0, entries } }));
  }, scope);
  await page.route(/^https:\/\/(cloud\.)?example\.test\//, route => route.fulfill({ contentType: 'text/html',
    body: '<title>History destination</title><h1>History destination</h1><input aria-label="Page draft" />' }));
}

export async function verifyAddressSuggestions(options: { page: Page; info: TestInfo; label: string }) {
  const { page, info, label } = options;
  const address = page.getByRole('combobox', { name: '页面地址', exact: true });
  const list = page.getByRole('listbox', { name: '历史记录', exact: true });
  await address.fill('cl');
  await expect(list.getByRole('option')).toHaveCount(4);
  await expect(list.getByRole('option').first()).toContainText('Remote AI 工作台');
  await expect(list.getByRole('option').first()).toContainText('https://cloud.example.test/trj');
  await page.screenshot({ path: info.outputPath(`${label}-matches.png`), animations: 'disabled' });
  const box = await list.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await address.press('ArrowDown'); await address.press('ArrowDown');
  await expect(list.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: info.outputPath(`${label}-keyboard.png`), animations: 'disabled' });
  await address.press('Escape');
  await expect(list).toHaveCount(0); await expect(address).toHaveValue('cl');
  await address.press('ArrowUp'); await address.press('Enter');
  await expect(address).toHaveValue('https://example.test/guide');
  await expect(list).toHaveCount(0); await expect(address).not.toBeFocused();
  await address.fill('开发');
  await expect(list.getByRole('option')).toHaveCount(1);
  await list.getByRole('option').click();
  await expect(address).toHaveValue('https://cloud.example.test/docs');
  await address.fill('no-history-match'); await expect(list).toHaveCount(0);
  await address.fill('cl');
  await address.dispatchEvent('compositionstart');
  await expect(list).toHaveCount(0);
  await address.press('Enter'); await expect(address).toHaveValue('cl');
  await address.dispatchEvent('compositionend', { data: 'cl' });
  await expect(list).toBeVisible();
  await address.press('Tab'); await expect(list).toHaveCount(0);
  await address.fill(''); await expect(list.getByRole('option')).toHaveCount(4);
  await address.press('Escape');
  await verifyHistoryUpdates(page);
}

async function verifyHistoryUpdates(page: Page) {
  const address = page.getByRole('combobox', { name: '页面地址', exact: true });
  const list = page.getByRole('listbox', { name: '历史记录', exact: true });
  // Enter without selecting a row must keep the user's intended address.
  await address.fill('cloud.example.test'); await expect(list).toBeVisible();
  await address.press('Enter'); await expect(address).toHaveValue('https://cloud.example.test/');
  await page.getByRole('button', { name: '浏览器设置', exact: true }).click();
  await page.getByRole('button', { name: '历史记录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '历史记录', exact: true });
  await dialog.locator('.browser-data-row').filter({ hasText: '账户中心' })
    .getByRole('button', { name: '删除此条记录' }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await address.fill('账户'); await expect(list).toHaveCount(0);
}
