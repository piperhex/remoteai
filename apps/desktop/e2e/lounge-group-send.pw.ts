import { expect, test } from '@playwright/test';
import { pixel, setupLounge } from './lounge-support';

const webURL = process.env.LOUNGE_TEST_WEB_URL ?? 'http://127.0.0.1:1486/web/';
test.setTimeout(120_000);

for (const mode of ['local', 'remote', 'web', 'mobile-web']) {
  test(`${mode}: group sending finishes on server acceptance before any message echo`, async ({ page }) => {
    const web = mode === 'web' || mode === 'mobile-web';
    if (mode === 'mobile-web') await page.setViewportSize({ width: 390, height: 844 });
    const relay = await setupLounge(page, web);
    relay.groupReply('manual');
    await page.goto(web ? webURL : `/e2e/lounge-harness.html?mode=${mode}`);
    await relay.ready();
    if (mode === 'mobile-web') {
      await page.getByRole('tab', { name: '发现', exact: true }).click();
      await page.locator('.discovery-lounge').click();
      await page.getByRole('button', { name: '群聊', exact: true }).click();
    } else await page.getByRole('button', { name: '在线交流', exact: true }).click();
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    await input.fill('群聊文字和图片');
    await page.locator('.lounge-composer input[type=file]').setInputFiles({ name: 'picture.png', mimeType: 'image/png',
      buffer: Buffer.from(pixel.split(',')[1], 'base64') });
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => relay.sent.length).toBe(1);
    await expect(input).toHaveValue('群聊文字和图片');
    await expect(page.locator('.lounge-message.is-own')).toHaveCount(0);
    relay.close();
    await expect(page.locator('.lounge-composer [role=alert]')).toBeVisible();
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => relay.sent.length).toBe(2);
    expect(relay.sent[1].id).toBe(relay.sent[0].id);
    relay.acceptGroup(1);
    await expect(input).toHaveValue('');
    await expect(page.locator('.lounge-attachments img')).toHaveCount(0);
    await expect(page.locator('.lounge-message.is-own')).toHaveCount(1);
    await expect(page.locator('.lounge-message.is-own')).toContainText('群聊文字和图片');
    await expect(page.locator('.lounge-message.is-own img')).toHaveCount(1);
    relay.acceptGroup(0); relay.echoGroup(0);
    await input.fill('下一条');
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
    await page.screenshot({ path: `../../.codex-tmp/lounge-group-accepted-${mode}.png`, animations: 'disabled' });
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => relay.sent.length).toBe(3);
    await input.fill('发送期间继续编辑'); relay.acceptGroup(2);
    await expect(page.locator('.lounge-message.is-own')).toHaveCount(2);
    await expect(input).toHaveValue('发送期间继续编辑');
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => relay.sent.length).toBe(4); relay.rejectGroup(3);
    await expect(page.locator('.lounge-composer [role=alert]')).toBeVisible();
    await expect(input).toHaveValue('发送期间继续编辑');
    await expect(page.locator('.lounge-message.is-own')).toHaveCount(2);
  });
}
