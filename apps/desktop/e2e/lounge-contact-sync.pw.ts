import { expect, test, type Page } from '@playwright/test';
import { setupLounge } from './lounge-support';
import { LoungeContactsFixture } from './lounge-contact-support';

const webURL = process.env.LOUNGE_TEST_WEB_URL ?? 'http://127.0.0.1:1486/web/';
test.setTimeout(120_000);

async function enter(page: Page, mode: string, cloud: LoungeContactsFixture) {
  const relay = await setupLounge(page, mode === 'web', false, cloud);
  await page.goto(mode === 'web' ? webURL : `/e2e/lounge-harness.html?mode=${mode}`);
  await relay.ready(); await page.getByRole('button', { name: '在线交流', exact: true }).click();
  return relay;
}

test('mobile web: a clean login restores cloud contacts and follows live additions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cloud = new LoungeContactsFixture();
  cloud.users = [{ id: 'bob', account: 'bob@example.test' }];
  const relay = await setupLounge(page, true, false, cloud);
  await page.goto(webURL); await relay.ready();
  await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
  await page.locator('.discovery-lounge').click();
  const bob = page.getByRole('button', { name: '与 bob 私聊', exact: true });
  await expect(bob).toBeVisible(); await bob.click();
  await expect(page.locator('.lounge-heading h1')).toHaveText('bob');
  await expect(page.locator('.lounge-message')).toHaveCount(0);
  await page.getByRole('button', { name: '返回聊天列表', exact: true }).click();
  cloud.users.push({ id: 'carol', account: 'carol@example.test' }); cloud.changed();
  await expect(page.getByRole('button', { name: '与 carol 私聊', exact: true })).toBeVisible();
  await page.screenshot({ path: '../../.codex-tmp/lounge-cloud-contacts-mobile.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: contacts restore on a clean device and live additions sync without message replay`, async ({ page,
    browser }) => {
    const cloud = new LoungeContactsFixture();
    cloud.users = [{ id: 'bob', account: 'bob@example.test' }, { id: 'carol', account: 'carol@example.test' }];
    await enter(page, mode, cloud);
    await expect(page.locator('.lounge-people-list').getByRole('button', { name: /^与 .+ 私聊$/ })).toHaveCount(2);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const other = await context.newPage();
      await enter(other, mode, cloud);
      await expect(other.locator('.lounge-people-list').getByRole('button', { name: /^与 .+ 私聊$/ })).toHaveCount(2);
      await expect(other.locator('.lounge-message')).toHaveCount(0);
      await expect(other.locator('.lounge-avatar-unread')).toHaveCount(0);
      await other.getByRole('button', { name: '与 bob 私聊', exact: true }).click();
      await expect(other.locator('.lounge-heading h1')).toHaveText('bob');
      await expect(other.locator('.lounge-message')).toHaveCount(0);
      cloud.users.push({ id: 'dana', account: 'dana@example.test' }); cloud.changed();
      for (const device of [page, other]) {
        await expect(device.locator('.lounge-people-list').getByRole('button', { name: /^与 .+ 私聊$/ })).toHaveCount(3);
      }
      await other.screenshot({ path: `../../.codex-tmp/lounge-cloud-contacts-${mode}.png`, animations: 'disabled' });
    } finally { await context.close(); }
  });

  test(`${mode}: failed contact sync can be retried without clearing local conversations`, async ({ page }) => {
    const cloud = new LoungeContactsFixture(); cloud.fail = true;
    const relay = await enter(page, mode, cloud);
    relay.private('本机消息保留');
    await expect(page.getByRole('alert')).toContainText('私聊联系人同步失败');
    cloud.users = [{ id: 'carol', account: 'carol@example.test' }]; cloud.fail = false;
    await page.getByRole('alert').getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.getByRole('alert')).toBeHidden();
    await expect(page.locator('.lounge-people-list').getByRole('button', { name: /^与 .+ 私聊$/ })).toHaveCount(2);
    await page.getByRole('button', { name: '与 bob 私聊', exact: true }).click();
    await expect(page.locator('.lounge-text')).toHaveText('本机消息保留');
  });
}
