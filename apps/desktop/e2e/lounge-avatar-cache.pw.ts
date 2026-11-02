import { expect, test } from '@playwright/test';
import { pixel, setupLounge } from './lounge-support';

test.setTimeout(120_000);

for (const mode of ['local', 'remote', 'web', 'mobile']) {
  test(`${mode}: cached avatars survive reload and update without message image payloads`, async ({ page }) => {
    const mobile = mode === 'mobile';
    const web = mode === 'web' || mobile;
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const relay = await setupLounge(page, web);
    relay.avatarCache.enabled = true;
    relay.avatarCache.set('alice', pixel); relay.avatarCache.set('bob', pixel);
    const enter = async () => {
      if (mobile) {
        await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
        await page.locator('.discovery-lounge').click();
        await page.getByRole('button', { name: '群聊', exact: true }).click();
      } else await page.getByRole('button', { name: '在线交流', exact: true }).click();
    };
    await page.goto(web ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready(); await enter();
    relay.push('第一次读取头像');
    const messages = page.locator('.lounge-message:not(.is-own)');
    await expect(messages.last().locator('.lounge-avatar img')).toHaveAttribute('src', pixel);
    await expect.poll(() => relay.avatarCache.transfers.length).toBe(2);
    relay.push('第二条使用缓存');
    await expect(messages).toHaveCount(2);
    expect(relay.avatarCache.transfers).toHaveLength(2);
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('我的头像也使用缓存');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => relay.sent.length).toBe(1);
    expect(relay.sent[0]).not.toHaveProperty('avatar');
    await expect(page.locator('.lounge-message.is-own .lounge-avatar img')).toHaveAttribute('src', pixel);
    await page.screenshot({ path: `../../.codex-tmp/lounge-avatar-cache-${mode}-cached.png` });
    await page.reload(); await enter();
    await expect.poll(() => relay.count()).toBe(2);
    await expect(messages.last().locator('.lounge-avatar img')).toHaveAttribute('src', pixel);
    expect(relay.avatarCache.transfers).toHaveLength(2);
    relay.avatarCache.set('bob', '');
    await expect(messages.locator('.lounge-avatar img')).toHaveCount(0);
    await page.screenshot({ path: `../../.codex-tmp/lounge-avatar-cache-${mode}-reset.png` });
    relay.avatarCache.set('bob', pixel);
    await expect(messages.last().locator('.lounge-avatar img')).toHaveAttribute('src', pixel);
    expect(relay.avatarCache.transfers).toHaveLength(4);
    await page.screenshot({ path: `../../.codex-tmp/lounge-avatar-cache-${mode}-changed.png` });
  });
}
