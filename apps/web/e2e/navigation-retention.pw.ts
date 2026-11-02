import { expect, test } from '@playwright/test';
import { connect, fixtureUrl, login, navigate, send, settled } from './chat-helpers';

test('desktop navigation retains account UI and the connected conversation', async ({ page, request }, info) => {
  await request.post(`${fixtureUrl}/test/reset`);
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await login(page);
  await connect(page);
  await send(page, 'Keep this conversation while switching pages.');
  await settled(page);
  const conversation = await page.locator('.chat-page').elementHandle();
  await navigate(page, '账号');
  const accountPage = page.locator('[data-primary-page="accounts"] .accounts-page');
  await expect(accountPage).toBeVisible();
  const retained = await accountPage.elementHandle();
  await page.screenshot({ path: info.outputPath('web-desktop-accounts.png') });
  await navigate(page, '设置');
  expect(await retained?.evaluate(node => node.isConnected)).toBe(true);
  await navigate(page, '账号');
  expect(await accountPage.evaluate((node, previous) => node === previous, retained)).toBe(true);
  await navigate(page, '聊天');
  expect(await conversation?.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.getByText('Keep this conversation while switching pages.', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('web-desktop-chat-return.png') });
});
