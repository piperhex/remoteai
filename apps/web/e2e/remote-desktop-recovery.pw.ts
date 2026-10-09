import { expect, test, type Page } from '@playwright/test';

async function openDesktop(page: Page, native: boolean) {
  await page.goto(`e2e/remote-desktop-harness.html?displays${native ? '&native-clipboard' : ''}`);
  if (!native) await page.getByRole('button', { name: '打开工具', exact: true }).click();
  await page.getByRole('button', { name: native ? '打开远程桌面' : '远程桌面', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
  await expect(page.locator('.rd-status')).not.toBeVisible();
}

async function hostState(page: Page, online: boolean) {
  await page.locator(online ? '#reconnect-host' : '#disconnect-host')
    .evaluate((button: HTMLButtonElement) => button.click());
}

for (const native of [false, true]) {
  test(`recovers after a host restart in the ${native ? 'desktop client' : 'browser'}`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await openDesktop(page, native);
    await hostState(page, false);
    await expect(page.getByRole('dialog', { name: '远程桌面', exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('远程电脑已断开，恢复在线后将自动重连。');
    await expect(page.locator('.rd-stats')).not.toBeVisible();
    await expect(page.getByRole('button', { name: '重新连接', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '关闭', exact: true })).toBeEnabled();
    expect(await page.locator('.rd-status > span').evaluate(element => element.clientWidth)).toBeLessThanOrEqual(400);
    await page.screenshot({ path: info.outputPath('desktop-disconnected.png') });
    await hostState(page, true);
    await expect.poll(() => page.evaluate(() => window.desktopTest.captures)).toBe(2);
    await expect(page.locator('.rd-status')).not.toBeVisible();
    await expect.poll(() => page.locator('video').evaluate(video => video.videoWidth)).toBeGreaterThan(0);
    await page.getByRole('button', { name: '显示桌面', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.desktopTest.inputs.at(-1)))
      .toMatchObject({ kind: 'key', key: 'desktop' });
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.locator('.rd-root')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('keeps a healthy desktop running when only chat disconnects', async ({ page }) => {
  await openDesktop(page, true);
  await page.locator('#disconnect-chat').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('dialog', { name: '远程桌面', exact: true })).toBeVisible();
  const frames = await page.evaluate(() => window.desktopTest.frames);
  await expect.poll(() => page.evaluate(() => window.desktopTest.frames)).toBeGreaterThan(frames);
  await expect(page.locator('.rd-status')).not.toBeVisible();
  expect(await page.evaluate(() => window.desktopTest.captures)).toBe(1);
});

test('restores and closes a minimized viewer while the computer is offline', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await openDesktop(page, true);
  await page.getByRole('button', { name: '最小化', exact: true }).click();
  await hostState(page, false);
  await page.getByRole('button', { name: '恢复远程桌面', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('远程电脑已断开');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await hostState(page, true);
  await expect(page.locator('.rd-root')).toHaveCount(0);
  expect(await page.evaluate(() => window.desktopTest.captures)).toBe(1);
});

test('survives a control channel failing while releasing a held key', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openDesktop(page, true);
  await page.keyboard.down('Shift');
  await page.evaluate(() => {
    const send = RTCDataChannel.prototype.send;
    Object.defineProperty(RTCDataChannel.prototype, 'send', { configurable: true,
      value: function(this: RTCDataChannel, data: unknown) {
        if (typeof data === 'string' && data.includes('"down":false')) {
          throw new DOMException('The remote computer shut down', 'InvalidStateError');
        }
        return Reflect.apply(send, this, [data]);
      } });
  });
  await page.getByRole('button', { name: '最小化', exact: true }).click();
  await page.keyboard.up('Shift');
  await page.getByRole('button', { name: '恢复远程桌面', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '远程桌面', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('heading', { name: '电脑工具' })).toBeVisible();
  expect(errors).toEqual([]);
});
