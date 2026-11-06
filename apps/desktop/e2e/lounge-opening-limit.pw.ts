import { expect, test } from '@playwright/test';
import { setupLounge } from './lounge-support';

for (const mode of ['local', 'remote', 'web', 'mobile']) {
  test(`${mode}: wait for a private reply, preserve drafts and allow free chat afterwards`, async ({ page }) => {
    test.setTimeout(120_000);
    const mobile = mode === 'mobile';
    const web = mode === 'web' || mobile;
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const relay = await setupLounge(page, web);
    const enter = async () => {
      if (mobile) {
        await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
        await page.locator('.discovery-lounge').click();
        await page.getByRole('button', { name: '群聊', exact: true }).click();
      } else await page.getByRole('button', { name: '在线交流', exact: true }).click();
    };
    await page.goto(web ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready(); await enter(); relay.push('opening-limit-contact');
    if (mobile && await page.getByRole('button', { name: '成员', exact: true }).isVisible()) {
      await page.getByRole('button', { name: '成员', exact: true }).click();
      await page.locator('.lounge-mobile-sheet')
        .getByRole('button', { name: '查看 bob 的资料', exact: true }).click();
      await page.getByRole('button', { name: '发消息', exact: true }).click();
    } else {
      await page.locator('.lounge-bubble').filter({ hasText: 'opening-limit-contact' }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: '发起私聊' }).click();
    }
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    const send = page.getByRole('button', { name: '发送', exact: true });
    await input.fill('first greeting'); await send.click();
    await expect(input).toHaveValue('');
    await expect.poll(() => relay.sent.length).toBe(1);
    relay.receipt(relay.sent[0].id, 'read');
    await input.fill('keep this draft'); await send.click();
    await expect(page.getByText('对方回复后才能继续发送。', { exact: true })).toBeVisible();
    await expect(input).toHaveValue('keep this draft');
    expect(relay.sent).toHaveLength(1);
    await page.screenshot({ path: `../../.codex-tmp/lounge-opening-${mode}.png` });
    if (mode === 'local') {
      await page.evaluate(() => window.loungeFixture.setLanguage('en'));
      await expect(page.getByText('You can send more messages after they reply.', { exact: true })).toBeVisible();
      await page.evaluate(() => window.loungeFixture.setLanguage('zh'));
      await expect(page.getByText('对方回复后才能继续发送。', { exact: true })).toBeVisible();
    }
    relay.private('first actual reply');
    await expect(page.getByText('first actual reply', { exact: true })).toBeVisible();
    await send.click(); await expect(input).toHaveValue('');
    await input.fill('another message without waiting'); await send.click();
    await expect.poll(() => relay.sent.length).toBe(3);
    expect(relay.sent.map(value => value.text)).toEqual([
      'first greeting', 'keep this draft', 'another message without waiting',
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`${mode}: moderators can send before a reply and lose the exemption after revocation`, async ({ page }) => {
    const mobile = mode === 'mobile';
    const web = mode === 'web' || mobile;
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const relay = await setupLounge(page, web, true);
    await page.goto(web ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready();
    relay.policy(true);
    if (mobile) {
      await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
      await page.locator('.discovery-lounge').click();
      await page.getByRole('button', { name: '群聊', exact: true }).click();
    } else await page.getByRole('button', { name: '在线交流', exact: true }).click();
    relay.push('moderator-opening-contact');
    await page.locator('.lounge-message').filter({ hasText: 'moderator-opening-contact' })
      .getByRole('button', { name: mobile ? '查看 bob 的资料' : '与 bob 私聊', exact: true }).click();
    if (mobile) await page.getByRole('button', { name: '发消息', exact: true }).click();
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    const send = page.getByRole('button', { name: '发送', exact: true });
    for (const text of ['你好，我是在线交流管理员。', '如需帮助，可以在这里告诉我。', '方便时回复即可。']) {
      await input.fill(text); await send.click();
      await expect(input).toHaveValue('');
      await expect(page.getByText(text, { exact: true })).toBeVisible();
    }
    await expect.poll(() => relay.sent.length).toBe(3);
    expect(relay.sent.every(frame => frame.to === 'bob')).toBe(true);
    await expect(page.getByText('对方回复后才能继续发送。', { exact: true })).toHaveCount(0);
    await expect(page.locator('.adm-toast-main')).toBeHidden();
    await page.screenshot({ path: `../../.codex-tmp/lounge-moderator-opening-${mode}.png` });
    relay.policy(false);
    await input.fill('撤销管理员后保留的草稿'); await send.click();
    await expect(page.getByText('对方回复后才能继续发送。', { exact: true })).toBeVisible();
    await expect(input).toHaveValue('撤销管理员后保留的草稿');
    expect(relay.sent).toHaveLength(3);
    await page.screenshot({ path: `../../.codex-tmp/lounge-moderator-revoked-${mode}.png` });
    relay.policy(true);
    await send.click(); await expect(input).toHaveValue('');
    await expect.poll(() => relay.sent.length).toBe(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
