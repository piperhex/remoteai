import { expect, test } from '@playwright/test';
import { openReadGroup, foreground } from './lounge-group-read-support';

for (const mode of ['local', 'remote', 'web', 'mobile']) {
  test(`${mode}: only administrators see unique group readers and can open their names`, async ({ page }) => {
    const relay = await openReadGroup(page, mode);
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('请大家查看这条群聊通知。');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => relay.sent.length).toBe(1);
    const id = relay.sent[0].id;
    const grant = 'administrator-message-capability';
    relay.frame({ type: 'accepted', id, sentAt: new Date().toISOString(), groupReceipt: grant });
    await expect(page.getByRole('button', { name: '0 人已读', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '0 人已读', exact: true }).click();
    await expect(page.getByText('暂时还没有人已读', { exact: true })).toBeVisible();
    if (mode === 'local') {
      await page.evaluate(() => window.loungeFixture.setLanguage('en'));
      await expect(page.getByText('No one has read this message yet.', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '0 read', exact: true })).toBeVisible();
      await page.evaluate(() => window.loungeFixture.setLanguage('zh'));
    }
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '已读成员', exact: true })).toBeHidden();
    for (const reader of [{ id: 'bob', account: 'bob', nickname: '小波' },
      { id: 'bob', account: 'bob', nickname: '小波' }, { id: 'carol', account: 'carol', nickname: '小陈' }]) {
      relay.frame({ type: 'group-read', id, from: reader.id, to: 'alice', reader, groupReceipt: grant });
    }
    await expect(page.getByRole('button', { name: '2 人已读', exact: true })).toBeVisible();
    await expect(page.locator('.adm-toast-main')).toBeHidden();
    await page.screenshot({ path: `../../.codex-tmp/group-read-count-${mode}.png`, animations: 'disabled' });
    await page.getByRole('button', { name: '2 人已读', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '已读成员', exact: true });
    await expect(dialog.locator('strong').filter({ hasText: /^小波$/ })).toBeVisible();
    await expect(dialog.locator('strong').filter({ hasText: /^小陈$/ })).toBeVisible();
    await expect(dialog.locator('.lounge-group-reader')).toHaveCount(2);
    await expect(dialog).not.toHaveClass(/ant-zoom-(enter|appear|leave)/);
    await expect(dialog).toHaveCSS('opacity', '1');
    await page.screenshot({ path: `../../.codex-tmp/group-read-members-${mode}.png`, animations: 'disabled' });
    relay.policy(false);
    await expect(dialog).toBeHidden();
    await expect(page.locator('.lounge-group-read-count')).toHaveCount(0);
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('普通用户的群聊消息');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => relay.sent.length).toBe(2);
    relay.acceptGroup(1);
    await expect(page.getByRole('log').getByText('普通用户的群聊消息', { exact: true })).toBeVisible();
    await expect(page.locator('.lounge-group-read-count')).toHaveCount(0);
    relay.policy(true);
    await expect(page.getByRole('button', { name: '2 人已读', exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
  });

  test(`${mode}: group reads require a foreground message inside the viewport`, async ({ page }) => {
    const relay = await openReadGroup(page, mode);
    relay.policy(false);
    await foreground(page, false);
    const id = 'visible-administrator-message';
    const groupReceipt = 'visible-message-capability';
    relay.frame({ type: 'message', id, sender: { id: 'manager', account: 'manager', moderator: true },
      text: '实际看到这条通知后才算已读', images: [], groupReceipt, sentAt: new Date().toISOString() });
    for (let index = 0; index < 12; index++) relay.push(`后续消息 ${index}\n${'聊天记录\n'.repeat(8)}`);
    await expect(page.getByText('后续消息 11', { exact: false })).toBeVisible();
    await page.waitForTimeout(650);
    expect(relay.groupReadFrames).toEqual([]);
    await foreground(page, true);
    await page.waitForTimeout(650);
    expect(relay.groupReadFrames).toEqual([]);
    await page.getByText('实际看到这条通知后才算已读', { exact: true }).scrollIntoViewIfNeeded();
    await expect.poll(() => relay.groupReadFrames.map(frame => frame.id)).toEqual([id]);
    relay.frame({ type: 'group-read-confirm', id, from: 'manager', to: 'alice', groupReceipt });
    await expect(page.locator('.lounge-group-read-count')).toHaveCount(0);
    await page.screenshot({ path: `../../.codex-tmp/group-read-visible-${mode}.png` });
  });
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: narrow dark group reader dialog follows the enlarged global font`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 740 });
    await page.addInitScript(() => {
      localStorage.setItem('codex-switch:global-font-size', '20');
      localStorage.setItem('codex-switch.web.theme.v1', 'dark');
    });
    const relay = await openReadGroup(page, mode);
    if (mode !== 'web') await page.evaluate(() => window.loungeFixture.setTheme('dark'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('请查看这条群聊通知。');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => relay.sent.length).toBe(1);
    const id = relay.sent[0].id;
    const groupReceipt = 'enlarged-administrator-message';
    relay.frame({ type: 'accepted', id, sentAt: new Date().toISOString(), groupReceipt });
    relay.frame({ type: 'group-read', id, from: 'bob', to: 'alice', groupReceipt,
      reader: { id: 'bob', account: 'long.account.name', nickname: '这是一位昵称较长的已读成员，用于检查换行' } });
    const count = page.getByRole('button', { name: '1 人已读', exact: true });
    await expect(count).toBeVisible();
    expect(await count.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThan(12);
    await expect(page.locator('.adm-toast-main')).toBeHidden();
    await page.screenshot({ path: `../../.codex-tmp/group-read-dark-font20-${mode}.png`, animations: 'disabled' });
    await count.click();
    const dialog = page.getByRole('dialog', { name: '已读成员', exact: true });
    await expect(dialog.locator('.lounge-group-reader')).toHaveCount(1);
    expect(await dialog.locator('.lounge-group-readers')
      .evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(dialog).not.toHaveClass(/ant-zoom-(enter|appear|leave)/);
    await expect(dialog).toHaveCSS('opacity', '1');
    await page.screenshot({ path: `../../.codex-tmp/group-read-members-dark-font20-${mode}.png`,
      animations: 'disabled' });
  });
}
