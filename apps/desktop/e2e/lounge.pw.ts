import { openLoungeAction } from './lounge-mobile-actions';
import { openDesktopAvatarSettings } from './lounge-account-actions';
import { expect, test } from '@playwright/test';
import { pixel, setupLounge } from './lounge-support';
import type {} from './lounge-harness';
import type {} from './lounge-admin-harness';

for (const width of [390, 320]) {
  test(`mobile web ${width}: discovery, unread, touch composer, history and moderation`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const relay = await setupLounge(page, true);
    await page.goto('http://127.0.0.1:1486/web/'); await relay.ready();
    relay.push('手机收到的新消息');
    await expect(page.locator('.mobile-lounge-badge')).toHaveText('1');
    await page.locator('.mobile-tabbar').getByText('发现', { exact: true }).click();
    const entry = page.locator('.discovery-lounge');
    await expect(entry.locator('.lounge-nav-badge')).toHaveText('1');
    await page.screenshot({ path: `../../.codex-tmp/lounge-mobile-discovery-${width}.png` });
    await entry.click();
    await page.getByRole('button', { name: '群聊', exact: true }).click();
    await expect(page.getByText('手机收到的新消息')).toBeVisible();
    await expect(page.locator('.mobile-lounge-badge')).toHaveCount(0);
    await expect(page.locator('.mobile-tabbar')).toBeHidden();
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    await input.fill('Mobile draft'); await input.press('Enter'); await input.press('A');
    expect(relay.sent).toHaveLength(0);
    await expect(input).toHaveValue('Mobile draft\nA');
    await page.locator('.lounge-composer input[type=file]').setInputFiles({ name: 'image.png', mimeType: 'image/png',
      buffer: Buffer.from(pixel.split(',')[1], 'base64') });
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(input).toHaveValue(''); expect(relay.sent[0].images).toHaveLength(1);
    await input.fill('保留草稿');
    await openLoungeAction(page, '历史记录');
    await page.getByRole('textbox', { name: '搜索消息或账户' }).fill('Mobile');
    await expect(page.locator('.lounge-history-message')).toHaveCount(1);
    await page.screenshot({ path: `../../.codex-tmp/lounge-mobile-history-${width}.png`, animations: 'disabled' });
    await page.getByRole('button', { name: '返回聊天', exact: true }).click();
    await expect(input).toHaveValue('保留草稿');
    relay.policy(true);
    await page.getByRole('button', { name: '管理 bob 的发言权限' }).click();
    await page.getByRole('spinbutton').fill('30'); await page.getByRole('button', { name: /^禁\s*言$/ }).click();
    await expect.poll(() => relay.moderation.length).toBe(1);
    relay.policy(false, new Date(Date.now() + 60000).toISOString());
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    relay.policy(false); await relay.close(); await expect.poll(relay.count).toBe(2);
    await page.setViewportSize({ width, height: 450 });
    await expect(page.locator('.lounge-page')).toBeVisible();
    const sendBox = await page.getByRole('button', { name: '发送', exact: true }).boundingBox();
    expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(450);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../../.codex-tmp/lounge-mobile-keyboard-${width}.png` });
    await page.getByRole('button', { name: '返回聊天列表' }).click();
    await page.getByRole('button', { name: '返回发现' }).click();
    await expect(entry).toBeVisible();
  });
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: background connection, unread badge, mixed content and recovery`, async ({ page }) => {
    const relay = await setupLounge(page, mode === 'web');
    await page.goto(mode === 'web' ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready();
    relay.push('先收到的消息');
    await expect(page.locator('.lounge-nav-badge')).toHaveText('1');
    const menu = page.getByRole('button', { name: '在线交流', exact: true });
    const downloads = page.getByRole('button', { name: '下载管理', exact: true }).first();
    const menuBox = await menu.boundingBox();
    const downloadBox = await downloads.boundingBox();
    expect(menuBox!.y).toBeLessThan(downloadBox!.y);
    await page.bringToFront(); await menu.click();
    await expect(page.getByText('先收到的消息')).toBeVisible();
    await expect(page.locator('.lounge-nav-badge')).toHaveCount(0);
    relay.push('今天也要记得休息 ☕', [pixel]);
    await expect(page.locator('.lounge-message')).toHaveCount(2);
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    await input.fill('文字和图片一起发送 ');
    await page.locator('.lounge-composer input[type=file]').setInputFiles({ name: 'picture.png', mimeType: 'image/png',
      buffer: Buffer.from(pixel.split(',')[1], 'base64') });
    await expect(page.locator('.lounge-attachments img')).toHaveCount(1);
    await page.getByRole('button', { name: '表情', exact: true }).click();
    await page.getByRole('button', { name: '😀', exact: true }).click();
    await expect(page.locator('.lounge-emoji-picker')).toBeHidden();
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(input).toHaveValue('');
    expect(relay.sent[0].images).toHaveLength(1);
    expect(relay.sent[0].text).toContain('😀');
    expect(relay.sent[0].text).toContain('文字和图片一起发送');
    await expect(page.locator('.lounge-message.is-own')).toHaveCount(1);
    await expect(page.locator('.lounge-avatar').last()).toHaveText('AL');
    await page.screenshot({ path: `../../.codex-tmp/lounge-${mode}.png` });
    await relay.close();
    await expect.poll(relay.count).toBe(2);
    relay.push('重新连接后收到的新消息');
    await expect(page.getByText('重新连接后收到的新消息')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('compresses photos larger than 1 MB before sending, and switches offline translations in dark mode', async ({ page }) => {
  const relay = await setupLounge(page);
  await page.goto('/e2e/lounge-harness.html?dark'); await relay.ready();
  await page.getByRole('button', { name: '在线交流', exact: true }).click();
  const data = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    const pixels = context.createImageData(1200, 1200);
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] = Math.random() * 255; pixels.data[i + 1] = Math.random() * 255;
      pixels.data[i + 2] = Math.random() * 255; pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0); return canvas.toDataURL('image/png').split(',')[1];
  });
  const original = Buffer.from(data, 'base64'); expect(original.byteLength).toBeGreaterThan(1024 * 1024);
  await page.locator('input[type=file]').setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: original });
  await expect(page.locator('.lounge-attachments img')).toHaveCount(1);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => relay.sent.length).toBe(1);
  expect(Buffer.from(relay.sent[0].images[0].split(',')[1], 'base64').byteLength).toBeLessThanOrEqual(1024 * 1024);
  await page.context().setOffline(true);
  for (const language of ['en', 'ja', 'ru', 'zh'] as const) {
    await page.evaluate(value => window.loungeFixture.setLanguage(value), language);
    await expect(page.locator('.lounge-heading')).not.toContainText('client.lounge');
    await page.screenshot({ path: `../../.codex-tmp/lounge-dark-${language}.png` });
  }
});

