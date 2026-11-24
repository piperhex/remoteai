import { expect, type Page, type TestInfo } from '@playwright/test';

export async function verifyBrowserTabHover(page: Page, entry: string, info: TestInfo) {
  await page.goto(entry);
  const browser = page.locator('.browser-main-page');
  const documentUrl = new URL('/guide?private=hidden#section', page.url());
  await page.route('**/guide?private=hidden', route => route.fulfill({ contentType: 'text/html; charset=utf-8',
    body: '<title>使用指南</title><main><h1>使用指南</h1></main>' }));
  await browser.getByRole('combobox').fill(documentUrl.href);
  await browser.getByRole('combobox').press('Enter');
  await expect(browser.locator('iframe').contentFrame().getByRole('heading')).toHaveText('使用指南');
  await browser.getByRole('button', { name: '新标签页', exact: true }).click();
  const tabs = browser.getByRole('tab');
  const card = page.getByRole('tooltip');
  await tabs.first().hover();
  await expect(card.locator('strong')).toHaveText('使用指南');
  await expect(card.locator('span')).toHaveText(documentUrl.host);
  await expect(card).toContainText('内存用量暂不可用');
  await expect(card).not.toContainText('private');
  await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
  const bounds = await card.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual((await tabs.first().boundingBox())!.y);
  expect(bounds!.width).toBeLessThanOrEqual(400);
  await page.screenshot({ path: info.outputPath('background-tab-hover.png'), animations: 'disabled' });
  await card.hover();
  await page.waitForTimeout(200);
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await tabs.last().hover();
  await expect(card).toHaveText('新标签页');
  await tabs.first().hover();
  await expect(card.locator('strong')).toHaveText('使用指南');
  await tabs.first().click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(card).toBeHidden();
}
