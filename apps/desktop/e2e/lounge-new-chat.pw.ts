import { expect, test } from '@playwright/test';
import { setupLounge } from './lounge-support';

const webURL = process.env.LOUNGE_TEST_WEB_URL ?? 'http://127.0.0.1:1486/web/';
test.setTimeout(120_000);

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: new chat finds an unseen account by full prefix or email and sends privately`, async ({ page }) => {
    const relay = await setupLounge(page, mode === 'web');
    await page.goto(mode === 'web' ? webURL : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready();
    await page.getByRole('button', { name: '在线交流', exact: true }).click();
    const newChat = page.getByRole('button', { name: '新聊天', exact: true });
    await expect(newChat.locator('svg')).toHaveCount(1);
    const header = await page.locator('.lounge-people-heading').boundingBox();
    const button = await newChat.boundingBox();
    expect(button!.x).toBeGreaterThan(header!.x + header!.width / 2);
    await newChat.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('暂无最近发送用户，可输入邮箱查找。')).toBeVisible();
    const input = dialog.getByRole('textbox', { name: '完整邮箱前缀或邮箱' });
    await expect(input).toBeFocused();
    for (const [query, error] of [['bo', '未找到该用户'], ['shared', '多个用户使用此前缀'],
      ['alice@example.test', '这是你自己的账号']]) {
      await input.fill(query); await input.press('Enter');
      await expect(dialog.getByRole('alert')).toContainText(error);
    }
    await page.screenshot({ path: `../../.codex-tmp/lounge-new-chat-${mode}.png`, animations: 'disabled' });
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(560);
    await input.fill(' BOB '); await input.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.locator('.lounge-heading h1')).toHaveText('bob');
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('通过邮箱找到你');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => relay.sent.map(frame => frame.to)).toEqual(['bob']);
    await newChat.click(); await input.fill('bob@EXAMPLE.test'); await input.press('Enter');
    await expect(dialog).toBeHidden();
    expect(relay.lookups.slice(-2)).toEqual(['BOB', 'bob@EXAMPLE.test']);
    await expect(page.locator('.lounge-people-list').getByRole('button', { name: /^与 .+ 私聊$/ })).toHaveCount(1);
    await page.reload(); await relay.ready();
    await page.getByRole('button', { name: '在线交流', exact: true }).click();
    await expect(page.getByRole('button', { name: '与 bob 私聊', exact: true })).toBeVisible();
  });

  test(`${mode}: recent speakers start chats and cancelling lookup keeps the current draft`, async ({ page }) => {
    const relay = await setupLounge(page, mode === 'web');
    await page.goto(mode === 'web' ? webURL : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready(); relay.push('最近发言');
    await page.getByRole('button', { name: '在线交流', exact: true }).click();
    const newChat = page.getByRole('button', { name: '新聊天', exact: true });
    await newChat.click();
    await page.getByRole('dialog').getByRole('button', { name: '与 bob 私聊' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '发起私聊', exact: true }).click();
    await expect(page.locator('.lounge-heading h1')).toHaveText('bob');
    expect(relay.lookups).toEqual([]);
    await page.getByRole('button', { name: '群聊', exact: true }).click();
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('群聊草稿');
    relay.lookupReply(false);
    await newChat.click();
    await page.getByRole('dialog').getByRole('textbox').fill('bob');
    await page.getByRole('dialog').getByRole('button', { name: '发起私聊', exact: true }).click();
    await page.locator('.ant-modal-close').click();
    await expect(page.locator('.lounge-heading h1')).toHaveText('在线交流');
    await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('群聊草稿');
    relay.lookupReply(true);
    await newChat.click();
    await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('');
    await page.getByRole('dialog').getByRole('textbox').fill('bob');
    await page.getByRole('dialog').getByRole('textbox').press('Enter');
    await expect(page.locator('.lounge-heading h1')).toHaveText('bob');
  });

  test(`${mode}: new chat filters, selects and clears recent users without removing conversations`, async ({ page }) => {
    const relay = await setupLounge(page, mode === 'web');
    await page.goto(mode === 'web' ? webURL : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready();
    for (const id of ['carol', 'dana', 'bob']) relay.private('保留聊天内容', { id, account: `${id}@example.test` });
    await page.getByRole('button', { name: '在线交流', exact: true }).click();
    const newChat = page.getByRole('button', { name: '新聊天', exact: true });
    await newChat.click();
    const dialog = page.getByRole('dialog');
    const rows = dialog.locator('.lounge-new-chat-person');
    const start = dialog.getByRole('button', { name: '发起私聊', exact: true });
    const input = dialog.getByRole('textbox');
    await expect(rows).toHaveCount(3);
    await expect(start).toBeDisabled();
    await expect(dialog).toHaveCSS('transform', 'none');
    await dialog.screenshot({ path: `../../.codex-tmp/lounge-new-chat-layout-${mode}.png`, animations: 'disabled' });
    await input.fill('Bo');
    await expect(rows).toHaveCount(1);
    await rows.click();
    await expect(rows).toHaveAttribute('aria-pressed', 'true');
    await expect(start).toBeEnabled();
    await expect(dialog).toBeVisible();
    expect(relay.sent).toEqual([]);
    await input.fill('nobody');
    await expect(rows).toHaveCount(0);
    await expect(dialog.getByText('没有匹配的最近用户', { exact: false })).toBeVisible();
    await input.fill('');
    await expect(start).toBeDisabled();
    await dialog.getByRole('button', { name: '清空记录', exact: true }).click();
    await expect(rows).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '清空记录', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator('.lounge-people-list').getByRole('button', { name: /^与 .+ 私聊$/ })).toHaveCount(3);
    await page.reload(); await relay.ready();
    await page.getByRole('button', { name: '在线交流', exact: true }).click(); await newChat.click();
    await expect(rows).toHaveCount(0);
    relay.push('清空后的新消息');
    await expect(rows).toHaveCount(1);
    await rows.click(); await start.click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.lounge-heading h1')).toHaveText('bob');
    await expect(page.locator('.lounge-text').filter({ hasText: '保留聊天内容' })).toHaveCount(1);
  });
}

test('new chat translations remain available offline and fit a narrow desktop drawer', async ({ page }) => {
  const relay = await setupLounge(page);
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto('/e2e/lounge-harness.html?dark'); await relay.ready();
  await page.getByRole('button', { name: '在线交流', exact: true }).click();
  await page.getByRole('button', { name: '用户列表', exact: true }).click();
  await page.getByRole('button', { name: '新聊天', exact: true }).click();
  await expect(page.locator('.ant-drawer-content')).toBeHidden();
  await expect(page.locator('.lounge-new-chat-dialog input')).toBeFocused();
  await page.context().setOffline(true);
  for (const language of ['en', 'ja', 'ru', 'zh'] as const) {
    await page.evaluate(value => window.loungeFixture.setLanguage(value), language);
    const dialog = page.locator('.lounge-new-chat-dialog');
    await expect(dialog).not.toContainText('client.lounge.');
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(560);
    await page.screenshot({ path: `../../.codex-tmp/lounge-new-chat-dark-${language}.png`, animations: 'disabled' });
  }
});