test('moderators can mute and unmute an account; mute updates disable sending without adding unread messages',
  async ({ page }) => {
    const relay = await setupLounge(page);
    await page.goto('/e2e/lounge-harness.html'); await relay.ready();
    relay.policy(true);
    relay.push('可以管理这位用户');
    await page.getByRole('button', { name: '在线交流', exact: true }).click();
    await page.getByRole('button', { name: '管理 bob 的发言权限' }).click();
    await page.getByRole('spinbutton', { name: '禁言时长（分钟）' }).fill('30');
    await page.getByRole('button', { name: /^禁\s*言$/ }).click();
    await expect.poll(() => relay.moderation).toEqual([{ type: 'moderate', id: expect.any(String),
      userId: 'bob', minutes: 30 }]);
    await page.getByRole('button', { name: '管理 bob 的发言权限' }).click();
    await page.getByRole('button', { name: '解除禁言' }).click();
    await expect.poll(() => relay.moderation.length).toBe(2);
    expect(relay.moderation[1].minutes).toBe(0);
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('保留草稿');
    relay.policy(false, new Date(Date.now() + 60_000).toISOString());
    await expect(page.getByText(/^禁言至 /)).toBeVisible();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    await expect(page.locator('.lounge-nav-badge')).toHaveCount(0);
    relay.policy(false);
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
    await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('保留草稿');
  });

test('admin user settings grant lounge moderation and save an explicit mute duration', async ({ page }) => {
  await page.goto('/e2e/lounge-admin-harness.html');
  await page.getByRole('switch', { name: '闲聊管理员' }).click();
  await page.getByRole('spinbutton', { name: '禁言时长（分钟）' }).fill('120');
  await page.screenshot({ path: '../../.codex-tmp/lounge-admin.png' });
  await page.getByRole('button', { name: /^保\s*存$/ }).click();
  await expect.poll(() => page.evaluate(() => window.loungeAdminFixture.writes))
    .toEqual([{ moderator: true, minutes: 120 }]);
  await expect(page.getByText('在线交流：7 人在线', { exact: true })).toBeVisible();
});

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: 128px avatar settings and searchable received history preserve the draft`, async ({ page }) => {
    const relay = await setupLounge(page, mode === 'web');
    await page.goto(mode === 'web' ? 'http://127.0.0.1:1486/web/' : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready();
    await page.getByRole('button', { name: '在线交流', exact: true }).click();
    await openDesktopAvatarSettings(page);
    await page.locator('.lounge-avatar-settings input[type=file]').setInputFiles({ name: 'avatar.png',
      mimeType: 'image/png', buffer: Buffer.from(pixel.split(',')[1], 'base64') });
    const preview = page.locator('.lounge-avatar-settings img');
    await expect(preview).toBeVisible();
    expect(await preview.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight]))
      .toEqual([128, 128]);
    await page.getByRole('button', { name: /^保\s*存$/ }).click();
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    await input.fill('HELLO 我的头像');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.locator('.lounge-message.is-own .lounge-avatar img')).toBeVisible();
    const savedAvatar = await page.locator('.lounge-message.is-own .lounge-avatar img').getAttribute('src');
    expect(savedAvatar).toMatch(/^data:image\/png;base64,/);
    expect(Buffer.from(savedAvatar!.split(',')[1], 'base64').length).toBeLessThanOrEqual(80 * 1024);
    expect(relay.sent[0].avatar).toBeUndefined();
    relay.push('喝杯咖啡 ☕', [pixel]);
    await input.fill('尚未发送的草稿');
    const historyButton = page.getByRole('button', { name: '历史记录', exact: true });
    const bounds = await historyButton.boundingBox();
    const composer = await page.locator('.lounge-composer').boundingBox();
    expect(bounds!.x).toBeGreaterThan(composer!.x + composer!.width / 2);
    await historyButton.click();
    await expect.poll(async () => Math.round((await page.locator('.ant-drawer-content-wrapper').boundingBox())!.x))
      .toBe(720);
    const search = page.getByRole('textbox', { name: '搜索消息或账户' });
    await search.fill('ＢＯＢ 咖啡');
    await expect(page.locator('.lounge-history-message')).toHaveCount(1);
    await expect(page.locator('.lounge-history-message')).toContainText('喝杯咖啡');
    await page.locator('.lounge-history-message .lounge-image').click();
    await expect(page.locator('.cs-image-viewer img')).toBeVisible();
    await page.getByRole('button', { name: '关闭图片', exact: true }).click();
    await expect(page.locator('.cs-image-viewer')).toBeHidden();
    await search.fill('不存在的内容');
    await expect(page.getByText('没有找到匹配的记录')).toBeVisible();
    await search.fill('hello');
    await expect(page.locator('.lounge-history-message .lounge-avatar img')).toBeVisible();
    await page.screenshot({ path: `../../.codex-tmp/lounge-history-${mode}.png`, animations: 'disabled' });
    relay.push('查看历史时收到');
    await expect(page.locator('.lounge-nav-badge')).toHaveText('1');
    await page.locator('.ant-drawer-close').click();
    await expect(input).toHaveValue('尚未发送的草稿');
    await expect(page.locator('.lounge-nav-badge')).toHaveCount(0);
    await page.reload();
    await expect.poll(relay.count).toBe(2);
    await page.getByRole('button', { name: '在线交流', exact: true }).click();
    await expect(page.locator('.lounge-my-account .lounge-avatar img')).toBeVisible();
    await openDesktopAvatarSettings(page);
    await page.getByRole('button', { name: '恢复默认头像' }).click();
    await page.getByRole('button', { name: /^保\s*存$/ }).click();
    await expect(page.locator('.lounge-my-account .lounge-avatar')).toHaveText('AL');
    await historyButton.click();
    await search.fill('hello');
    await expect(page.locator('.lounge-history-message')).toHaveCount(1);
    await expect(page.locator('.lounge-history-message .lounge-avatar')).toHaveText('AL');
    await search.fill('咖啡');
    await expect(page.locator('.lounge-history-message .lounge-image img')).toBeVisible();
    await page.evaluate(() => sessionStorage.setItem('lounge-test-offline', '1'));
    relay.offline(); await page.reload();
    await page.getByRole('button', { name: '在线交流', exact: true }).click();
    await expect(page.getByText('喝杯咖啡 ☕', { exact: true })).toBeVisible();
    await expect(page.locator('.lounge-nav-badge')).toHaveCount(0);
    await historyButton.click(); await search.fill('hello');
    await expect(page.locator('.lounge-history-message')).toContainText('HELLO 我的头像');
    expect(relay.count()).toBe(2);
  });
}

test('durable history searches beyond the recent 200 and isolates accounts with preloaded scrolling', async ({ page }) => {
  const relay = await setupLounge(page);
  await page.goto('/e2e/lounge-harness.html'); await relay.ready();
  relay.push('old-only-keyword', [pixel]);
  for (let index = 0; index < 210; index++) relay.push(`bulk-${index}`);
  await page.getByRole('button', { name: '在线交流', exact: true }).click();
  await expect(page.locator('.lounge-message')).toHaveCount(200);
  await expect(page.getByText('old-only-keyword', { exact: true })).toHaveCount(0);
  await openLoungeAction(page, '历史记录');
  // Receiving the burst does not mean its serialized local archive writes have finished.
  await expect(page.locator('.lounge-history-message .lounge-text').first())
    .toHaveText(/^bulk-\d+$/, { timeout: 30_000 });
  const first = await page.locator('.lounge-history-message .lounge-text').allTextContents();
  const historyScroll = page.locator('.lounge-history-list .rc-virtual-list-holder');
  await historyScroll.evaluate(node => { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => page.locator('.lounge-history-message .lounge-text').first().textContent())
    .not.toBe(first[0]);
  const second = await page.locator('.lounge-history-message .lounge-text').allTextContents();
  expect(second.some(text => first.includes(text))).toBe(false);
  await historyScroll.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
  await expect(page.locator('.lounge-history-message .lounge-text').first()).toHaveText(first[0]);
  const search = page.getByRole('textbox', { name: '搜索消息或账户' });
  await search.fill('ＢＯＢ old-only');
  await expect(page.locator('.lounge-history-message')).toHaveCount(1);
  await expect(page.locator('.lounge-history-message .lounge-image img')).toBeVisible();
  await page.goto('/e2e/lounge-harness.html?account=other@example.test');
  await page.getByRole('button', { name: '在线交流', exact: true }).click();
  await openLoungeAction(page, '历史记录');
  await expect(page.getByText('暂时没有聊天记录')).toBeVisible();
  await page.goto('/e2e/lounge-harness.html');
  await page.getByRole('button', { name: '在线交流', exact: true }).click();
  await expect(page.locator('.lounge-nav-badge')).toHaveCount(0);
  await openLoungeAction(page, '历史记录');
  await search.fill('old-only');
  await expect(page.locator('.lounge-history-message')).toContainText('old-only-keyword');
});
